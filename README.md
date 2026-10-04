# Folio

A personal portfolio with a built-in content dashboard, running entirely on Cloudflare:

| Concern                                  | Cloudflare product                   |
| ---------------------------------------- | ------------------------------------ |
| App (SSR, server functions, routing)     | **Workers** (TanStack Start + React) |
| Content, sessions, inbox, asset metadata | **D1** (SQLite, via Drizzle ORM)     |
| Uploaded originals (images, résumé PDF)  | **R2**                               |
| Responsive AVIF / WebP / JPEG variants   | **Images** (Workers binding)         |

Public pages: Home · Projects · Project detail · Now · Resume · Contact.
Dashboard (`/dashboard`): site config, SEO, projects (markdown editor), now board, resume builder, inbox, assets.

## Quick start (local)

```bash
npm install
cp .dev.vars.example .dev.vars          # set ADMIN_SETUP_TOKEN
npm run db:migrate:local                # creates the local D1 schema
npm run db:seed:local                   # optional sample content
npm run dev                             # http://localhost:5173
```

Open `/auth`. On a fresh database you'll be asked to create the owner account; it requires the
`ADMIN_SETUP_TOKEN` from `.dev.vars` and only works once. There is no public sign-up.

`vite dev` runs the Worker inside workerd, so D1, R2 and the Images binding all work locally.

## Deploy

```bash
npx wrangler login

npx wrangler d1 create folio-db         # copy the database_id into wrangler.jsonc
npx wrangler r2 bucket create folio-media

npm run db:migrate:remote
npm run db:seed:remote                  # optional

npx wrangler secret put ADMIN_SETUP_TOKEN   # a long random string: openssl rand -base64 32
# edit wrangler.jsonc → vars.SITE_URL = "https://your-domain.com"

npm run deploy
```

Then visit `https://your-domain/auth` and create the owner account.

Notes

- The Images binding must be available on your account (Dashboard → Images). Transformations are billed per
  _unique_ transformation; Folio limits widths to a fixed list ([`src/lib/images.ts`](src/lib/images.ts)) and
  caches every variant for a year, so cost stays small and predictable.
- Attach your custom domain to the Worker (Workers & Pages → folio → Settings → Domains).
- **Forgot your password?** Run
  `npx wrangler d1 execute folio-db --remote --command "DELETE FROM sessions; DELETE FROM admin_users;"`
  and visit `/auth` again to re-run setup (content is untouched).

### Optional: Cloudflare Turnstile on the contact form

Create a Turnstile widget, put the **site key** in `wrangler.jsonc` (`vars.TURNSTILE_SITE_KEY`) and the **secret**
with `npx wrangler secret put TURNSTILE_SECRET_KEY`. The widget script only loads once a visitor starts typing, and
the CSP automatically allows `challenges.cloudflare.com` when a site key is set.

## How images work

1. You upload in the dashboard → the Worker verifies the file by its **magic bytes**, reads dimensions with the
   Images binding, stores the original in **R2** under a unique key, and records it in D1 (with alt text).
2. Pages reference it as `/media/<key>`. The `<Img>` component emits `srcset`/`sizes` for `/media/<key>?w=…`.
3. `/media/<key>?w=640` → Worker reads the original from R2 → **Images binding** resizes + converts to AVIF/WebP
   (by `Accept`, falling back to JPEG/PNG) → result cached in the edge cache, `Cache-Control: immutable`.
4. Everything below the fold is `loading="lazy" decoding="async"`; LCP images use `fetchpriority="high"`.

**Alt text:** every image field has an alt field; the asset library flags images with none; the markdown editor warns
about `![](…)` with empty alt; the site falls back to a descriptive default instead of ever emitting a missing `alt`.

## Project layout

```
wrangler.jsonc            bindings: DB (D1), MEDIA (R2), IMAGES, vars
src/server.ts             Worker entry: security headers, CSP nonce, /media pipeline → app
src/server/               server-only code (auth, crypto, rate limiting, media, upload)
src/lib/*.functions.ts    server functions (public, contact, auth, admin)
src/db/schema.ts          Drizzle schema (D1)      drizzle/migrations/  generated SQL
src/routes/               pages + /robots.txt, /sitemap.xml, /api/admin/upload
seed/seed.sql             sample content
scripts/smoke.mjs         end-to-end security + media smoke test
```

## Scripts

|                                     |                                                                      |
| ----------------------------------- | -------------------------------------------------------------------- |
| `npm run dev` / `build` / `preview` | develop / production build / run the build in workerd                |
| `npm run deploy`                    | build + `wrangler deploy`                                            |
| `npm run db:generate`               | generate a new migration after editing `src/db/schema.ts`            |
| `npm test`                          | unit tests (Vitest)                                                  |
| `npm run typecheck` / `lint`        | TypeScript / ESLint                                                  |
| `node scripts/smoke.mjs`            | end-to-end checks against a running preview (see header of the file) |

See **[AUDIT.md](AUDIT.md)** for the full list of issues found and fixed.
