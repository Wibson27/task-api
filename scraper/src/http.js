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

// The minimum gap between two requests that actually reach the site. Cache hits
// never leave this machine, so they are not delayed.
const MIN_DELAY_MS = 500;

const CACHE_DIR = path.join(__dirname, '..', 'cache');

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

let lastRequestAt = 0;

async function politeDelay() {
  const wait = lastRequestAt + MIN_DELAY_MS - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

// Returns { html, source: 'cache' | 'network', bytes, file }.
async function getPage(url) {
  const file = cacheFileFor(url);

  if (fs.existsSync(file)) {
    const html = fs.readFileSync(file, 'utf8');
    return { html, source: 'cache', bytes: Buffer.byteLength(html), file };
  }

  await politeDelay();

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
    throw new FetchError(`HTTP ${response.status}`, { url, status: response.status });
  }

  const html = await response.text();

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, html, 'utf8');

  return { html, source: 'network', bytes: Buffer.byteLength(html), file };
}

module.exports = { getPage, FetchError, USER_AGENT, TIMEOUT_MS, MIN_DELAY_MS, CACHE_DIR };
