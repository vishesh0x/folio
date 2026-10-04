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
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    // The Worker entry (security headers, /media pipeline) is src/server.ts,
    // selected by `main` in wrangler.jsonc.
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
