// Storing: decide which records are kept, and write them without ever leaving a
// half-written file behind.
const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_DIR = process.env.SCRAPER_OUTPUT_DIR || path.join(__dirname, '..', 'output');

// One record per canonical URL; the first one seen wins. The output is rebuilt
// from scratch on every run rather than appended to, so running the scraper
// twice produces the same 60 records instead of 120 — re-running a failed job is
// always safe.
function dedupeByUrl(records) {
  const byUrl = new Map();
  let duplicates = 0;

  for (const record of records) {
    if (byUrl.has(record.product_url)) {
      duplicates += 1;
    } else {
      byUrl.set(record.product_url, record);
    }
  }

  return { unique: [...byUrl.values()], duplicates };
}

// Writes to a temporary file in the same folder, then renames it into place.
// The rename replaces the old file in a single step, so anything reading
// books.json sees either the complete old version or the complete new one —
// never a truncated file from a run that crashed halfway through writing.
function writeJsonAtomic(fileName, data) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const target = path.join(OUTPUT_DIR, fileName);
  const temp = `${target}.tmp`;

  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, target);

  return target;
}

module.exports = { dedupeByUrl, writeJsonAtomic, OUTPUT_DIR };
