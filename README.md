# Folio

A portfolio and personal site you run yourself on Cloudflare. Visitors get a fast, cached public site. You get a private dashboard to write projects, keep a "Now" page, build a resume, read messages and manage files, with no separate CMS.

- **Public site:** home, projects (Markdown pages), Now, resume, contact form, privacy notice, designed 404/403/500 pages, light/dark/system theme.
- **Dashboard:** overview, inbox, projects, Now board, resume builder, files, settings, search and sharing, backup and restore.
- **Runs on:** Astro (server-rendered) on Cloudflare Workers, with D1 (database), R2 (files) and Cloudflare Images (resizing).

## Contents

1. [Run it on your computer](#1-run-it-on-your-computer)
2. [Deploy to Cloudflare](#2-deploy-to-cloudflare)
3. [Configuration](#3-configuration)
4. [Using the dashboard](#4-using-the-dashboard)
5. [Security notes](#5-security-notes)
6. [Backups and recovery](#6-backups-and-recovery)
7. [Testing and routine checks](#7-testing-and-routine-checks)
8. [Project layout](#8-project-layout)
9. [Licence](#9-licence)

---

## 1. Run it on your computer

You need a recent Node.js (LTS) and npm.

```bash
npm install
cp .dev.vars.example .dev.vars     # then put a long random value (16+ characters) in ADMIN_SETUP_TOKEN
npm run db:local                   # creates the local database tables
npm run build && npm run preview   # http://localhost:8787
```

`npm run dev` may also work. If it fails on your machine, use the build and preview pair above.

Open `/auth`. On a fresh database the page shows **Set up your site**: enter the setup token, your email and a password of at least 12 characters. That creates the only admin account. From then on `/auth` is just the sign-in page.

## 2. Deploy to Cloudflare

You need a Cloudflare account, a domain you can attach to a Worker, and Node.js. From this folder:

```bash
npx wrangler login

npx wrangler d1 create folio-db              # prints a database_id
npx wrangler r2 bucket create folio-assets
```

Then edit `wrangler.jsonc`:

- Put your own `database_id` in the `d1_databases` entry. The value in the repository belongs to the original author.
- Replace `TURNSTILE_SITE_KEY` under `vars` with your own widget key, or delete it if you do not use Turnstile.

Continue:

```bash
npm run db:remote                            # applies migrations 0001 to 0007

openssl rand -base64 32                      # make a setup token and keep it somewhere safe
npx wrangler secret put ADMIN_SETUP_TOKEN    # paste it (must be at least 16 characters)

npm run deploy                               # checks routes, builds, deploys
```

Then:

1. **Attach a custom domain.** `wrangler.jsonc` turns off the `workers.dev` address and preview URLs on purpose, so the site is reachable only on your own domain. In Cloudflare: Workers & Pages, your Worker, Settings, Domains & Routes. Without this step the deployed Worker has no public address.
2. Visit `https://your-domain/auth` and create your admin account with the setup token.
3. In the Cloudflare dashboard, make sure **Images** transformations are enabled for your account (needed for resized pictures).
4. In **Dashboard, Settings**, fill in **Site URL** so canonical links, the sitemap and share previews use your domain.
5. Open a project page and the resume page and check that pictures load. Check that `/icons/32.png` returns an image once you have chosen a favicon.
6. Set `RATE_LIMIT_SALT` (`npx wrangler secret put RATE_LIMIT_SALT`, any long random value) **before** you consider deleting the setup token. Without either secret the site stores visitors' network addresses in the rate-limit table in plain form instead of as a keyed hash, which the default privacy notice says it does not do. With the salt set, you can remove the setup token after your account exists (`npx wrangler secret delete ADMIN_SETUP_TOKEN`); registration is closed once an admin exists anyway.

The page cache and image cache use Cloudflare's Cache API, which only stores things on your own domain. That is another reason to use a custom domain. Check it by loading a public page twice and looking for `X-Cache: HIT` on the second response.

## 3. Configuration

Secrets are never written in `wrangler.jsonc`. Set them with `npx wrangler secret put <NAME>`, and in `.dev.vars` for local work.

| Name | Where | Required | What it does |
|---|---|---|---|
| `ADMIN_SETUP_TOKEN` | secret | for first sign-up | One-time token (16+ characters) to create the admin. With no token, or a short one, nobody can register. |
| `RATE_LIMIT_SALT` | secret | recommended | Rate-limit counters are stored under a keyed hash of the visitor's network. Falls back to the setup token; with neither, addresses are stored unhashed. |
| `TURNSTILE_SITE_KEY` | `vars` in `wrangler.jsonc` | optional | Public key of a Cloudflare Turnstile widget. |
| `TURNSTILE_SECRET_KEY` | secret | optional | Pairs with the site key. **Set both or neither:** with only one the check stays off everywhere, so a half-finished setup cannot lock anyone out. |
| `PAGE_CACHE_TTL` | `vars` | optional | Seconds a cached public page counts as fresh (default 300, allowed 1 to 3600). |
| `TURNSTILE_VERIFY_URL` | test only | no | Fake verifier for the test suite. Leave unset. It is ignored unless a request arrives at localhost. |

**Turnstile** adds a spam check to the contact form, the "Show email / phone" buttons, and the sign-in form after repeated wrong passwords. In the widget settings, add your domain under hostnames. The dashboard overview shows whether the check is on.

**Cloudflare Web Analytics:** the Content-Security-Policy allows its script on public pages. If you do not use it, set `CF_WEB_ANALYTICS` to `false` in `src/middleware.ts`. The default privacy notice mentions it, so edit the notice if you change this.

## 4. Using the dashboard

Open `/dashboard`. Everything is edited there, and saving refreshes the public pages straight away.

| Area | What you do |
|---|---|
| **Overview** | See what is live, unread messages and whether Turnstile is on. |
| **Inbox** | Read messages from the contact form, reply by email, export all as CSV, delete one person's messages or messages older than N days. |
| **Projects** | Write in Markdown with live preview. Draft, publish, feature, reorder, duplicate, export as a `.md` file. |
| **Now board** | Categories with items (current or done), optional progress and dates. |
| **Resume** | Sections and entries, a PDF you upload for download, and how contact details are shown (click to reveal, hidden, or written on the page). The email setting here only affects the resume; the Contact page has its own switch in Settings ("Offer it on the Contact page", on by default). |
| **Files** | Every upload, where each one is used, alt text, and a storage check that finds stray or missing files. |
| **Settings** | Name, headline, bio, highlights, pictures, social links, privacy notice, and whether your email is offered on the Contact page. |
| **Search & sharing** | Title, description, share image and "hide from search" for each main page. |
| **Backup & restore** | Download a zip of your content and files, or restore one. |

**Uploads.** Pictures: PNG, JPEG, WebP, AVIF, GIF, ICO or SVG, up to 10 MB, at most 12,000 px a side and 100 megapixels. PDFs up to 15 MB. File type is decided from the file's bytes, not its name. Images need alt text (or "decorative"). SVGs are sanitised and picture and PDF metadata is removed on upload (see Security notes).

**Markdown** supports headings with a table of contents, tables, task lists, strikethrough, fenced code with highlighting (JavaScript, TypeScript, Python, Bash, JSON, CSS, HTML/XML, SQL, Rust, Go, YAML, diff), `==highlights==`, `%%comments%%`, callouts (`> [!note] Title`), `[[wiki links]]` to other projects, `![[image embeds]]` of uploaded files, and ` ```mermaid ` diagrams. Raw HTML is shown as text, never run. External images become plain links.

**Type.** The site is set in Paper Mono (SIL Open Font License, kept in `src/assets/fonts/OFL-PaperMono.txt`). Code uses JetBrains Mono.

## 5. Security notes

What the code does:

- One admin account. Passwords are hashed with PBKDF2-SHA-256 (100,000 iterations, the Workers limit). Sessions are random, stored only as a hash, last 14 days, and use a `__Host-` cookie that is HttpOnly, Secure and SameSite=Lax. Signing in also leaves a second cookie of the same kind that recognises your browser (180 days, only a hash is stored); see the sign-in lock below.
- Everything under `/dashboard` and `/api/admin` needs a session. Every POST, PUT, PATCH and DELETE must be provably same-origin.
- Wrong passwords are limited per network (5 per 15 minutes) and per account (20 per hour). After the account limit, sign-in is locked for everyone **except** a browser you have signed in from before (the password is still required). Anyone else needs a Turnstile check, or has to wait an hour if Turnstile is off.
- The contact form has a hidden trap field, a timing token, a per-network limit (5 per hour) and optional Turnstile. Messages are stored and shown as plain text.
- Your email and phone are not written into page HTML unless you choose "written on the page". Visitors click "Show" (10 per hour per network).
- A strict Content-Security-Policy is sent with every page. Scripts come from the site itself, fixed hashes, or a per-request nonce.
- Database trouble gives a 503 page and never caches placeholder content.
- Dependencies are installed from the npm registry with integrity hashes, and Mermaid is pinned to one exact version. `npm run deploy` refuses to build if the project contains a page that is not on the expected list.

Known limits to be aware of:

- **Metadata is removed from every picture type and from PDFs.** JPEG, PNG, WebP and GIF are rewritten without location, camera and comment data. In AVIF files the EXIF and XMP items are zeroed in place (the picture is untouched). In PDFs the title, author, producer and date fields and any XMP packet are blanked in place. An AVIF that cannot be checked exactly is refused. Not covered: encrypted PDFs, and PDF properties kept inside compressed object streams. Files uploaded before this change are cleaned by Dashboard, Files, "Remove location data from existing pictures" (it now covers every type above).
- **Sign-in lock.** After 20 wrong passwords for an email in an hour, strangers are locked out for the hour, but a browser you have signed in from before is not (its recognition cookie is separate from the session and survives signing out). If you sign in on a brand-new device during an attack, use Turnstile (both keys) or wait; `DELETE FROM login_attempts` clears the lock (see Backups and recovery).
- **Request size.** Forms are limited to 4 MiB and uploads to 16 MiB. A POST that sends a body without a `Content-Length` header is refused with 411. Adding a Cloudflare WAF or rate-limit rule for `POST /contact`, `/auth` and `/api/reveal` is still sensible.
- Because the `workers.dev` address is off, Cloudflare WAF and rate rules on your own zone apply to all traffic. Keep it that way.

## 6. Backups and recovery

Use more than one layer.

| Layer | Covers | How far back | How |
|---|---|---|---|
| **D1 Time Travel** (automatic) | whole database | 7 days (free plan), 30 (paid), to the minute | `npx wrangler d1 time-travel info folio-db` shows the current bookmark; `npx wrangler d1 time-travel restore folio-db --timestamp=<unix or RFC3339>` rolls back. A restore overwrites the database in place and prints a bookmark: restoring to that bookmark undoes it. Note it down first. |
| **SQL export** | whole database, including the account and sessions | as old as the file you keep | `npx wrangler d1 export folio-db --remote --output=folio-$(date +%F).sql`. Keep one a month somewhere private. |
| **Site backup zip** (Dashboard, Backup & restore) | content and every file, readable with any zip program | as old as the file you keep | Download after big edits. Restoring it is also how you move content to a new site. Never includes your account. Can include visitors' messages if you tick the box: keep such a file private. |

Files in R2 have no automatic history and deleting one is final, so **the site backup zip is your copy of the files**.

**Prove the database backup works** (once, then every few months): `node scripts/d1-restore-drill.mjs --remote` exports your real database, loads it into a temporary new one, compares every table row for row, and deletes the temporary one. Your real data is only read. Without `--remote` it runs on a local test copy.

**After a disaster**

1. A bad edit or mistaken delete: Time Travel if within its window, otherwise the backup zip (Backup & restore, "Check only", then Import).
2. Whole database lost: `npx wrangler d1 create folio-db`, put the new id in `wrangler.jsonc`, `npx wrangler d1 execute folio-db --remote --file=<your export>.sql`, redeploy.
3. Files lost: restore the backup zip. Files return under their original addresses.

**Forgot your password?** There is no email reset. Remove the account and register again with the setup token (set the secret again if you deleted it):

```bash
npx wrangler d1 execute folio-db --remote --command "DELETE FROM users"
```

**Locked out by wrong passwords?** Wait an hour, or clear the counters:

```bash
npx wrangler d1 execute folio-db --remote --command "DELETE FROM login_attempts"
```

**Changed data with raw SQL?** Public pages may be up to 5 minutes old. Refresh at once with:

```bash
npx wrangler d1 execute folio-db --remote --command "INSERT INTO settings (key,value) VALUES ('content_version', strftime('%s','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
```

## 7. Testing and routine checks

Commands run from the project folder. Commands marked remote need `npx wrangler login`.

```bash
npm run check          # type and template check (astro check)
npm run check:routes   # fails if a page exists that is not on the expected list
npm run test:e2e       # builds, then runs the full Playwright suite (about 20 minutes)
npm run test:e2e:only  # the suite without rebuilding
npm run test:e2e:report
```

The suite covers security (sign-in gating, CSRF, headers and CSP, body limits, rate limits), uploads and SVG safety, backup and restore, data and schema, caching and performance, accessibility, SEO and responsive layouts. Helper scripts live in `tests/tools`.

| What | How | How often |
|---|---|---|
| Broken links, including other websites | `node tests/tools/crawl-links.mjs https://your-domain --external` (exit code 1 if something inside the site is broken) | monthly, and after big edits |
| Known weaknesses in dependencies | `npm audit`; update with `npm update <name>` only to versions at least 14 days old | monthly |
| Usage against the free plan's daily limits | Cloudflare dashboard: Workers & Pages metrics, D1, R2, Images | monthly |
| Whole test suite | `npm run test:e2e` | before each deploy |

## 8. Project layout

```
src/pages         public pages, dashboard pages, and small endpoints (robots, sitemap, media, icons)
src/pages/api     reveal (public) and admin/* (owner only)
src/lib           the logic: auth, assets, Markdown, resume, Now board, settings, caching, backup
src/components    shared pieces (image, theme toggle, error view, media field, ...)
src/layouts       Base (public) and Dash (dashboard)
src/scripts       browser code: file picker, diagrams, backup page
src/styles        global.css (public) and dashboard.css (dashboard only)
src/assets/fonts  Paper Mono (variable woff2) and its licence
src/middleware.ts sign-in gate, same-origin check, size check, headers, CSP, page cache
migrations        database tables, applied in order (0001 to 0007)
scripts           route check, restore drill, end-to-end helpers
tests             Playwright suites, fixtures, seed data, measurement tools
wrangler.jsonc    Worker name, bindings (DB, ASSETS_BUCKET, IMAGES), vars
```

## 9. Licence

Released under the [MIT License](LICENSE): you may use, copy, modify and share it, including commercially, as long as the copyright notice stays. It comes with no warranty. The Paper Mono typeface keeps its own licence, the SIL Open Font License (`src/assets/fonts/OFL-PaperMono.txt`), and npm packages are licensed by their authors.
