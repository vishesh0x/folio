import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Folio runs on Cloudflare Workers. The Cloudflare plugin runs the SSR
// environment inside workerd during `vite dev`, so D1 / R2 / Images bindings
// behave the same locally as in production.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    // Vite inlines assets under 4 kB as base64 `data:` URIs. A tiny font subset got
    // inlined that way and was blocked by the CSP (`font-src 'self'`), which logged a
    // console error and lowered the Lighthouse Best Practices score. Never inline fonts.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    // The Worker entry (security headers, /media pipeline) is src/server.ts,
    // selected by `main` in wrangler.jsonc.
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
