const path = require('node:path');
const { getPage } = require('./http');

const FIRST_CATALOGUE_PAGE = 'https://books.toscrape.com/catalogue/page-1.html';

async function main() {
  const page = await getPage(FIRST_CATALOGUE_PAGE);
  const label = page.source === 'cache' ? 'CACHE HIT' : 'FETCH';

  // The size and where it was saved — never the HTML itself.
  console.log(`${label} ${FIRST_CATALOGUE_PAGE} bytes=${page.bytes} file=${path.basename(page.file)}`);
}

main().catch((err) => {
  console.error(`${err.name}: ${err.message}${err.url ? ` (${err.url})` : ''}`);
  process.exitCode = 1;
});
