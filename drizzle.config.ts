import { defineConfig } from "drizzle-kit";

// Generates SQL migrations for D1 (SQLite). Apply them with Wrangler:
//   npm run db:migrate:local   /   npm run db:migrate:remote
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
});
