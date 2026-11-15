# Roadmap: Luventra

Written 15 Nov 2026. This is the forward plan; `SEO-MAINTENANCE.md` beside it holds the release rules that every item here must follow (small releases, permanent URLs, no templated page families, true claims only).

## Now to 3 months

- Ship the held statement settings panel (currency, date-order detection) once the Neon DATABASE_URL is confirmed in production.
- Sample CSV and before/after preview on every bank page.

## 3 to 6 months

- PDF statement input, parsed in the browser like CSV is today.
- Saved per-bank mapping profiles so a returning user converts in one click.
- Xero and Wave targets alongside QuickBooks formats.

## 6 to 12 months

- Rules that categorise transactions before export, learned from the user's own corrections and kept on their device.
- A small API or CLI for bookkeepers who convert many statements a month.

## Across all of it

- **AI search readiness.** Keep `llms.txt` current, keep each page answering one question plainly near the top, and keep structured data matched to what is visible. Assistants cite pages that state facts clearly with a source.
- **Agent readiness.** Forms and tools should work for an assistant acting for a user: labelled inputs, no hover-only controls, clear success and error states.
- **Proof over claims.** Every new feature page shows a real example. Nothing is announced before it works.
- **Measure before building the next step.** Each stage starts only when the previous one shows use in metrics or Search Console.
- **Ideas here are proposals, not commitments.** The owner decides which go ahead; anything involving payment, pricing or new spend needs the owner's yes first.
