// The only module that talks to the network. Every page the scraper reads comes
// through getPage(), which either returns a saved copy from disk or makes one
// polite request and saves the result.
const fs = require('node:fs');
const path = require('node:path');

// Names this robot in the site's access logs, with a link back to who runs it.
const USER_AGENT = 'FlyRankInternshipA9/1.0 (+https://github.com/Wibson27/task-api)';

// fetch has no timeout by default: a server that accepts the connection and
// never answers would leave the request hanging forever.
const TIMEOUT_MS = 10_000;

// The minimum quiet time between one request finishing and the next one
// starting. Cache hits never leave this machine, so they are not delayed.
const MIN_DELAY_MS = 500;

// Overridable so tests can use a scratch folder and never write into the real
// cache.
const CACHE_DIR = process.env.SCRAPER_CACHE_DIR || path.join(__dirname, '..', 'cache');

class FetchError extends Error {
  constructor(message, { url, status = null } = {}) {
    super(message);
    this.name = 'FetchError';
    this.url = url;
    this.status = status;
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
// at least MIN_DELAY_MS of quiet between one request and the next, however slowly
// it answers.
let lastRequestFinishedAt = 0;

async function politeDelay() {
  const wait = lastRequestFinishedAt + MIN_DELAY_MS - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

// Returns { html, source: 'cache' | 'network', bytes, file, fetchedAt }.
//
// fetchedAt is when the page was actually downloaded. For a cache hit that is
// the time the file was written, not the time it was read back: a record built
// from a copy saved yesterday must not claim it was fetched a second ago. The
// timestamp is part of the record's receipt, and a receipt with today's date on
// yesterday's purchase is worse than no receipt.
async function getPage(url) {
  const file = cacheFileFor(url);

  if (fs.existsSync(file)) {
    const html = fs.readFileSync(file, 'utf8');
    const fetchedAt = fs.statSync(file).mtime.toISOString();
    return { html, source: 'cache', bytes: Buffer.byteLength(html), file, fetchedAt };
  }

  await politeDelay();

  let html;
  try {
    let response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS} ms` : err.message;
      throw new FetchError(`request failed: ${reason}`, { url });
    }

    // Only a 200 means "here is your page". A 404 or 500 still comes with an HTML
    // body — an error page — and parsing that as if it were the book page would
    // quietly produce a wrong record instead of a visible failure.
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new FetchError(`HTTP ${response.status}`, { url, status: response.status });
    }

    html = await response.text();
  } finally {
    // A failed request still hit the site, so it still starts the quiet period.
    lastRequestFinishedAt = Date.now();
  }

  const fetchedAt = new Date().toISOString();

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, html, 'utf8');

  return { html, source: 'network', bytes: Buffer.byteLength(html), file, fetchedAt };
}

module.exports = { getPage, FetchError, USER_AGENT, TIMEOUT_MS, MIN_DELAY_MS, CACHE_DIR };
