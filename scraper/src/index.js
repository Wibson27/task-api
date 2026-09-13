const { discoverBooks } = require('./discover');
const { getPage } = require('./http');
const { extractBook } = require('./extract');

function label(source) {
  return source === 'cache' ? 'CACHE HIT' : 'FETCH    ';
}

async function main() {
  const { pages, discovered, unique } = await discoverBooks({
    onPage: ({ url, source, books }) => console.log(`${label(source)} ${url} books=${books}`),
  });

  console.log(`catalogue_pages=${pages.length} discovered=${discovered.length} unique_urls=${unique.length}`);

  const records = [];
  let fetched = 0;
  let cacheHits = 0;

  for (const [i, book] of unique.entries()) {
    const page = await getPage(book.url);
    if (page.source === 'network') fetched += 1;
    else cacheHits += 1;

    records.push(
      extractBook(page.html, {
        productUrl: book.url,
        sourcePage: book.sourcePage,
        fetchedAt: page.fetchedAt,
      }),
    );

    const done = i + 1;
    if (page.source === 'network' || done === unique.length) {
      console.log(`${label(page.source)} detail ${done}/${unique.length}`);
    }
  }

  console.log('\nOne complete raw record:');
  console.log(JSON.stringify(records[0], null, 2));

  const missingDescription = records.filter((r) => r.description === null).length;
  console.log(
    `\ndetail_pages=${records.length} fetched=${fetched} cache_hits=${cacheHits} ` +
      `null_descriptions=${missingDescription}`,
  );
}

main().catch((err) => {
  console.error(`${err.name}: ${err.message}${err.url ? ` (${err.url})` : ''}`);
  process.exitCode = 1;
});
