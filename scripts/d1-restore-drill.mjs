// A fire drill for the database: export it, load the export into a NEW empty database, and compare every table row for row.
// A backup you have never restored is only a hope; this proves the export really can bring the data back.
//
//   node scripts/d1-restore-drill.mjs                       local test copy (.wrangler/e2e-a by default), changes nothing that exists
//   node scripts/d1-restore-drill.mjs --remote              YOUR real database (folio-db): exports it, creates a temporary database "folio-drill-<time>",
//                                                           loads the export into it, compares, then DELETES the temporary database. Your real data is only read.
// Needs `npx wrangler login` for --remote. Exit code 0 means every table matches.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DB = 'folio-db';
const wr = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000, ...opts });
const rows = (target, sql) => {
  const out = JSON.parse(wr(['d1', 'execute', target.name, ...target.flags, '--json', '--command', sql]));
  return out[0].results;
};
const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name";
/** A fingerprint of a whole table: how many rows and a hash of all of them in a fixed order (names come from sqlite_master, never from outside). */
function fingerprint(target) {
  const out = {};
  for (const { name } of rows(target, TABLES)) {
    const all = rows(target, `SELECT * FROM "${name}" ORDER BY rowid`);
    out[name] = { rows: all.length, hash: createHash('sha256').update(JSON.stringify(all)).digest('hex').slice(0, 16) };
  }
  return out;
}

/** Exports `source`, loads it into `restored`, and returns what matched. `source`/`restored` are { name, flags } for wrangler. */
export function drill(source, restored, file, afterExport = () => {}) {
  if (source.exportTo) source.exportTo(file); else wr(['d1', 'export', source.name, ...source.flags, '--output', file]);
  if (!existsSync(file) || readFileSync(file, 'utf8').length < 100) throw new Error('The export is empty.');
  afterExport(file);                       // (tests use this to damage the export and prove the drill notices)
  wr(['d1', 'execute', restored.name, ...restored.flags, '--file', file]);
  const a = fingerprint(source), b = fingerprint(restored), tables = Object.keys(a);
  const mismatched = tables.filter((t) => !b[t] || a[t].rows !== b[t].rows || a[t].hash !== b[t].hash);
  return { tables, mismatched, rows: Object.fromEntries(tables.map((t) => [t, a[t].rows])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const remote = process.argv.includes('--remote'), dir = mkdtempSync(join(tmpdir(), 'drill-')), file = join(dir, 'export.sql');
  let tmpName = '';
  try {
    let source, restored;
    if (remote) {
      tmpName = `folio-drill-${Date.now()}`;
      console.log(`Creating a temporary database ${tmpName} ...`); wr(['d1', 'create', tmpName]);
      source = { name: DB, flags: ['--remote'] }; restored = { name: tmpName, flags: ['--remote'] };
    } else {
      const from = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.wrangler/e2e-a', to = join(dir, 'restored');
      // `d1 export --local` reads wrangler's default state folder and takes no --persist-to, so the test database is copied into a scratch folder laid out that way
      source = { name: DB, flags: ['--local', '--persist-to', from], exportTo: (out) => { const w = join(dir, 'work'); mkdirSync(join(w, '.wrangler'), { recursive: true }); cpSync(from, join(w, '.wrangler', 'state'), { recursive: true }); copyFileSync('wrangler.jsonc', join(w, 'wrangler.jsonc')); wr(['d1', 'export', DB, '--local', '--cwd', w, '--output', out]); } };
      restored = { name: DB, flags: ['--local', '--persist-to', to] };
    }
    console.log('Exporting, restoring into a new empty database and comparing every table ...');
    const r = drill(source, restored, file);
    for (const t of r.tables) console.log(`  ${r.mismatched.includes(t) ? 'DIFFERENT' : 'same     '}  ${t.padEnd(18)} ${r.rows[t]} rows`);
    if (r.mismatched.length) { console.error(`\nFAILED: ${r.mismatched.join(', ')} did not come back identical.`); process.exitCode = 1; } else console.log(`\nOK: all ${r.tables.length} tables restored identically.`);
  } finally {
    if (tmpName) { try { wr(['d1', 'delete', tmpName, '--skip-confirmation']); console.log(`Deleted the temporary database ${tmpName}.`); } catch (e) { console.error(`Could not delete ${tmpName}; delete it in the Cloudflare dashboard (D1).`); } }
    rmSync(dir, { recursive: true, force: true });
  }
}
