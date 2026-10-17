import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  session: false, // we keep sessions in D1, so skip the adapter's KV session store
  output: 'server',
  adapter: cloudflare(),
  security: { checkOrigin: false }, // we do our own same-origin check in src/middleware.ts so the refusal can be a designed page
  // Never inline scripts into the HTML: our Content-Security-Policy only allows external files and nonce-tagged scripts.
  // BUILD_ID changes on every build. It is part of the page-cache key and the ETag (src/middleware.ts), so after a deploy no
  // visitor, browser or edge cache is handed old HTML that points at CSS/JS files the new build no longer has.
  vite: { define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) }, build: { assetsInlineLimit: 0 } },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
});
