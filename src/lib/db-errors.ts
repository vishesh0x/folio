/**
 * Is this error "the database is unavailable or failing" (as opposed to a bug, or a rule like UNIQUE doing its job)?
 * D1 errors are Errors whose message starts with D1_ERROR / D1_EXEC_ERROR / D1_TYPE_ERROR, or mention SQLITE_*; typical outage
 * messages: "Network connection lost", "D1 DB is overloaded", "D1 DB reset", "no such table" (database not migrated yet).
 * Constraint violations are the database working correctly, so they are NOT an outage.
 */
export function isDbUnavailable(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e);
  if (/constraint failed|SQLITE_CONSTRAINT/i.test(m)) return false;
  return /\bD1_[A-Z_]*ERROR\b|D1 DB\b|SQLITE_[A-Z]+|no such table|Network connection lost.*D1|D1.*Network connection lost/i.test(m);
}

/** A page that needs nothing from the database (it cannot fail the same way), for use while the database is unreachable. */
export function unavailablePage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Back in a moment</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 ui-monospace,Menlo,Consolas,monospace;background:Canvas;color:CanvasText}
main{max-width:34rem;padding:2rem}h1{font-size:1.6rem;margin:0 0 .6rem}p{margin:.6rem 0}a{color:inherit}</style></head>
<body><main><h1>Back in a moment.</h1>
<p>The site cannot reach its database right now. This is temporary and nothing you did caused it.</p>
<p>If you were sending a message, <strong>it was not sent</strong>. Use your browser's Back button to keep what you wrote, then try again in a minute.</p>
<p><a href="javascript:location.reload()">Try again</a></p></main></body></html>`;
}
