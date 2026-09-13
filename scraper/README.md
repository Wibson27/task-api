# Polite scraper

A small scraping pipeline for the Books to Scrape practice sandbox. It reads the
first three catalogue pages, visits all 60 book pages, turns the HTML into
clean, checked JSON records, survives a broken page without crashing, and ends
every run with a report of what happened.

FlyRank internship, Backend track, Week 5, Assignment A9. JavaScript lane.

```
fetch -> extract -> normalize -> validate -> store -> report
```

## Run it

Needs **Node.js 20 or newer** ([nodejs.org](https://nodejs.org)). From the root of
this repository:

```bash
cd scraper && npm install && npm start
```

That produces three files in `scraper/output/`:

| File | What it holds |
|---|---|
| `books.json` | The 60 validated book records |
| `errors.json` | Records that failed validation, each with the reason. `[]` on a clean run. |
| `run-report.json` | What the run did: timings, request and cache counts, failures |

The first run fetches 63 pages from the site, one at a time with a pause between
each, and takes about a minute. Every page is saved to `scraper/cache/`, so later
runs read from disk and finish in well under a second without contacting the
site at all. Delete `cache/` to fetch everything again.

To prove a broken page cannot take the run down, add one made-up book URL on
purpose:

```bash
node src/index.js --with-broken-url
```

The run still finishes, `books.json` still holds the 60 good records, and
`run-report.json` shows `failed_pages: 1`. That costs the site exactly one
request: the made-up URL answers 404, and a 404 is never retried.

## Target classification

| | |
|---|---|
| **Site** | [books.toscrape.com](https://books.toscrape.com) |
| **What it is** | A practice sandbox. Its parent site, [toscrape.com](https://toscrape.com), describes it as *"a fictional bookstore that desperately wants to be scraped"* and *"a safe place for beginners learning web scraping"*. |
| **Scope** | The first 3 catalogue pages only, and the 60 book pages they link to. Nothing else on the site. |
| **Data collected** | For each book: title, product URL, price, availability, star rating, description, and where and when it was fetched. No personal data — the books and prices are fictional. |
| **robots.txt** | Requested once on 2026-09-14: `https://books.toscrape.com/robots.txt` returned **HTTP 404**. No robots file found. A missing file is not permission; the permission here is the site's own statement that it exists to be scraped. |

**Why this is appropriate:** the site was built so people can practise scraping
on it, the data is fictional, and the scope is small and fixed.

I will not reuse this code on another site without checking its rules and terms first.

## Why no browser

The data is already in the HTML the server sends: title, price, availability,
rating and description are all in the page source, and this scraper reads them
straight out of the response with Cheerio. A browser would only add cost — a full
browser process, page rendering and script execution — to reach text that was
already there.

## Politeness rules

| Rule | How it is enforced |
|---|---|
| **Say who you are** | Every request sends `User-Agent: FlyRankInternshipA9/1.0 (+https://github.com/Wibson27/task-api)` |
| **Go slowly** | At least **500 ms of quiet** between one request *finishing* and the next *starting*, measured on a monotonic clock |
| **Never wait forever** | A **10-second timeout** on each request, covering the body as well as the headers |
| **Ask once** | Every page is cached to disk on success; development reruns never touch the site |
| **Check the answer** | Only **HTTP 200** counts as a page. Anything else is a failure, never HTML to parse. |
| **Don't hammer** | A timeout or a **5xx** is retried **once**, after at least **1 second**. A **404** or **403** is never retried. |
| **Stay in scope** | Follows the site's own "next" links from page 1, and stops after page 3 |

### Measured on a live run

Wrapping `fetch` recorded, for all 63 requests of a full run against the real
site: every one returned 200, every one carried the user-agent, and none went
outside `books.toscrape.com/catalogue/`. Quiet time between requests: **median
510 ms, maximum 515 ms, minimum 499 ms**. The site answered each request in a
median of 327 ms.

That minimum is one millisecond short of the rule. See *Known limitations*.

## The record

Every record is checked against a [Zod](https://zod.dev) schema (`src/schema.js`)
before it can be stored. Anything that fails goes to `errors.json` with the
reason, and never into `books.json`.

| Field | Type | Rule |
|---|---|---|
| `title` | string | not empty; taken from the page's `<h1>`, since catalogue cards truncate long titles |
| `product_url` | string | absolute `https` URL on `books.toscrape.com`; the record's identity |
| `price_text` | string | exactly as shown, matching `£NN.NN` |
| `price_gbp` | number | parsed from `price_text`; never NaN, never a string |
| `availability_text` | string | exactly as shown, e.g. `In stock (22 available)` |
| `stock_count` | integer | parsed from `availability_text`, 0 or more |
| `rating_text` | enum | `One` · `Two` · `Three` · `Four` · `Five`, read from the star-rating class name |
| `rating` | integer | 1 to 5 |
| `description` | string or `null` | real text from the page, or `null` when the page has none — never an empty string, never invented |
| `source_page` | string | the catalogue page the book was found on |
| `fetched_at` | string | ISO 8601 time the page was actually downloaded |

The object is strict: an unexpected field is an error. The raw text stays next to
every parsed value, so each number can be traced back to what the page showed.

```json
{
  "title": "A Light in the Attic",
  "product_url": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
  "price_text": "£51.77",
  "price_gbp": 51.77,
  "availability_text": "In stock (22 available)",
  "stock_count": 22,
  "rating_text": "Three",
  "rating": 3,
  "description": "It's hard to imagine a world without A Light in the Attic. ...",
  "source_page": "https://books.toscrape.com/catalogue/page-1.html",
  "fetched_at": "2026-09-13T17:16:44.667Z"
}
```

The parsers are strict on purpose. The price accepts only `£` followed by digits
and two decimals. The shortcut of stripping non-digits and calling `parseFloat`
would read `£51.77 (was £60.00)` as **51.776** — a wrong price that looks valid.
Strict parsing turns it into `null`, the schema rejects it, and it shows up in
`errors.json` instead of in the data.

`price_gbp` is a floating-point number, fine for sorting and comparing. It is not
exact — `51.77` is stored as `51.77000000000000312639` — so anything that adds
prices together should work in integer pence.

## Proof: a real run

Produced by a full run against the live site, with an empty cache:

```json
{
  "started_at": "2026-09-13T17:16:40.095Z",
  "finished_at": "2026-09-13T17:17:34.020Z",
  "duration_ms": 53925,
  "status": "completed",
  "injected_broken_url": false,
  "catalogue_pages": 3,
  "discovered_urls": 60,
  "unique_urls": 60,
  "detail_pages_attempted": 60,
  "requests_attempted": 63,
  "pages_fetched": 63,
  "cache_hits": 0,
  "retries": 0,
  "valid_records": 60,
  "invalid_records": 0,
  "duplicates": 0,
  "failed_pages": 0,
  "failures": []
}
```

`output/` in this repository holds that run's `books.json`, `errors.json` and
`run-report.json`. They came from the code before the last fix commit; neither
of those two fixes changes any count in this report.

And the same scraper with one made-up URL added:

```json
"failed_pages": 1,
"failures": [
  {
    "url": "https://books.toscrape.com/catalogue/this-book-does-not-exist_0/index.html",
    "kind": "http",
    "status": 404,
    "attempts": 1,
    "message": "HTTP 404"
  }
]
```

60 valid records, and a `books.json` byte-for-byte identical to a run without the
broken URL.

## How it survives failure

- **One bad page is skipped.** Each book page is handled on its own. A fetch that
  fails, or a page that fetches but breaks extraction, is recorded in the report
  and the run continues.
- **Output is replaced whole or not at all.** `books.json` is written only after
  every page has been handled, and through a temporary file that is then renamed
  into place. A run that dies part-way leaves the previous `books.json` exactly as
  it was.
- **Reruns are safe.** Records are keyed by their canonical URL and the output is
  rebuilt on every run, never appended to. Running twice gives the same 60
  records, not 120.
- **The report is always written.** Even a run that dies — say, a catalogue page
  that cannot be reached — writes `run-report.json` with `status: "failed"` and
  the reason.

## Known limitations

**The selectors are tied to this site's current markup.** Extraction reads
specific elements inside `.product_main`. If the site were redesigned, pages
would stop matching: records would fail validation and appear in `errors.json`
rather than as quietly wrong data, but the scraper would produce nothing useful
until the selectors were updated.

Other gaps worth being honest about:

- **The live run measured one gap of 499 ms**, one short of the 500 ms rule. The
  delay slept once and went ahead. The cause was not found: timers firing early,
  synchronous work before the timer, and the system clock being adjusted were each
  tested and none reproduced it. The delay now re-checks a monotonic clock after
  every wake-up. That was verified by forcing every timer to fire early: with
  timers 20 ms early, the old code left all 14 gaps under 500 ms and the new code
  none. It was **not** re-verified with another full run against the live site.
- **No real page lacked a description.** All 60 books have one, so the `null`
  path is proven only on a page edited to remove it.
- **Only the "In stock (N available)" wording is recognised.** No scraped page was
  out of stock, so rather than guess that wording, anything else is rejected for a
  human to look at.
- **`fetched_at` for a cached page comes from the cache file's save time.** It is
  set to the exact fetch time when the page is saved, but a tool that resets file
  times — a plain `cp`, for example — would change it.
- **The checks are not committed as automated tests.** Retry rules, pacing, the
  broken-page path, validation and repeatability were verified with scripts
  against a local server and saved pages during development, not captured as a
  test suite.

## Ethics

Scraping is reading someone else's work on someone else's server, so the defaults
should protect them, not me:

- **Use the official API when one exists.** It is the owner telling you how they
  would like their data read.
- **Never bypass a login, a paywall, a CAPTCHA or a block.** Each one is the site
  saying no. A scraper that gets past it is trespassing, however easy it was.
- **Collect only what you need, and only as fast as the site can comfortably
  serve it.** Here that means 63 pages, with a pause between each, once — and
  every rerun after that from the cache.
- **Be identifiable.** A site owner who sees this scraper in their logs can find
  out who runs it and ask them to stop.

## Project layout

```
src/index.js      runs the pipeline and writes the report
src/http.js       the only module that touches the network: pacing, timeout, retry, cache
src/discover.js   finds the catalogue pages and the book links on them
src/extract.js    reads the raw fields off one book page
src/normalize.js  turns raw text into typed values
src/schema.js     the record's shape, checked with Zod
src/store.js      removes duplicates and writes JSON without leaving half-written files
output/           the sample output from the live run above
cache/            saved pages (git-ignored; recreated by any run)
```
