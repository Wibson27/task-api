// The shape of a finished record. Nothing reaches books.json without passing
// this check; anything that fails goes to errors.json with the reason.
const { z } = require('zod');

// Both URLs on a record must be absolute https URLs on this one site. A relative
// link, an http link, or a link to some other host means extraction or
// normalization went wrong, and the record should not be trusted.
const BOOKS_URL = z.url({ protocol: /^https$/, hostname: /^books\.toscrape\.com$/ });

// strictObject: an unexpected key is an error, not something silently carried
// along. If a later change adds a field, the schema has to be updated on purpose.
const BookSchema = z.strictObject({
  title: z.string().min(1),
  product_url: BOOKS_URL,

  price_text: z.string().regex(/^£\d+\.\d{2}$/),
  // z.number() rejects NaN, Infinity and numeric strings like "51.77", so a
  // failed parse can never pass as a price.
  price_gbp: z.number().nonnegative(),

  availability_text: z.string().min(1),
  stock_count: z.number().int().nonnegative(),

  rating_text: z.enum(['One', 'Two', 'Three', 'Four', 'Five']),
  rating: z.number().int().min(1).max(5),

  // The brief makes the description optional. Here the key is always present
  // and its value may be null — not "the key may be missing". A consumer of
  // books.json can read record.description on every record without first
  // checking whether it exists, and an empty string is rejected: a description
  // is either real text from the page, or null.
  description: z.string().min(1).nullable(),

  source_page: BOOKS_URL,
  fetched_at: z.iso.datetime(),
});

function validateBook(record) {
  const result = BookSchema.safeParse(record);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(record)',
    code: issue.code,
    message: issue.message,
  }));

  return {
    ok: false,
    reason: issues.map((i) => `${i.path}: ${i.message}`).join('; '),
    issues,
  };
}

module.exports = { BookSchema, validateBook };
