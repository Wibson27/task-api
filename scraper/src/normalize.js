// Normalization: turn the raw text a page showed into values a program can use.
// The raw text stays on the record next to the clean value, so anyone can see
// exactly what each number was derived from.
//
// Every parser here is strict. It accepts the one shape the pages actually use
// and returns null for anything else. A null is not a guess and not a crash: the
// schema rejects it, and the record lands in errors.json with the reason. That is
// the point — a page that changes shape should produce a visible failure, not a
// quietly wrong number.

// "£51.77" -> 51.77.
//
// Deliberately not text.replace(/[^\d.]/g, ''). That looks equivalent and is not:
// "£51.77 (was £60.00)" would become "51.7760.00", and parseFloat reads that as
// 51.776 — a wrong price that looks perfectly valid.
function parsePriceGbp(text) {
  if (typeof text !== 'string') return null;
  const match = /^£(\d+)\.(\d{2})$/.exec(text.trim());
  return match ? Number(`${match[1]}.${match[2]}`) : null;
}

const RATING_WORDS = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 };

// "Three" -> 3. The word comes from the star-rating class name.
function parseRating(text) {
  return Object.hasOwn(RATING_WORDS, text) ? RATING_WORDS[text] : null;
}

// "In stock (22 available)" -> 22.
//
// Only the shape seen on all 60 of these pages is accepted. An out-of-stock book
// would read differently, but none of the scraped pages show one, so rather than
// guess what that wording is, anything unrecognized is rejected for a human to
// look at.
function parseStockCount(text) {
  if (typeof text !== 'string') return null;
  const match = /^In stock \((\d+) available\)$/.exec(text.trim());
  return match ? Number(match[1]) : null;
}

// The one form of a URL used as a record's identity. new URL() lowercases the
// scheme and host; the query string and fragment are dropped because they point
// at the same book. Two spellings of one page must count as one record.
function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function normalizeRecord(raw) {
  return {
    title: raw.title,
    product_url: canonicalUrl(raw.product_url),
    price_text: raw.price_text,
    price_gbp: parsePriceGbp(raw.price_text),
    availability_text: raw.availability_text,
    stock_count: parseStockCount(raw.availability_text),
    rating_text: raw.rating_text,
    rating: parseRating(raw.rating_text),
    description: raw.description,
    source_page: canonicalUrl(raw.source_page),
    fetched_at: raw.fetched_at,
  };
}

module.exports = { normalizeRecord, parsePriceGbp, parseRating, parseStockCount, canonicalUrl };
