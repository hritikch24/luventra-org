# SEO maintenance plan: Luventra

Site: https://www.luventra.co
Written 15 Nov 2026 after a live audit of every sitemap page.

## Where the site stands

24 pages, bank pages are the organic entry points.

## Next work for this site

- Add FAQ and HowTo structured data to bank pages, a few banks per release.
- /banks hub is thin (233 words): add a short intro per bank.
- Add a new bank page only when the parser is tested against a real export from that bank. Never claim universal bank import.
- Deploys need the Vercel CLI (Team-Rockstar account), not a git push.

## Rules that keep rankings safe

1. **Small releases.** Change at most about 10% of indexed pages in one deploy. A large sudden change in titles, URLs or copy across the site is the main way to trigger a re-evaluation.
2. **URLs are permanent.** Never rename or delete an indexed URL without a 301 to the closest equivalent. Never redirect many pages to the homepage.
3. **One thing at a time.** Do not change title, H1, body copy and internal links of the same page in the same week. If traffic moves you will not know why.
4. **No mass-produced pages.** No new page families generated from a template with only a place name or keyword swapped. Every new page needs something only it has: data, a photo, a worked example.
5. **True claims only.** Follow the product never_claim list in `marketing/registry/products.json`. No invented reviews, counts or guarantees, in copy or in structured data.
6. **Structured data must match the visible page.** Never mark up a price, rating or FAQ that is not on the page.
7. **Keep robots.txt, sitemap and canonicals boring.** Sitemap lists only indexable 200 pages; lastmod only changes when the page really changed.

## Routine

| When | Check |
|---|---|
| Before every deploy | Build passes; homepage and two inner pages return 200; title, canonical and robots meta unchanged unless that was the point; sitemap still loads |
| Weekly (10 min) | Search Console: indexed pages, new crawl errors, manual actions, clicks vs last week |
| Monthly | Re-run the audit script (`marketing` scratch audit of 15 Nov 2026: status, titles, canonicals, duplicate titles, thin pages, alt text); fix what regressed |
| Quarterly | Refresh the three highest-traffic pages with current facts; check Core Web Vitals in Search Console |

## If traffic drops

1. Check Search Console for a manual action and for a drop in indexed pages.
2. Check what was deployed in the 14 days before the drop.
3. If a deploy lines up, revert that one change and wait two weeks. Do not stack more changes on top.
4. If nothing was deployed, check whether a Google update was announced; if so, wait for it to finish before changing anything.
