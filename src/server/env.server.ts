import { env } from "cloudflare:workers";

/** Bindings + variables declared in wrangler.jsonc, plus secrets. */
export interface AppEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: ImagesBinding;
  SITE_URL?: string;
  TURNSTILE_SITE_KEY?: string;
  /** Secret: required once to create the first admin account. */
  ADMIN_SETUP_TOKEN?: string;
  /** Secret: optional Turnstile secret for the contact form. */
  TURNSTILE_SECRET_KEY?: string;
}

export const getEnv = () => env as unknown as AppEnv;
