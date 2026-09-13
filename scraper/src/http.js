// The only module that talks to the network. Every page the scraper reads comes
// through here: either a saved copy from disk, or a polite request whose result
// is then saved.
const fs = require('node:fs');
const path = require('node:path');

// Names this robot in the site's access logs, with a link back to who runs it.
const USER_AGENT = 'FlyRankInternshipA9/1.0 (+https://github.com/Wibson27/task-api)';

// fetch has no timeout by default: a server that accepts the connection and
// never answers would leave the request hanging forever. Overridable so tests
// can exercise the timeout path without waiting ten seconds per case.
const TIMEOUT_MS = Number(process.env.SCRAPER_TIMEOUT_MS) || 10_000;

// The minimum quiet time between one request finishing and the next starting.
const MIN_DELAY_MS = 500;

// The longer quiet time before a retry. A timeout or a 5xx usually means the
// server is struggling, and the kind thing is to give it more room, not less.
const RETRY_DELAY_MS = 1000;

// Overridable so tests can use a scratch folder and never write into the real
// cache.
const CACHE_DIR = process.env.SCRAPER_CACHE_DIR || path.join(__dirname, '..', 'cache');

// kind is what the retry rules act on:
//   'timeout' — no complete answer within TIMEOUT_MS
//   'http'    — the server answered with a status other than 200
//   'network' — the request could not be made at all (refused, DNS, reset)
class FetchError extends Error {
  constructor(message, { url, kind, status = null }) {
    super(message);
    this.name = 'FetchError';
    this.url = url;
    this.kind = kind;
    this.status = status;
    this.attempts = 1;
  }
}

// One cache file per URL, named from the URL's path so a human can find it:
// /catalogue/page-1.html -> catalogue-page-1.html
function cacheFileFor(url) {
  const { pathname } = new URL(url);
  const name = pathname.replace(/^\/+/, '').replace(/\/+/g, '-') || 'index.html';
  return path.join(CACHE_DIR, name);
}

// When the previous request to the site finished — successfully or not.
//
// The delay is measured from the END of the last request, not its start. Counting
// from the start only spaces out the moments requests are sent: if the site took
// 600 ms to answer, the next request would go out the instant that answer
// arrived, with no pause at all. Counting from the end guarantees the site gets
// real quiet between one request and the next, however slowly it answers.
let lastRequestFinishedAt = 0;

async function politeDelay(minQuietMs) {
  const wait = lastRequestFinishedAt + minQuietMs - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

function toFetchError(err, url) {
  if (err instanceof FetchError) return err;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return new FetchError(`timed out after ${TIMEOUT_MS} ms`, { url, kind: 'timeout' });
  }
  // fetch reports every network failure as the same TypeError, "fetch failed".
  // The real reason sits on err.cause: a code such as ECONNREFUSED when a
  // connection was tried and refused, or only a message such as "bad port" when
  // fetch declined to try at all (some ports are blocked by the fetch standard).
  const reason = err.cause?.code || err.cause?.message || err.message;
  return new FetchError(`request failed: ${reason}`, { url, kind: 'network' });
}

// One attempt. Returns { html, source: 'cache' | 'network', bytes, file, fetchedAt }.
//
// fetchedAt is when the page was actually downloaded. For a cache hit that is
// the time the file was written, not the time it was read back: a record built
// from a copy saved yesterday must not claim it was fetched a second ago.
async function getPage(url, { minQuietMs = MIN_DELAY_MS } = {}) {
  const file = cacheFileFor(url);

  if (fs.existsSync(file)) {
    const html = fs.readFileSync(file, 'utf8');
    const fetchedAt = fs.statSync(file).mtime.toISOString();
    return { html, source: 'cache', bytes: Buffer.byteLength(html), file, fetchedAt };
  }

  await politeDelay(minQuietMs);

  let html;
  try {
    // One signal covers the whole exchange. Placing the timeout on fetch()
    // alone would bound only the wait for the response to start; a server that
    // sent its headers and then trickled the body would still hang the read.
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal });

    // Only a 200 means "here is your page". A 404 or 500 still comes with an HTML
    // body — an error page — and parsing that as if it were the book page would
    // quietly produce a wrong record instead of a visible failure.
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new FetchError(`HTTP ${response.status}`, { url, kind: 'http', status: response.status });
    }

    html = await response.text();
  } catch (err) {
    throw toFetchError(err, url);
  } finally {
    // A failed request still reached the site, so it still starts the quiet period.
    lastRequestFinishedAt = Date.now();
  }

  const fetchedAt = new Date().toISOString();

  // Only a complete, successful response is cached. A failure must never be
  // saved: it would be served from disk forever after, and the page would look
  // permanently broken even once the site was fine.
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, html, 'utf8');

  return { html, source: 'network', bytes: Buffer.byteLength(html), file, fetchedAt };
}

// Worth asking again: a timeout, or a server error (5xx). Both can be momentary.
//
// Not worth asking again:
//   404 — the page does not exist. Asking twice will not create it.
//   403 — the site refused. Asking again is how a polite robot becomes a pest.
//   other 4xx — the request itself is wrong, and repeating it changes nothing.
//   'network' — the brief names timeouts and 5xx as the retryable cases, and this
//               stage deliberately keeps to that rule. Next week's assignment
//               covers fuller retry policies.
function isRetryable(err) {
  return err.kind === 'timeout' || (err.kind === 'http' && err.status >= 500);
}

// Returns the page plus attempts: 0 for a cache hit, 1 or 2 for the network.
// On failure the error carries attempts as well, so the run report can count
// every request that actually reached the site.
async function getPageWithRetry(url) {
  try {
    const page = await getPage(url);
    return { ...page, attempts: page.source === 'cache' ? 0 : 1 };
  } catch (first) {
    if (!isRetryable(first)) {
      first.attempts = 1;
      throw first;
    }

    try {
      const page = await getPage(url, { minQuietMs: RETRY_DELAY_MS });
      return { ...page, attempts: 2 };
    } catch (second) {
      second.attempts = 2;
      throw second;
    }
  }
}

module.exports = {
  getPage,
  getPageWithRetry,
  isRetryable,
  FetchError,
  USER_AGENT,
  TIMEOUT_MS,
  MIN_DELAY_MS,
  RETRY_DELAY_MS,
  CACHE_DIR,
};
