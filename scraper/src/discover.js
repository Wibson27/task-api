// Crawling: find the catalogue pages and the book links on them. Nothing here
// reads a book's details — that is extraction, a separate step.
const cheerio = require('cheerio');
const { getPage } = require('./http');

const FIRST_CATALOGUE_PAGE = 'https://books.toscrape.com/catalogue/page-1.html';
const MAX_CATALOGUE_PAGES = 3;

// Each book card links to the book twice: once from the cover image and once
// from the title. Selecting every link in the card would count each book twice,
// so this targets the title link only — one per book.
const BOOK_LINK = 'article.product_pod h3 a';
const NEXT_LINK = 'ul.pager li.next a';

// Links on the page are relative, and not always in the same shape: these
// catalogue pages use "a-light-in-the-attic_1000/index.html", while the site's
// front page uses "catalogue/a-light-in-the-attic_1000/index.html". new URL()
// resolves either one against the page it came from, exactly as a browser would.
// Gluing strings together would work for one shape and break on the other.
function parseCatalogue(html, pageUrl) {
  const $ = cheerio.load(html);

  const bookUrls = $(BOOK_LINK)
    .map((_, a) => $(a).attr('href'))
    .get()
    .filter(Boolean)
    .map((href) => new URL(href, pageUrl).href);

  const nextHref = $(NEXT_LINK).attr('href');
  const nextUrl = nextHref ? new URL(nextHref, pageUrl).href : null;

  return { bookUrls, nextUrl };
}

// Follows the site's own "next" links rather than generating page-2.html and
// page-3.html from a pattern. The site decides what its pages are; this code
// only decides how many to read.
async function discoverBooks({ onPage } = {}) {
  const pages = [];
  const discovered = [];
  let url = FIRST_CATALOGUE_PAGE;

  while (url && pages.length < MAX_CATALOGUE_PAGES) {
    const page = await getPage(url);
    const { bookUrls, nextUrl } = parseCatalogue(page.html, url);

    pages.push({ url, source: page.source, books: bookUrls.length });
    for (const bookUrl of bookUrls) discovered.push({ url: bookUrl, sourcePage: url });
    if (onPage) onPage({ url, source: page.source, books: bookUrls.length });

    url = nextUrl;
  }

  // Keep the first sighting of each URL, so every book remembers the catalogue
  // page it was first found on.
  const seen = new Map();
  for (const item of discovered) {
    if (!seen.has(item.url)) seen.set(item.url, item);
  }

  return { pages, discovered, unique: [...seen.values()] };
}

module.exports = { discoverBooks, parseCatalogue, FIRST_CATALOGUE_PAGE, MAX_CATALOGUE_PAGES };
