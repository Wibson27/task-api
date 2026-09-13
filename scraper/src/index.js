const { discoverBooks } = require('./discover');

async function main() {
  const { pages, discovered, unique } = await discoverBooks({
    onPage: ({ url, source, books }) => {
      const label = source === 'cache' ? 'CACHE HIT' : 'FETCH';
      console.log(`${label} ${url} books=${books}`);
    },
  });

  const fetched = pages.filter((p) => p.source === 'network').length;
  const cached = pages.length - fetched;

  console.log(
    `catalogue_pages=${pages.length} discovered=${discovered.length} unique_urls=${unique.length} ` +
      `fetched=${fetched} cache_hits=${cached}`,
  );
}

main().catch((err) => {
  console.error(`${err.name}: ${err.message}${err.url ? ` (${err.url})` : ''}`);
  process.exitCode = 1;
});
