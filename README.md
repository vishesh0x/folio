# Folio: portfolio and personal site on Cloudflare

Astro (server-rendered) on **Cloudflare Workers**, with **D1** (database), **R2** (file storage) and **Cloudflare Images** (resizing and format conversion).
Public site: home, projects (with Markdown project pages), now, resume, contact, designed error pages, light/dark/system theme.
Private dashboard: overview, projects editor, Now board, resume builder, inbox, search & sharing, settings, files. Upload a picture or PDF right where you need it (project cover, resume PDF, portrait, favicon, or inside your Markdown text); the Files page lists everything and where each file is used.

Progress notes for every build step are in `docs/PROGRESS.md`.

## 1. Run it on your computer

```bash
npm install
cp .dev.vars.example .dev.vars        # then edit: put a long random value in ADMIN_SETUP_TOKEN
npm run db:local                      # creates the local database tables
npm run build && npm run preview      # http://localhost:8787
```
(`npm run dev` may also work; if it fails on your machine, use the build + preview pair above.)

Open `/auth`. The very first visit shows **Set up your site**: enter the setup token, your email, and a password (at least 12 characters). That creates the only admin account. After that `/auth` is just the sign-in page.

## 2. Put it on Cloudflare

You need a free Cloudflare account and Node.js. In this folder:

```bash
npx wrangler login

npx wrangler d1 create folio-db                 # prints a database_id: paste it into wrangler.jsonc
npx wrangler r2 bucket create folio-assets
npm run db:remote                               # creates the tables (migrations 0001 to 0005)

openssl rand -base64 32                         # make a setup token and keep it somewhere safe
npx wrangler secret put ADMIN_SETUP_TOKEN       # paste that token

npm run deploy                                  # also checks that no stray test pages are in the project
```
Then:
1. Visit `https://<your-worker>.workers.dev/auth` and create your admin account with the token.
2. In the Cloudflare dashboard, make sure **Images** transformations are enabled for your account (needed for resized pictures).
3. **Recommended: add a custom domain** to the Worker (Workers & Pages, your Worker, Settings, Domains), then set **Site address** in Dashboard, Site settings. The site's page cache and image cache use Cloudflare's Cache API, which, as I understand Cloudflare's documentation, only stores things on your own domain and not on `*.workers.dev`. Everything still works on `workers.dev`; it is just not cached there, so pages are a little slower. Check this after deploying (look for the `X-Cache: HIT` header on a public page when you load it twice).
4. Optional **Turnstile** spam check, used on the contact form **and** on the "Show email / phone" buttons (where your contact details are hidden, on `/contact` and `/resume`): create a free Turnstile widget, set `TURNSTILE_SITE_KEY` as a variable in `wrangler.jsonc` (`"vars"`) and run `npx wrangler secret put TURNSTILE_SECRET_KEY`. **Set both or neither**: with only one, the check stays off everywhere, so nobody can be locked out by a half-finished setup. In the Turnstile widget settings, add your domain under hostnames. The dashboard overview shows whether it is on.
5. After the first deploy, open a project page and the resume page, and check that pictures load, and that `/icons/32.png` returns an image once you have chosen a favicon.

You can delete the `ADMIN_SETUP_TOKEN` secret after your account exists (`npx wrangler secret delete ADMIN_SETUP_TOKEN`); registration is closed anyway once an admin exists.

## 3. Day to day

- **Type:** the whole site is set in **Paper Mono** (SIL Open Font License; the licence is kept in `src/assets/fonts/OFL-PaperMono.txt`). Code blocks, inline code and the Markdown editor use JetBrains Mono, because code needs a code face. Paper Mono has no italic, so emphasis is drawn as an underline instead of a slant.
- **Everything is edited in the dashboard** at `/dashboard`. Saving anything refreshes the public pages immediately.
- **Public pages are cached** at the edge for speed. If you ever change data with a raw SQL command instead of the dashboard, the pages may be up to 5 minutes old; to refresh at once run:
  `npx wrangler d1 execute folio-db --remote --command "INSERT INTO settings (key,value) VALUES ('content_version', strftime('%s','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value"`
- **Forgot your password?** There is no email reset. Remove the account and register again with the setup token (set the secret again if you deleted it):
  `npx wrangler d1 execute folio-db --remote --command "DELETE FROM users"`
- **Files you upload** live in R2. Images are resized and converted by Cloudflare Images; SVGs are cleaned on upload.

## 4. Safety notes

- The dashboard is behind a login. Passwords are stored with PBKDF2; sessions are random and stored hashed.
- Every form is protected against cross-site requests; a strict Content-Security-Policy is sent with every page.
- Your email and phone number are never written into page HTML (visitors click "Show"), unless you choose "written on the page" in the resume options.
- Contact messages are plain text, are never run as code, and are limited to 5 per visitor per hour.

## Layout of the code

```
src/pages        public pages, dashboard pages, and small endpoints (robots, sitemap, media, icons)
src/lib          the logic: auth, assets, markdown, resume, now board, settings, caching
src/components   shared pieces (image, theme toggle, error view, ...)
src/styles       global.css (public) and dashboard.css (dashboard only)
src/scripts      media.ts: the shared upload-or-choose picker used by every file field
src/assets/fonts Paper Mono (variable woff2) and its licence
migrations       database tables, applied in order
```

## Operations: backups, restores and routine checks

Everything here is also covered by tests (see `audit-progress.md`, Steps 8 and 9). Commands run from the project folder; `--remote` ones need `npx wrangler login`.

### Three layers of backup (use more than one)

| Layer | Covers | How far back | How |
|---|---|---|---|
| **D1 Time Travel** (automatic, always on) | the whole database | 7 days (free plan), 30 (paid), to the minute | `npx wrangler d1 time-travel info folio-db` shows the current bookmark; `npx wrangler d1 time-travel restore folio-db --timestamp=<unix or RFC3339>` rolls back. **A restore overwrites the database in place** and prints a bookmark: restoring to that bookmark undoes it. Note it down first. It cannot make a copy. |
| **SQL export** | the whole database (accounts, sessions included) | as old as the file you keep | `npx wrangler d1 export folio-db --remote --output=folio-$(date +%F).sql`. Keep one a month somewhere private. |
| **The site backup zip** (Dashboard > Backup & restore) | content and every file, readable with any zip program | as old as the file you keep | Download after big edits. Restoring it is also how you move the content to a new site. Never includes your account. Can include visitors' messages if you tick the box: keep such a file private. |

Files in R2 have no automatic history (deleting one is final), so **the site backup zip is your copy of the files**.

### Prove the database backup works (do this once, then every few months)

`node scripts/d1-restore-drill.mjs --remote` exports your real database, loads it into a temporary new one (`folio-drill-<time>`), compares every table row for row, and deletes the temporary one. Your real data is only read. Without `--remote` it does the same on a local test copy.

### Restoring after a disaster

1. Something wrong with recent changes (a bad edit, a mistaken delete): **Time Travel** if it was within 7 days, otherwise the site backup zip (Dashboard > Backup & restore > "Check only", then Import).
2. The whole database lost: create a new one (`npx wrangler d1 create folio-db`), put its id in `wrangler.jsonc`, `npx wrangler d1 execute folio-db --remote --file=<your export>.sql`, then redeploy.
3. Files lost: restore the site backup zip (files are added back under their original addresses).

### Routine checks

| What | How | How often |
|---|---|---|
| Broken links, including links to other websites | `node tests/tools/crawl-links.mjs https://visheshraghuvanshi.in --external` (run on your own computer; exit code 1 if something inside the site is broken) | monthly, and after big edits |
| Known weaknesses in what the site is built from | `npm audit` (the advisories that remain are listed in `audit-progress.md`); update with `npm update <name>` only to versions at least 14 days old | monthly |
| Real usage against the free plan's daily limits | Cloudflare dashboard: Workers & Pages > folio > Metrics; D1 > folio-db > Metrics; R2; Images (see Step 7) | monthly |
| Whole test suite | `npm run test:e2e` (about 20 minutes) | before each deploy |
