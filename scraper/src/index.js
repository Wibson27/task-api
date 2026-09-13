const { discoverBooks } = require('./discover');
const { getPage } = require('./http');
const { extractBook } = require('./extract');
const { normalizeRecord } = require('./normalize');
const { validateBook } = require('./schema');
const { dedupeByUrl, writeJsonAtomic } = require('./store');

function label(source) {
  return source === 'cache' ? 'CACHE HIT' : 'FETCH    ';
}

async function main() {
  // fetch -> extract
  const { pages, discovered, unique } = await discoverBooks({
    onPage: ({ url, source, books }) => console.log(`${label(source)} ${url} books=${books}`),
  });
  console.log(`catalogue_pages=${pages.length} discovered=${discovered.length} unique_urls=${unique.length}`);

  const rawRecords = [];
  let fetched = 0;
  let cacheHits = 0;

  for (const book of unique) {
    const page = await getPage(book.url);
    if (page.source === 'network') {
      fetched += 1;
      console.log(`FETCH     ${book.url}`);
    } else {
      cacheHits += 1;
    }
    rawRecords.push(
      extractBook(page.html, { productUrl: book.url, sourcePage: book.sourcePage, fetchedAt: page.fetchedAt }),
    );
  }

  // normalize -> validate. Every record is checked before it can be stored.
  const valid = [];
  const errors = [];

  for (const raw of rawRecords) {
    const record = normalizeRecord(raw);
    const result = validateBook(record);

    if (result.ok) {
      valid.push(result.data);
    } else {
      errors.push({
        product_url: raw.product_url,
        reason: result.reason,
        issues: result.issues,
        record,
      });
    }
  }

  // store
  const { unique: books, duplicates } = dedupeByUrl(valid);

  // Both files are written on every run, errors.json included when it is
  // empty. Otherwise an errors.json left over from an earlier failed run would
  // sit next to a clean books.json and look like a current problem.
  const booksFile = writeJsonAtomic('books.json', books);
  const errorsFile = writeJsonAtomic('errors.json', errors);

  console.log(
    `detail_pages=${rawRecords.length} fetched=${fetched} cache_hits=${cacheHits} ` +
      `valid=${valid.length} invalid=${errors.length} duplicates=${duplicates}`,
  );
  console.log(`wrote ${books.length} records -> ${booksFile}`);
  console.log(`wrote ${errors.length} errors  -> ${errorsFile}`);
}

main().catch((err) => {
  console.error(`${err.name}: ${err.message}${err.url ? ` (${err.url})` : ''}`);
  process.exitCode = 1;
});
