# Polite scraper

A small scraping pipeline for Books to Scrape: fetch, extract, normalize,
validate, store, report.

FlyRank internship, Backend track, Week 5, Assignment A9. JavaScript lane.

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
