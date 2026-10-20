# Folio audit progress

Last updated: 2026-10-20 (Step 2 added) · Baseline: `folio-main.zip` (GitHub export, commit `35ba891`) · Working one step at a time.

## Plan and status

| # | Step | Status |
|---|------|--------|
| 1 | **Security & bot protection** (Turnstile, WAF/rate limits, CORS/CSP/headers) | **Done: audit + Playwright tests** |
| F1 | **Fix round 1: mobile layout of the public site + dashboard visual bugs** (your request, done before Step 2) | **Done: fixed + 124 Playwright tests** |
| F2 | **Fix round 2: Lighthouse findings (LCP, CLS, render-blocking CSS, fonts, CSP beacon) + Mermaid diagrams** | **Done: fixed + 61 Playwright tests** |
| 2 | **Performance: Astro client directives, cache rules, Cloudflare Images** | **Done: audit + fixes + 111 Playwright tests** |
| 3 | Database: SQL injection, indexes (`EXPLAIN QUERY PLAN`), migrations/concurrency, degradation behaviour | Pending |
| 4 | R2: access control, magic-number validation, lifecycle/orphans | Pending |
| 5 | Workers: wrangler config and secrets, CPU limits, Smart Placement | Pending |
| 6 | SEO and accessibility: sitemap/canonical, OG/JSON-LD, semantics, WCAG 2.2 AA, form UX, 44px targets | Pending |
| 7 | Quotas and cost (D1 reads/writes, R2 ops, Workers requests) | Pending |
| 8 | Privacy/legal: cookies and tracking, data deletion/export, privacy policy | Pending |
| 9 | Content and operations: broken links, brand consistency, `npm audit`, backup/restore drill | Pending |

**Skipped as not applicable** (nothing in the codebase to audit): Cloudflare Queues/DLQ and KV (not used), PCI-DSS (no payments), funnel/heat-map tools, conversion-event tracking, bot-filtered analytics (no analytics installed), transactional-email branding (the site sends no email).

## Housekeeping notes

- Two archives were supplied. `folio-main` differs from `folio-redesign` only in `wrangler.jsonc` (real D1 `database_id`, `images` binding reordered) and the favicon. **`folio-main` is the baseline.** Its archive has **no `.gitignore`, no `.dev.vars.example` and no `docs/`**; I restored them from the other archive for local work (see finding S1-M4).
- Everything below was run on the **production build served by `wrangler dev`** (local D1/R2, no real Cloudflare). Nothing was tested against a deployed Worker.
- The project's older Node scripts (`scripts/e2e-*.mjs`, about 237 checks per `docs/PROGRESS.md`) were **not** re-run or changed. The new Playwright suite is independent of them and overlaps only partly.

## Fix round 1: mobile layout and dashboard visuals

Reported: (1) public pages (home, 404, projects, now, resume, contact) and their navbar/footer are not responsive enough on phones; (2) visual errors in the dashboard, shown in 5 screenshots.

**Method:** seeded a local copy with realistic content (your name and 5 socials, a project with a table, code block and 150-character URL, a Now board with a 70-character unbroken word, a resume, an inbox; `tests/seed/demo.sql`), then opened every public and dashboard page at 320, 375, 414 and 768 px in a touch-emulated Chromium, screenshotted them and measured what sticks out past the screen edge and which tap targets are under 44 px. All five of your screenshots were reproduced before changing anything.

### Root causes and fixes

| What you saw | Cause | Fix |
|---|---|---|
| Navbar shows "Vishesh Raghuv…" (image 4) | `.logo` capped at 55 % of screen width with an ellipsis | Name wraps to a second line and scales between 1.05 and 1.4 rem; full name visible at 320, 375, 414 |
| Menu button and theme switch tiny; menu could run off a short screen | Button 32 px tall, theme buttons 27 px; menu had no height limit | 44 px Menu button, 48 px nav rows, 44 px theme buttons, menu scrolls inside the screen, tap outside closes it |
| Footer wraps with a lonely "EDGE", small pills (image 5) | One text run wrapping freely; pills 32 px | Copyright and tagline on two lines on phones, one line on desktop; 44 px pills |
| **Pages scroll sideways** on `/projects/<slug>` (1058 px on a 375 px screen) and `/now` (689 px) | Single-column CSS grids default to `min-width:auto`, so one long word or URL stretched the whole column; Markdown had no wrapping rule | `minmax(0,1fr)` on every single-column grid; long words/URLs wrap inside their box; tables and code scroll inside their own frame |
| Tap targets 24 to 37 px (links, chips, "Show email", TOC, password "Show", "Back" link) | Compact desktop sizing used everywhere | `@media (pointer: coarse)` raises them to 44 px; mouse users keep the compact look |
| Dashboard "Add a category": Icon box sits lower than Name (image 1) | "Icon (optional)" label wrapped to 2 lines in a 7 rem column | Column widened, label on one line, boxes aligned; stacks on phones; placeholder shortened so it is not clipped |
| Dashboard "What to show": chips show a white square, no tick (image 2) | Tick was a fixed **white** SVG on a box coloured `--ink`, which is near-white in dark mode | Tick drawn in the page colour, visible in both themes |
| "Print this page" explanation beside the checkbox, not under it (image 2) | `.check` is `inline-flex`, so the following `<span>` flowed inline | Hint is a block under its checkbox |
| Project Address cut mid-word, "proj / ects/" (image 3) | `word-break: break-all` on the address | Breaks only after `https://`, after the domain and after `/projects/`; verified at 320 px where the domain alone overflowed by 4 px |
| Dashboard Now board 600 px wide on a phone; "…" menu opens off the left edge | Same long-word grid issue; menu anchored right of a left-aligned button | Long text wraps; row actions right-aligned so the menu opens on screen |

Dashboard touch sizes (inputs, buttons, "…" button, filter pills, editor toolbar, jump links) are also 44 px on touch screens.

### Evidence

| | Before | After |
|---|---|---|
| Sideways scroll, public (10 pages x 4 widths) | `/projects/<slug>`, `/now` at every phone width | none |
| Sideways scroll, dashboard (10 pages x 4 widths) | Now board 600/375 px; Projects "…" menu at -81 px | none |
| Playwright | n/a | **232 passed, 0 failed, 7 skipped** over three projects (security, turnstile, responsive), 3.0 min |
| Mutation check (bugs temporarily put back) | n/a | 11 tests failed: project page, Now page and Now board at 4 widths, tick in light and dark, Icon alignment. Source then restored and verified identical |

### Files changed

`src/styles/global.css`, `src/styles/dashboard.css`, `src/layouts/Base.astro` (footer markup), `src/lib/inline-scripts.ts` (tap-outside-closes-menu; the CSP hash is computed from the text at runtime, so it updates itself), `src/pages/auth/index.astro` (touch sizes), `src/pages/dashboard/now.astro` (placeholder), `src/pages/dashboard/projects/[id].astro` (address line-break points).

### Tests added (`tests/e2e/responsive/`, project `responsive`)

- `no-sideways-scroll.spec.ts`: 10 public + 10 dashboard pages at 320/375/414/768; page not wider than screen and nothing past the edge.
- `mobile-nav-footer.spec.ts`: full name visible, menu opens/closes (button, Escape, tap outside, link), fits the screen, scrolls on a 240 px-tall window, desktop bar, resize closes menu, JavaScript-off fallback, footer lines.
- `touch-targets.spec.ts`: 44 x 44 px on public pages, the open menu and seven dashboard pages.
- `dashboard-fixes.spec.ts`: one regression test per screenshot (Icon alignment, tick contrast in both themes, hint placement, address breaks at 320/375/1280, "…" menus on screen).
- The test site now loads `tests/seed/demo.sql`; the Step 1 tests still pass against it. Tool for eyeballing: `npm run shots` (see header of `tests/tools/shots.mjs`).

### Decisions and limits

- Larger touch sizes apply only to touch screens, so the desktop design is unchanged. On phones the "On this page" list on a project is taller (44 px rows).
- Tested in Chromium's touch emulation, **not on real iPhones/Android devices**. Safari-specific quirks (address-bar height, notch) are not covered.
- The demo data has **no uploaded images**, so the home portrait, project covers and inline Markdown images were not exercised at phone width. Worth a quick look once you have real ones.
- `astro check` is not installed in the project, so no separate type-check was run; the production build compiles.
- Not changed on purpose: the Markdown editor toolbar scrolls sideways inside its own bar on phones (by design); native 17 px checkboxes are tapped through their 44 px labels.

## Fix round 2: Lighthouse findings and Mermaid diagrams

Reported: a Lighthouse run on production (render-blocking CSS, lazy-loaded LCP image, blocked analytics beacon, CLS 0.189 on the project page, long font request chain, oversized card images), plus a request for Obsidian-style Mermaid diagrams in projects.

**Method:** measured first, then fixed. A Lighthouse 13.5.0 baseline with real (DevTools) throttling on the unchanged code, plus a small tool that delays image responses by 1.5 s to reproduce the production conditions where a layout shift actually happens (`tests/tools/cls.mjs`). Every number below is from this local copy of the site on the production build, **not from your live site**, so re-run Lighthouse after deploying.

### Findings and fixes

| Lighthouse finding | Cause found | Fix | Result |
|---|---|---|---|
| Render-blocking CSS (`Base.*.css`) | One stylesheet file the page had to download before painting | CSS is now inlined into each page (`build.inlineStylesheets: 'always'`) | render-blocking score 0 → 1; FCP home 1715 → 1077 ms, project page 1866 → 1070 ms |
| LCP image is `loading=lazy`, not prioritised | Home page never marked any card eager (only `/projects` did) | First home card is `eager` + `fetchpriority=high`; the rest stay lazy | verified in the HTML and by test |
| Images 800 px for a 644 px slot | Card `sizes` assumed 3 columns; with 1 or 2 projects the grid stretches the cards | Card `sizes` now follows the card count (1: 34rem, 2: 35rem, 3+: 24rem) | smallest sufficient width is requested (tested) |
| **CLS 0.189 on the project page** | An unloaded `<img>` with `width:auto` is **0 x 0**, so the article body jumped ~600 px down when the cover arrived. (My first fix attempt did not work; a measurement showed the box was still 0 x 0 before load, so I changed the approach and the result is below) | The cover and portrait get a definite width from the file's own size (`--nw/--nh`) | CLS with late images: project page 0.131/0.057 → **0.000**, `/projects` 0.027-0.051 → **0.000** |
| (not in your report) `/projects` shifted 0.03-0.05 | The search box was hidden in the HTML and revealed by JavaScript, pushing the filters down 71 px | Box is reserved by CSS from the first frame (`html.js` is set before paint); no-JS visitors see no dead box | 0.000 |
| Font request chain (HTML → CSS → font) | Code font only discovered through the CSS | CSS no longer in the chain; code font preloaded **only on pages that show code**; Paper Mono already preloaded | critical chain 2368 → 2051 ms and no longer includes CSS or fonts |
| Font swap shifts text | Windows' Consolas is 10 % narrower than Paper Mono | Width-matched fallback faces (`size-adjust`) | layout identical with the web font blocked or loaded |
| Console error: Cloudflare beacon blocked by CSP | Cloudflare Web Analytics injects its script; the CSP did not allow it, so it was also not collecting data | Allowed on **public pages only** (`static.cloudflareinsights.com` for scripts, `cloudflareinsights.com` for reports); not on sign-in or the dashboard | no console error; tested in a real browser |

Lighthouse (local, mobile, DevTools throttling) after: home 100 / 100 / 100 / 100, project page 99 / 100 / 100 / 100 (performance / accessibility / best practices / SEO), CLS 0.000 on both. One chain still shows in Lighthouse (HTML → script): that script is deferred and does not block painting.

### Mermaid diagrams

- Write ` ```mermaid ` fences exactly as in Obsidian. Flowcharts, sequence, class, state, ER, Gantt, mindmap and the rest of Mermaid 12.1.0 work. Pinned to **12.1.0** (newest 12.2.0 was only 5 days old).
- Drawn in the browser, **only when the page has a diagram and it is within about a screen of view**. Pages without diagrams ship none of it (tested: no diagram code, under 30 KB of JavaScript). Served from your own domain, so the strict CSP is unchanged: no CDN, no `unsafe-eval`.
- Follows the site: Paper Mono typeface, your colours, and it redraws when the theme switches between light and dark.
- Safe fallbacks: the source is shown as a normal code block without JavaScript, while loading, and when a diagram has a mistake (with a plain note saying so). Hostile source cannot run script (tested in a real browser). Mermaid's own strict mode is on.
- Accessible: each drawing is an image with a name (uses `accTitle` if you write one), and a "Diagram source" disclosure keeps the text available.
- Phones: diagrams shrink to about half size, then scroll inside their own box; the page never scrolls sideways.
- The editor's **Preview** tab draws diagrams immediately, and the syntax help lists them.
- Cost: the client build grows by 117 on-demand files (5.4 MB on disk, nothing loaded unless needed). The Worker itself stays small: **487 KiB gzipped** (free plan limit is 3 MiB).

### Tests added (`tests/e2e/performance/`, project `performance`) and checks

- `images-and-layout-shift.spec.ts`: eager/lazy per page, card `sizes`, requested width, layout shift with late images on 7 pages at phone and desktop sizes, exact before/after box of cover and portrait, cover never wider than its frame.
- `delivery.spec.ts`: no stylesheet link on 8 pages, font preloads (and only on code pages), fallback fonts, beacon CSP (public yes, sign-in and dashboard no, real-browser load test), JavaScript weight.
- `diagrams.spec.ts`: rendering without console/CSP errors, accessibility, theme switch, phones, no-JS, broken diagram, hostile source, editor preview.
- The test site now has a demo image, covers, a portrait and diagrams (`tests/seed/demo-media.sql`, `demo-cover.png`).
- **Mutation check:** put six of the bugs back at once (external CSS, no beacon allowance, no Mermaid rule, lazy first card, JS-revealed search box, collapsing cover): 31 tests failed, covering all six. Sources then restored and verified.

### Decisions and limits

- **Inlining CSS** adds about 8 KB (compressed) to every page instead of a cacheable file. First visits are faster; repeat page views re-download that 8 KB. The dashboard pages also carry their CSS inline. It also keeps `style-src 'unsafe-inline'` (finding S1-L2) in place for now.
- **Cloudflare Web Analytics** is allowed through one constant (`CF_WEB_ANALYTICS` in `src/middleware.ts`). If you would rather not use it, switch it off in the Cloudflare dashboard and set that constant to `false`. Mention it in the privacy policy either way (Step 8).
- Diagrams are drawn after the page loads, so one that appears while you are looking at it can move the text below it. They are drawn a screen early to avoid that, but a very slow connection can still show it.
- **Whole suite after this round: 293 passed, 0 failed, 7 skipped** (the 7 are the Step 1 `fixme` findings), 4.3 min.
- Local numbers are not field data. Lighthouse on your live site will differ (network, edge cache state). The production `TTFB` of 770 ms in your report is a cache miss on an uncached page; that belongs to Step 2 (cache rules).

## Step 2: Frontend performance (islands, cache rules, images)

Method: read the code, measured every route's headers and every page's JavaScript on the production build, then timed the image route with abusive URLs. All figures are from the local production build (`wrangler dev`), not your live site. **Not verifiable from the repo:** the Cloudflare dashboard settings and real cache-hit ratios (checklist below).

### 2.1 Astro islands: clean, nothing to fix

No `client:load`, `client:visible` or `client:idle` anywhere, and no UI-framework integration; pages are server-rendered HTML plus a few small hand-written scripts. Measured on the real pages (gzipped JavaScript actually downloaded):

| Page | JS files | gzip | Inline scripts |
|---|---|---|---|
| Home, Projects, Now, Resume, Contact, 404 | 1 | 1.1 KB | 1-2 |
| Project page (no diagram) | 2 | 2.3 KB | 2 |
| Project page with diagrams | 2 | 4.3 KB, plus the diagram engine only when a diagram is near the screen | 2 |
| Dashboard (busiest page, Settings/editor) | 2-3 | 5-9 KB | 1 |

Observations (no action needed): dashboard pages also carry the public stylesheet inline (68 KB raw vs 32 KB on public pages), which only the owner pays; the HTML is revalidated on every view (`max-age=0`), so each page view is one Worker request (relevant to Step 7 quotas).

### 2.2 Cache rules: findings and fixes

How it works (correct design): public pages are cached at the edge by the Worker (Cache API) under a **content version** that moves on at every dashboard save, so edits show up immediately and nothing needs purging; browsers always revalidate with a cheap 304; `/_astro/*` is cached for a year as immutable. Per Cloudflare's documentation, Cache Rules do not apply to responses a Worker builds, so using the Cache API here is the right tool.

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| S2-H1 | **High** (cost/abuse) | **The `/media` cache was keyed on the raw URL.** Any extra query string, a different file name, or a width that snaps to the same size created a new entry and re-read the original from R2 and re-encoded it. Anyone can loop `?x=1,2,3…` to burn R2 reads, Worker time and image transformations | Timed locally: first build 4.4 s, cache hit 7 ms, but 6 junk query strings = 6 x ~4.3 s, 6 file names = 6 x ~4.3 s, 6 widths that all snap to 1280 = 6 x ~4.3 s | **Fixed**: one key per (image, snapped width, format) = at most 37 entries per image; file name and extra parameters are ignored |
| S2-M1 | Medium | Unknown or random asset ids hit the database on every request and were never cached | 404 each time, `no-store` | **Fixed**: ids that cannot be real (wrong shape) never reach the database; unknown real-looking ids are remembered for 60 s |
| S2-M2 | Medium (likely, unverified live) | **Weak ETags.** When a CDN compresses a response it can turn our strong ETag into a weak one (`W/"…"`); the old exact-match comparison would then never match, so every revisit re-downloaded the whole page | Code review; compared with RFC 9110 (If-None-Match uses weak comparison). Not reproducible locally | **Fixed**: weak comparison, lists accepted; `*` deliberately not a match for pages |
| S2-M3 | Medium | `/projects/` and `/now/` rendered as separate, uncached copies of the same page (duplicate content, extra Worker work) | `/projects/` had no cache headers at all | **Fixed**: 301 to the single address, query string kept; verified safe against `//evil.example/` style open redirects |
| S2-L1 | Low | A missing page (`/projects/typo`) hit the database every time and had no `Cache-Control` | no headers | **Fixed**: remembered 60 s under the content version (publishing that project shows it immediately); never answered with 304 |
| S2-L2 | Low | `sitemap.xml` ran 4 database queries per request and was cached only in browsers; `robots.txt`, `manifest` and icons likewise. Icon URLs accepted any `?v=` value, each a separate entry | uncached | **Fixed**: kept at the edge per content version; icon names validated; `?v=` ignored for caching |
| S2-L3 | Low | `/favicon.ico` redirect was uncached; browsers request it on their own | no `Cache-Control` | **Fixed**: 1 hour |
| S2-L4 | Low | `/contact` (one-time form token) had no `Cache-Control` | **closes Step 1 S1-L4** | **Fixed**: `private, no-store` |
| S2-L5 | Low | `/media` had no `immutable`, and resized variants no validator | `max-age=604800` only | **Fixed**: `immutable` plus an ETag per variant; 304 on cache hits |

Bug found and fixed while testing my own change: I first stored the "unknown id" marker under `/media/<id>#missing`, but cache keys ignore fragments, so it collided with the cached original and made every not-yet-built variant 404. A regression test now covers it.

Not changed on purpose: `HEAD` requests are not cached (rare); each distinct bot-scanned path (e.g. `/wp-login.php`) still costs one render and database read, which is cheapest to stop with a Cloudflare WAF rule (Step 1 checklist, Step 7); the 5-second in-memory memo of the content version means another data center can show an edit up to ~5 s late.

### 2.3 Images: the pipeline is sound

Every dynamic image goes through `/media` with an explicit width from a fixed ladder (160…2000) and an explicit format, inside `<picture>` (AVIF, then WebP, then the original), with width/height attributes, `alt`, lazy/eager and `fetchpriority` set correctly (fixed in fix round 2). `sizes` matches the real column widths. Share images are 1280 px JPEGs on your own domain. Verified by tests: AVIF/WebP really are those formats and smaller than the original; only ladder widths appear in any page; nothing is upscaled.

Open questions I cannot answer from here: JPEG/WebP/AVIF quality is a single fixed value (82) for every format. AVIF usually looks the same at about 60-70 and is noticeably smaller, so it is worth trying on your real photos (not changed, I cannot see them). Image transformations are billed per unique transformation on Cloudflare's side (Step 7), which the new cache key also keeps down.

### 2.4 Cloudflare dashboard checklist (please check; not visible from the repo)

1. **Custom domain** attached to the Worker. The Cache API does nothing on `*.workers.dev`.
2. **Speed > Optimization: Rocket Loader OFF.** It rewrites script tags, which breaks the hashed inline scripts and the CSP.
3. **Scrape Shield > Email Address Obfuscation OFF.** The site already hides emails behind a click; Cloudflare's injected decoder script would be blocked by the CSP and could break `mailto:` links.
4. **Polish and Mirage OFF** (if present): images are already resized and converted by the site, double processing only adds risk.
5. **Early Hints, HTTP/3 and Brotli ON** (defaults).
6. **Web Analytics:** if you keep it, optionally add a Configuration Rule to exclude `/dashboard` and `/auth` (the CSP already blocks the beacon there).
7. **Check real results after deploy:** `curl -sI https://your-domain/projects` twice and look for `X-Cache: HIT` and an `ETag`; send the ETag back as `If-None-Match` and expect 304; request `/projects/` and expect a 301. Cache API hits do not appear in the dashboard's Caching analytics, so use the `X-Cache` header (or `wrangler tail`) rather than the hit-ratio chart.

### Tests added (`tests/e2e/performance/`)

- `caching.spec.ts`: HIT/MISS and headers on 5 pages, tracking parameters share one copy while other queries never cache, junk query strings create no entries, 304 with strong/weak/listed validators, a dashboard save changes the ETag at once, private pages never cached, 5 redirects plus the open-redirect check, cached 404, static file headers, sitemap/robots/manifest/icons, `/favicon.ico`.
- `image-delivery.spec.ts`: one cache entry per variant (junk query, file names, snapping widths), widths snap to the ladder, bad parameters fall back to the original, 304 on original and variants, malformed and unknown ids, delete purges every cached copy, AVIF/WebP/original markup and real formats, share image, and the fragment-collision regression.
- `islands.spec.ts`: no hydration markers on 8 pages, JavaScript budgets (public 8 KB, dashboard 25 KB gzipped), at most two inline scripts.
- `tests/tools/js-weight.mjs`: prints the table in 2.1 (`BASE=http://localhost:8790 node tests/tools/js-weight.mjs`).

**Results:** whole suite 361 passed, 0 failed, 6 skipped (the Step 1 `fixme` findings, minus S1-L4 which is now fixed and tested). Mutation check (bugs temporarily put back: the fragment key, strong-only ETags, no redirect, raw-URL cache key): 9 tests failed, covering all of them; sources restored and verified.

---

## Step 1: Security & bot protection

### Result per audit item

| Audit item | Verdict | Evidence |
|---|---|---|
| Turnstile: token validated server-side before acting | **Pass** | `lib/turnstile.ts`, used by `/contact` and `/api/reveal`. 17 Playwright tests: missing/empty/non-string/over-long/rejected/reused tokens all refused |
| Turnstile: secret stays server-side | **Pass** | Secret read from `env` (a Wrangler secret), never templated into HTML. Test scans 6 pages and every `/_astro` JS/CSS file for the secret and finds none |
| Turnstile: fail-open vs fail-closed on Cloudflare trouble | **Pass (fails closed)** | Dropped connection, non-JSON answer and a 7 s hang (Worker gives up at ~5 s) all refuse. **Mutation-checked**: making the code fail open turned 4 tests red |
| Turnstile: off when only one key is set | **By design, fail-open** | Documented in code and README (prevents lock-out). Visible on the dashboard overview. Worth knowing: a half-finished setup silently disables the check |
| WAF custom rules / managed rulesets | **Not auditable from the repo** | Lives in the Cloudflare dashboard. Checklist below |
| Edge rate limiting | **Partial** | App-level limits exist and are tested (login 5/15 min, reveal 10/h, contact 5/h, per IP, atomic D1 upsert). No Cloudflare-level rule can be seen from the repo. Weaknesses: S1-M2, S1-M3, S1-M5 |
| CSP | **Pass, strong** | No `unsafe-inline`/`unsafe-eval` in `script-src`; hashes for the 2 inline scripts; per-request nonce only on uncached pages; `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`; Turnstile host allowed only on pages that use it, only when enabled. Real Chromium shows 0 violations on 6 pages and blocks an injected inline script. Weak spots: S1-L2 |
| X-Frame-Options, HSTS, nosniff, Referrer/Permissions-Policy | **Pass** | On all 7 page kinds including the 404 |
| CORS | **Pass** | No `Access-Control-*` header anywhere; preflight not answered; a real browser on another origin cannot read `/api/reveal` |
| CSRF (extra, not on your list) | **Pass, strong** | Middleware requires provable same-origin (`Sec-Fetch-Site`, then `Origin`, then `Referer`). 20+ endpoint/header combinations refused; a real browser form on another site gets 403. **Mutation-checked**: disabling it turned 20 tests red |
| Auth gating (extra) | **Pass** | `/dashboard/*` and `/api/admin/*` unreachable without a session, including `/%64ashboard`, `//dashboard`, `/api/%61dmin/…`, forged cookies, and spoofed same-origin headers |
| Session handling (extra) | **Pass** | `__Host-` cookie, HttpOnly, Secure, SameSite=Lax, path `/`; 256-bit token; only the SHA-256 is stored; new token per login; logout kills the session server-side (a copied cookie stops working) |

### Findings

Severity is my judgement for a single-owner portfolio site. "Test" names the Playwright test that currently sits as `test.fixme` and will turn into a real check when you remove `.fixme`.

**Medium**

- **S1-M1: Test-only variable can disable Turnstile in production.** `lib/turnstile.ts` honours `TURNSTILE_VERIFY_URL` in every build. If it were ever set on the real Worker (typo, copied `.dev.vars`), a verifier of the attacker's choosing would approve every token. Needs deploy access to exploit, so low likelihood, but the fix is one line: honour it only when `import.meta.env.DEV` (or a build flag) is true, and keep the e2e verifier working by running the tests against a dedicated build. *Test: `turnstile.spec.ts` known findings.*
- **S1-M2: Login and API throttles are bypassable with IPv6.** Keys are the raw IP, so each address in a /64 (a single home connection gets billions) gets its own 5-attempt budget. Confirmed live: `::1` and `::2` in the same /64 produced separate rows. Fix: key on the /64 prefix for IPv6. *Test: `throttles.spec.ts`.*
- **S1-M3: No per-account throttle.** Only the client IP is counted, so a botnet (or one IPv6 range, see M2) can try one password per address indefinitely against the only admin account. Login is deliberately not behind Turnstile (documented; sensible, to avoid lock-out). Fix: also count failures per email (for example 20 per hour) and add a Cloudflare rate-limit rule on `POST /auth`. Rated Medium because this throttle is the only control on the sole admin login. A 12+ character password makes real-world risk low. *Test: `throttles.spec.ts`.*
- **S1-M4: Repo has no `.gitignore` (in the archive supplied).** `.dev.vars` (holds `ADMIN_SETUP_TOKEN` and optional Turnstile secret), `node_modules`, `dist`, `.wrangler` are therefore not protected from `git add .`. `.dev.vars.example` is also absent. Fix: commit the `.gitignore` shipped in the first archive (included in the deliverable with Playwright entries added). Check git history for any past commit of `.dev.vars`. If this is just an export artefact and the real repo has the file, ignore this.
- **S1-M5: Raw visitor IPs are stored, and rate-limit rows are never cleaned up.** `login_attempts.key` holds `contact:<ip>`, `reveal:<ip>`, `login:<ip>`. IPs are personal data under GDPR (relevant for Step 8), and the table only shrinks when a successful login clears its own key. Contact and reveal rows live forever and grow with every distinct visitor or bot (relevant for Step 7, D1 storage). Fix: store `HMAC(secret, ip)` instead of the IP, and delete rows older than the longest window (for example inside `createSession`, like the existing session cleanup, or a scheduled Worker).

**Low / hardening**

- **S1-L1: Turnstile `hostname` and `action` are not checked.** Cloudflare's answer names the hostname and action the token was issued for; the code only reads `success`. A token minted on a different site that uses your site key is unlikely, but checking `hostname` closes it. Skipping `action` is documented (Cloudflare's test keys always say `test`); check it only when not using test keys. *Test: `turnstile.spec.ts`.*
- **S1-L2: `style-src 'unsafe-inline'`.** Lets injected inline styles run (CSS exfiltration, UI redress). Removing it means moving inline `style=` attributes to classes or nonces. Low effort-to-risk payoff; do it when convenient. *Test: `headers-csp.spec.ts`.*
- **S1-L3: No `Cross-Origin-Opener-Policy`.** Add `same-origin`. Nothing on the site relies on cross-window access. *Test: `headers-csp.spec.ts`.*
- **S1-L4 (FIXED in Step 2): `/contact` sends no `Cache-Control`.** The page embeds a per-render form token. Cloudflare does not cache HTML by default, but add `private, no-store` so no intermediary or the back/forward cache holds a stale token. *Test: `headers-csp.spec.ts`.*
- **S1-L5: Legacy unsalted SHA-256 password formats are still accepted** (`lib/crypto.ts`, kept for upgrading old hashes). Run `SELECT substr(password_hash,1,14) FROM users;` on the real D1; if it starts with `pbkdf2-sha256`, delete the two legacy branches so a leaked or edited row can never validate against a weak hash.
- **S1-L6 (info): The contact form token is replayable** for 2 hours (one token carried 5 accepted posts in a test). The per-IP limit and Turnstile cover this. No action needed unless you want single-use tokens.
- **Info:** the real D1 `database_id` is committed in `wrangler.jsonc`. It is an identifier, not a secret; fine. HSTS has no `preload` (optional; only add it if every subdomain will be HTTPS forever).

### Cloudflare dashboard checklist (not verifiable from the repo, please check and tell me what you see)

1. **Security → WAF → Managed rules:** Cloudflare Managed Ruleset enabled (free plan has it). Note whether the OWASP ruleset is available on your plan.
2. **WAF custom rules:** none are required for correctness; suggested: challenge or block requests to `/auth` and `/api/reveal` with a bad `User-Agent` or from threat score above ~30.
3. **Rate limiting rules (edge, before the Worker runs):** recommended `POST /auth` ≈ 10/min, `POST /contact` and `POST /api/reveal` ≈ 10/min per IP. Reason: every hostile request currently costs a **D1 write** (the app-level counter), so a flood can use up your D1 write quota (Step 7). The free plan allows 1 rule; make it `POST` to `/auth`, `/contact` and `/api/reveal` in one expression.
4. **Bot Fight Mode** on; **Always Use HTTPS** on; **Minimum TLS 1.2**.
5. **Turnstile widget:** hostnames limited to your real domain; both `TURNSTILE_SITE_KEY` (var) and `TURNSTILE_SECRET_KEY` (secret) set. The dashboard overview shows "On" when both are.
6. **Custom domain** attached (the Cache API does nothing on `*.workers.dev`).
7. After deploy, run `curl -sI https://your-domain/` and confirm Cloudflare is not stripping or duplicating the security headers.

### What was added to the project

```
playwright.config.ts            2 isolated Workers (Turnstile off :8787 seeded with demo data, on :8788) + fake Cloudflare verifier :9911
tests/e2e/auth.setup.ts         creates the admin through the real setup form, saves the session
tests/e2e/helpers.ts            fresh-IP, same-origin/cross-site header helpers, CSP parser
tests/e2e/fixtures.ts           retries wrangler's local-proxy flake (see below); real app 500s still fail
tests/e2e/fake-turnstile.mjs    fake siteverify: success / fail / drop / garbage / slow / one-time tokens
tests/e2e/security/headers-csp.spec.ts     headers, CSP strictness, real-browser CSP violations
tests/e2e/security/auth-gating.spec.ts     URL-trick bypasses, cookie flags, logout, fixation, registration closed
tests/e2e/security/csrf-cors.spec.ts       cross-site POSTs (curl-style and from a real browser page), CORS, open redirect
tests/e2e/security/throttles.spec.ts       login/reveal/contact limits, enumeration, form-token forgery
tests/e2e/turnstile/turnstile.spec.ts      server-side verification, fail-closed matrix, secret not leaked
package.json                    + @playwright/test 1.56.0 (devDependency); scripts test:e2e, test:e2e:only, test:e2e:report
tsconfig.json                   excludes tests/ and playwright.config.ts from `astro check`
.gitignore                      restored + Playwright output folders
```

Run: `npm run test:e2e` (builds, starts both Workers with throwaway databases under `.wrangler/e2e-*`, runs everything). Add `CI=1` in CI. Your real database and `.dev.vars` are never touched.

### Test results

- **109 passed, 0 failed, 7 skipped** for the Step 1 suite (the 7 are the `test.fixme` findings above: S1-M1, M2, M3, L1, L2, L3, L4). Three consecutive full runs, about 51 s each, identical. With the responsive tests added, the whole suite is **232 passed, 7 skipped** (see Fix round 1).
- **Mutation checks** (temporary breakage, then restored and verified identical): Turnstile failing open → 4 tests failed; CSRF check disabled → 20 tests failed.
- Using Playwright 1.56 with the preinstalled Chromium 141.

### Things to know about the test harness

- `wrangler dev` sometimes answers a request with `500 Network connection lost` before the Worker sees it (the earlier author recorded the same flake in `docs/PROGRESS.md`). `fixtures.ts` retries exactly that, and only when the 500 body is not the site's own "Something broke" page, so a real crash still fails. Before the fixture, every full run hit it 2 or 3 times (a different test each time); after it, three consecutive runs were green. The flake can still occur, it is just absorbed, and I did not count how often.
- Tests assume `/api/reveal` for the phone/email returns 404 on a fresh database (no site email is set); with Turnstile on, **400 means the check refused and 404 means the check passed**.
- The throttle tests consume rate-limit budget on throwaway IPs only. Servers are wiped on each start; with `reuseExistingServer` (local default) a warm server keeps its data, which is fine because each test uses its own random IP.

### Not verified in Step 1

Real Cloudflare WAF/rate-limit configuration; the real Turnstile service and widget (the fake verifier copies the documented response shape only); behaviour on `*.workers.dev` vs a custom domain; response headers after Cloudflare's edge has touched them; NVDA/VoiceOver (Step 6).

### Suggested order to fix

1. S1-M4 (commit `.gitignore`, check history for secrets), S1-M1 (one line), S1-L5 (check DB, delete code).
2. S1-M2 and S1-M5 together (they touch the same two functions: key = HMAC of the /64, plus pruning).
3. S1-M3, S1-L1, S1-L4, S1-L3; S1-L2 whenever you next touch styles.
4. The Cloudflare rate-limit rule (checklist item 3) is the single most effective change and needs no code.
