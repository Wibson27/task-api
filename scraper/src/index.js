const { discoverBooks } = require('./discover');
const { getPageWithRetry } = require('./http');
const { extractBook } = require('./extract');
const { normalizeRecord } = require('./normalize');
const { validateBook } = require('./schema');
const { dedupeByUrl, writeJsonAtomic } = require('./store');

// A book URL that does not exist, added on purpose with --with-broken-url. It
// proves one bad page is logged and skipped rather than ending the run. The
// site answers it with a 404, which is never retried, so the whole proof costs
// the site exactly one request.
const BROKEN_URL = 'https://books.toscrape.com/catalogue/this-book-does-not-exist_0/index.html';

function label(source) {
  return source === 'cache' ? 'CACHE HIT' : 'FETCH    ';
}

async function run() {
  const withBrokenUrl = process.argv.includes('--with-broken-url');
  const startedAt = new Date();

  const report = {
    started_at: startedAt.toISOString(),
    finished_at: null,
    duration_ms: null,
    status: 'running',
    injected_broken_url: withBrokenUrl,
    catalogue_pages: 0,
    discovered_urls: 0,
    unique_urls: 0,
    detail_pages_attempted: 0,
    requests_attempted: 0,
    pages_fetched: 0,
    cache_hits: 0,
    retries: 0,
    valid_records: 0,
    invalid_records: 0,
    duplicates: 0,
    failed_pages: 0,
    failures: [],
  };

  // requests_attempted counts every network attempt, retries included, and
  // including attempts that failed before any response arrived — a timeout, a
  // refused connection, or a request fetch declined to send. It is deliberately
  // not called "requests sent": not every failed attempt reaches the site.
  // pages_fetched counts only attempts that returned a page.
  const countAttempts = (attempts) => {
    report.requests_attempted += attempts;
    if (attempts > 1) report.retries += attempts - 1;
  };

  try {
    const { discovered, unique } = await discoverBooks({
      // Counted as each page is read, not totalled once discovery returns. If
      // page 2 cannot be fetched, the report still shows that page 1 was read.
      onPage: ({ url, source, attempts, books }) => {
        report.catalogue_pages += 1;
        if (source === 'cache') report.cache_hits += 1;
        else report.pages_fetched += 1;
        countAttempts(attempts);
        console.log(`${label(source)} ${url} books=${books}`);
      },
    });

    report.discovered_urls = discovered.length;
    report.unique_urls = unique.length;
    console.log(
      `catalogue_pages=${report.catalogue_pages} discovered=${discovered.length} unique_urls=${unique.length}`,
    );

    const targets = [...unique];
    if (withBrokenUrl) {
      targets.push({ url: BROKEN_URL, sourcePage: '(added on purpose with --with-broken-url)' });
      console.log(`added one broken URL on purpose: ${BROKEN_URL}`);
    }

    // Each book page is handled on its own. A page that fails to fetch — or that
    // fetches but then breaks extraction — is recorded and skipped, and the loop
    // carries on. Fifty-nine good records must survive one bad page.
    const rawRecords = [];

    for (const target of targets) {
      report.detail_pages_attempted += 1;

      try {
        const page = await getPageWithRetry(target.url);

        if (page.source === 'cache') report.cache_hits += 1;
        else report.pages_fetched += 1;
        countAttempts(page.attempts);
        if (page.source === 'network') console.log(`FETCH     ${target.url}`);

        rawRecords.push(
          extractBook(page.html, { productUrl: target.url, sourcePage: target.sourcePage, fetchedAt: page.fetchedAt }),
        );
      } catch (err) {
        if (err.attempts) countAttempts(err.attempts);
        report.failures.push({
          url: target.url,
          source_page: target.sourcePage,
          kind: err.kind || 'extract',
          status: err.status ?? null,
          attempts: err.attempts ?? 0,
          message: err.message,
        });
        console.log(`FAILED    ${target.url} — ${err.message} (attempts=${err.attempts ?? 0})`);
      }
    }

    const valid = [];
    const errors = [];

    for (const raw of rawRecords) {
      const record = normalizeRecord(raw);
      const result = validateBook(record);

      if (result.ok) {
        valid.push(result.data);
      } else {
        errors.push({ product_url: raw.product_url, reason: result.reason, issues: result.issues, record });
      }
    }

    const { unique: books, duplicates } = dedupeByUrl(valid);

    // Output is written only once every page has been handled. A run that dies
    // part-way leaves the previous books.json exactly as it was, rather than
    // replacing sixty good records with a partial set.
    writeJsonAtomic('books.json', books);
    writeJsonAtomic('errors.json', errors);

    report.valid_records = books.length;
    report.invalid_records = errors.length;
    report.duplicates = duplicates;
    report.status = 'completed';
  } catch (err) {
    // Something that stops the whole run, such as a catalogue page that cannot
    // be fetched. The report below is still written, with the reason.
    //
    // That page's attempt and failure are recorded here, because discovery
    // threw before it could report them. Without this the report would show
    // zero attempts and zero failed pages for a run that died on a failed page —
    // and a report that undercounts is exactly the kind that lets a broken
    // scraper look healthy.
    if (err.attempts) countAttempts(err.attempts);
    if (err.url) {
      report.failures.push({
        url: err.url,
        source_page: null,
        kind: err.kind || 'unknown',
        status: err.status ?? null,
        attempts: err.attempts ?? 0,
        message: err.message,
      });
    }
    report.status = 'failed';
    report.fatal_error = `${err.name}: ${err.message}${err.url ? ` (${err.url})` : ''}`;
    console.error(`RUN FAILED ${report.fatal_error}`);
    process.exitCode = 1;
  } finally {
    const finishedAt = new Date();
    report.finished_at = finishedAt.toISOString();
    report.duration_ms = finishedAt - startedAt;
    report.failed_pages = report.failures.length;

    const reportFile = writeJsonAtomic('run-report.json', report);

    console.log(
      `\nstatus=${report.status} valid=${report.valid_records} invalid=${report.invalid_records} ` +
        `failed_pages=${report.failed_pages} pages_fetched=${report.pages_fetched} cache_hits=${report.cache_hits} ` +
        `requests_attempted=${report.requests_attempted} retries=${report.retries} duration_ms=${report.duration_ms}`,
    );
    console.log(`report -> ${reportFile}`);
  }
}

run();
