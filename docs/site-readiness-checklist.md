# Site readiness checklist

A pre-launch pass for any website. Written after an audit of this site found
that **only the homepage linked to `/`** — every other page, including the 404,
was a navigational dead end that had shipped to production unnoticed.

Each item says what to check, why it matters, and a command that answers it.
Commands assume the site is running at `$SITE` (`export SITE=http://localhost:3000`
or the live host) and that `PAGES` lists your routes:

```bash
export SITE=http://localhost:3000
PAGES="/ /dashboard /banks /banks/chase-to-quickbooks /login /privacy /terms /nope"
```

The failures below are real ones found on this site, not hypotheticals. That is
the point: every one shipped, and every one is cheap to catch.

---

## 1. Navigation — can a visitor always get out?

A page with no way back to the product is a lost visitor. This is the single
most common thing to miss, because you always arrive at your own pages from
somewhere else, never cold.

- [ ] **Every page has a clickable logo that links to `/`.** Not to itself.
      A lockup linking to the page you are on is the same dead end wearing a
      logo — this site's dashboard header linked to `/dashboard`.
- [ ] **The 404 page has navigation.** Frameworks ship a bare default. It is
      the page most likely to be hit by accident and least likely to be
      forgiven.
- [ ] **Non-200 pages that humans can reach are navigable too** — 404, 410,
      500, maintenance. A plain-text 410 is fine for a crawler and a dead end
      for a person who followed an old bookmark.
- [ ] **Auth pages link back out.** Someone who lands on `/login` and does not
      want to sign in must be able to reach the product.
- [ ] **No orphan pages** — every route is reachable by clicking from `/`.

```bash
# Every page should report YES/YES.
printf "  %-32s %-6s %-6s %s\n" PAGE HTTP HOME LOGO
for p in $PAGES; do
  html=$(curl -s "$SITE$p"); code=$(curl -s -o /dev/null -w "%{http_code}" "$SITE$p")
  home=$(echo "$html" | grep -c 'href="/"')
  logo=$(echo "$html" | grep -ci 'YOURBRAND')
  printf "  %-32s %-6s %-6s %s\n" "$p" "$code" \
    "$([ "$home" -gt 0 ] && echo YES || echo NO)" \
    "$([ "$logo" -gt 0 ] && echo YES || echo NO)"
done
```

---

## 2. The primary action — can they actually do the thing?

- [ ] **The main action looks like a control.** An upload target with no icon
      and no button reads as a status label. This site's said `PLACE STATEMENT`
      in 11px mono caps and people did not know a file went there.
- [ ] **The main action is the heaviest element on the page.** If a placeholder
      or an empty state is visually larger than the thing you want clicked, the
      weighting is inverted.
- [ ] **The completing action is visible without scrolling, after the user
      acts.** Measure it — do not eyeball it. On this site the download button
      landed at y=776 in an 809px viewport: technically on screen, effectively
      invisible, and below the fold on any smaller laptop.
- [ ] **Empty states say what happens next**, not just that nothing is there.
- [ ] **Disabled controls explain what would enable them.**

```bash
# In devtools, after performing the main action:
const b = [...document.querySelectorAll('button,a')]
  .find(e => /^(Download|Generate|Submit|Continue|Buy)/i.test(e.textContent.trim()));
const r = b.getBoundingClientRect();
({ top: Math.round(r.top), viewport: innerHeight,
   comfortablyVisible: r.top > 60 && r.bottom < innerHeight - 60 });
```

---

## 3. Responsive — check widths, not "mobile"

- [ ] **No horizontal overflow at 390px, 768px, 1024px.**
- [ ] **Fixed-width table columns have a `min-width` and a scrolling wrapper.**
      Fixed widths totalling more than the viewport silently crush `auto`
      columns to zero. On this site the Description column — the most useful
      field — computed to exactly `0px` on a phone.
- [ ] **Single-row headers do not wrap.** A bar sized for one line becomes
      three on a phone; this site's went 41px → 76px with the text running
      together.
- [ ] **Tap targets are at least 44×44px.**
- [ ] **Test in a real viewport.** Browser window resizing often does not
      change the rendered viewport; same-origin iframes at exact widths do,
      because media queries respond to the iframe.

```bash
# Paste in devtools: measures real layout at device widths.
for (const [w,h,label] of [[390,844,'phone'],[820,1100,'tablet']]) {
  const f = document.createElement('iframe');
  f.src = location.pathname; f.width = w; f.height = h;
  document.body.append(f);
  await new Promise(r => f.addEventListener('load', r, { once: true }));
  const d = f.contentDocument.documentElement;
  console.log(label, 'overflowX:', d.scrollWidth - d.clientWidth);
}
```

---

## 4. Contrast and theme

- [ ] **Body text is at least 4.5:1 against its actual background**, large text
      and UI at 3:1. Disabled controls are exempt.
- [ ] **Status colours match the theme's ground.** A palette tuned for dark
      (`emerald-400`, `rose-400`) fails on white; the 600 ramp is the light
      equivalent. Inverting a theme without moving these leaves pale,
      unreadable status text.
- [ ] **No same-on-same after a theme change.** A find-and-replace inversion
      produced `bg-white` buttons with `text-white` labels here — invisible.
- [ ] **Hierarchy survives greyscale.** If removing colour flattens the page,
      the hierarchy was carried by colour alone; use size, weight and spacing.
- [ ] **Browsers may report `lab()` from `getComputedStyle`.** Parsing those
      numbers as RGB yields nonsense — convert `L*` properly, or a broken
      checker will tell you near-black on white is 1.5:1.

```js
// Contrast sweep. Handles lab() and rgb().
const Y = css => { const m = css.match(/^lab\(\s*([\d.]+)/);
  if (m) { const L = +m[1]; return L > 8 ? ((L + 16) / 116) ** 3 : L / 903.3; }
  const p = css.match(/[\d.]+/g); if (!p) return null;
  const [r,g,b] = p.slice(0,3).map(v => (v/=255) <= .03928 ? v/12.92 : ((v+.055)/1.055) ** 2.4);
  return .2126*r + .7152*g + .0722*b; };
document.querySelectorAll('p,span,a,td,h1,h2,h3,button,label').forEach(el => {
  if (!el.textContent.trim() || el.children.length || !el.offsetParent) return;
  let n = el, bg = 'rgba(0, 0, 0, 0)';
  while (n && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
  const a = Y(getComputedStyle(el).color), b = Y(bg); if (a == null || b == null) return;
  const hi = Math.max(a,b), lo = Math.min(a,b), ratio = (hi + .05) / (lo + .05);
  if (ratio < 4.5) console.warn(ratio.toFixed(2), el.textContent.trim().slice(0,40), el);
});
```

Expect false positives from `sr-only` text and disabled controls; check each
rather than trusting the count.

---

## 5. SEO and metadata

- [ ] **Exactly one `<main>` per page.** Nesting them is invalid HTML and a
      duplicate landmark — this site had nested `<main>` on 21 routes.
- [ ] **Heading order has no gaps** (h1 → h2 → h3), one h1 per page.
- [ ] **Canonical host matches the serving host.** If the site serves `www` and
      canonicals say apex, every canonical points at a redirect. Check the
      final URL, not the one you typed.
- [ ] **Sitemap URLs return 200, not 3xx.** Every URL here returned `308`
      because of that apex/www mismatch.
- [ ] **Hub and index pages are in the sitemap.** `/banks` was missing while
      all 20 pages it links to were listed.
- [ ] **`robots.txt` exists and names the sitemap.** This one 404'd, so the
      sitemap had no discovery path at all.
- [ ] **No noindexed URL appears in the sitemap.**
- [ ] **Two pages do not serve the same content indexably.** Duplicates split
      ranking signals; pick one and noindex the other.
- [ ] **`og:image` exists.** A page-level `openGraph` block silently suppresses
      a framework's file-based image convention — check the pages that declare
      their own metadata, which are usually the ones most worth sharing.
- [ ] **Structured data parses** and sits on the public page, not an app
      surface behind auth.

```bash
for p in $PAGES; do
  html=$(curl -s -L "$SITE$p")
  printf "  %-30s main=%s h1=%s canonical=%s og:image=%s\n" "$p" \
    "$(echo "$html" | grep -c '<main')" "$(echo "$html" | grep -c '<h1')" \
    "$(echo "$html" | grep -o 'rel="canonical" href="[^"]*"' | sed 's/.*href="//;s/"//')" \
    "$(echo "$html" | grep -c 'og:image')"
done
# Sitemap URLs must all be 200:
curl -s "$SITE/sitemap.xml" | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' \
  | while read u; do printf "  %-60s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' "$u")"; done
```

---

## 6. Forms and state

- [ ] **Every input has a label** (visible or `sr-only`).
- [ ] **Errors say what to do**, appear next to the field, and use `role="alert"`.
- [ ] **Submit is disabled while in flight** and says so.
- [ ] **Success is unmistakable** and says what happens next.
- [ ] **Config-missing states are honest.** A form that cannot work should say
      why rather than failing on submit — but check it is not showing in
      production, which is how this site's live sign-in page ended up telling
      visitors to copy `.env.example`.

---

## 7. Analytics and instrumentation

- [ ] **Event values match the database constraint.** A new enum value the DB's
      `CHECK` rejects means every row is silently dropped. Add the value in a
      migration first, or send an accepted one.
- [ ] **Events fire on outcomes, not intents** — on a completed download, not a
      button click.
- [ ] **No PII in event payloads.** Coarse buckets instead of exact values.

---

## 8. Before every deploy

- [ ] Type check passes.
- [ ] Production build passes.
- [ ] Tests pass.
- [ ] Section 1's navigation sweep is clean.
- [ ] The primary action was performed end to end against the built site, not
      the dev server.
- [ ] Env vars the build inlines are set in the deploy environment. Build-time
      values need a **redeploy**, not a restart.

---

## The general lesson

Every failure above was invisible from the inside. They survived because the
person checking always arrived with context: knowing where the upload was,
knowing the URL, having the env set, never landing on the 404.

The cheap defence is to check the rendered output rather than the source, with
a command that returns a value you can read at a glance. A grep for `href="/"`
across every route would have caught the dead ends the day they shipped.
