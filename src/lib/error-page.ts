/** Static fallback used when SSR itself fails (so we never leak stack traces). */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load · Folio</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <style>
      :root { color-scheme: light dark; }
      body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #faf8f4; color: #1d1a17; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      @media (prefers-color-scheme: dark) { body { background: #151311; color: #efe9e1; } .secondary { background: transparent; color: inherit; border-color: #4a443d; } }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.5rem; margin: 0 0 .5rem; font-weight: 600; }
      p { opacity: .75; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: .5rem; justify-content: center; flex-wrap: wrap; }
      a { padding: .6rem 1.1rem; border-radius: 999px; font: inherit; text-decoration: none; border: 1px solid transparent; }
      a:focus-visible { outline: 3px solid #b0522f; outline-offset: 2px; }
      .primary { background: #9a4526; color: #fff; }
      .secondary { background: #fff; color: #1d1a17; border-color: #d6d0c8; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try again or head back home.</p>
      <div class="actions">
        <a class="primary" href="">Try again</a>
        <a class="secondary" href="/">Go home</a>
      </div>
    </main>
  </body>
</html>`;
}
