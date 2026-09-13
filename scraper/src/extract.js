// Extraction: read the raw fields off one book page. Values stay as the text the
// page showed — turning "£51.77" into a number is normalization, a later step.
const cheerio = require('cheerio');

// Everything about the product lives in this block. Selecting inside it rather
// than across the whole document matters on this page: the pound sign appears
// four times (the price, then "Price (excl. tax)", "Price (incl. tax)" and
// "Tax £0.00" in the information table), and the availability text appears
// twice. A selector for "the first price on the page" works until the day the
// page grows another one.
const PRODUCT = '.product_main';

// Page text arrives with the indentation and line breaks of the HTML source.
// Collapsing runs of whitespace keeps what a reader would see.
function cleanText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function extractBook(html, { productUrl, sourcePage, fetchedAt }) {
  const $ = cheerio.load(html);
  const product = $(PRODUCT);

  // The star rating is not text on the page. It is a class name:
  // <p class="star-rating Three">. The word is read from the class list.
  const ratingClasses = (product.find('p.star-rating').attr('class') || '').split(/\s+/);
  const rating = ratingClasses.find((c) => c && c !== 'star-rating') || null;

  // #product_description is only the "Product Description" heading. The text is
  // the paragraph immediately after it. When a book has no description the
  // heading is absent too, so this finds nothing and the value is null — rather
  // than falling back to "the first <p> on the page", which is the price.
  const descriptionText = $('#product_description').next('p').text();
  const description = descriptionText ? cleanText(descriptionText) : null;

  const text = (selector) => {
    const found = product.find(selector).first().text();
    return found ? cleanText(found) : null;
  };

  return {
    // The <h1> holds the full title. The catalogue card truncates long ones to
    // "A Light in the ...", so the card is not a reliable source for it.
    title: text('h1'),
    product_url: productUrl,
    price_text: text('p.price_color'),
    availability_text: text('p.availability'),
    rating_text: rating,
    description,
    source_page: sourcePage,
    fetched_at: fetchedAt,
  };
}

module.exports = { extractBook };
