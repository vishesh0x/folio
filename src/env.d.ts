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
  }
}
declare namespace App {
  interface Locals {
    nonce: string;
    user?: { id: number; email: string };
  }
}

// Set per build in astro.config.mjs (vite.define).
declare const __BUILD_ID__: string;
