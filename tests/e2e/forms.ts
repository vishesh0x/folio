/** Read the project editor's form the way a browser would, so a test can edit it and submit it. */
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');
export function editorFields(html: string): Record<string, string> {
  const start = html.indexOf('<form method="post" id="editor"');
  const form = html.slice(start, html.indexOf('</form>', start));
  const out: Record<string, string> = {};
  for (const m of form.matchAll(/<input\b[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(m[0])?.[1]; if (!name) continue;
    const type = /\btype="(\w+)"/.exec(m[0])?.[1] ?? 'text';
    if (type === 'checkbox') { if (/\bchecked\b/.test(m[0])) out[name] = /\bvalue="([^"]*)"/.exec(m[0])?.[1] ?? 'on'; continue; }
    out[name] = decode(/\bvalue="([^"]*)"/.exec(m[0])?.[1] ?? '');
  }
  for (const m of form.matchAll(/<textarea\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) out[m[1]] = decode(m[2]);
  for (const m of form.matchAll(/<select\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) out[m[1]] = decode(/<option[^>]*\bvalue="([^"]*)"[^>]*\bselected\b/.exec(m[2])?.[1] ?? '');
  return out;
}
