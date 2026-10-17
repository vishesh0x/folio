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
