/// <reference types="astro/client" />
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS_BUCKET: R2Bucket;
    IMAGES: ImagesBinding;
    ADMIN_SETUP_TOKEN?: string;
    TURNSTILE_SITE_KEY?: string;   // optional: public key of a Cloudflare Turnstile widget
    TURNSTILE_SECRET_KEY?: string; // optional: its secret
    TURNSTILE_VERIFY_URL?: string; // tests only: a fake verifier. Leave unset in real use.
    RATE_LIMIT_SALT?: string;      // optional secret: rate-limit counters are stored under a keyed hash of the visitor's network, not the IP address
    PAGE_CACHE_TTL?: string;       // optional: seconds a cached public page counts as fresh (default 300; tests use a short one)
  }
}
declare namespace App {
  interface Locals {
    nonce: string;
    user?: { id: number; email: string };
    challenge?: boolean; // set by the sign-in page when it shows a Turnstile check (so the CSP allows Cloudflare's host)
    degraded?: boolean; // set when an error page had to use placeholder settings; such a response must never be cached
  }
}

// Set per build in astro.config.mjs (vite.define).
declare const __BUILD_ID__: string;
