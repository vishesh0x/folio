// Backup & restore, in the browser. A backup is an ordinary .zip file: JSON for the text content, and the original files, so it can be opened with any
// zip program. The page builds and reads that zip itself and talks to the server only in small pieces (src/lib/backup.ts), which keeps every request
// far inside the Worker's limits however big the site is.

/* ───── zip: writer (stored, uncompressed: pictures are compressed already) and reader (stored or deflated) ───── */
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const enc = new TextEncoder(), dec = new TextDecoder();
const MAX_TOTAL = 900 * 1024 * 1024;     // a browser holds the whole zip in memory; refuse to build or open anything bigger

export function makeZip(entries: { name: string; data: Uint8Array }[]): Blob {
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts: BlobPart[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), crc = crc32(e.data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, e.data.length, true); h.setUint32(22, e.data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, e.data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, e.data.length, true); c.setUint32(24, e.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name); offset += 30 + name.length + e.data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export async function readZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf), u8 = new Uint8Array(buf); let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That is not a zip file.');
  const count = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error('This zip uses the "zip64" format, which is not supported. Make a new backup with this page.');
  if (count > 6000) throw new Error('That zip has too many files to be a backup.');
  const out = new Map<string, Uint8Array>(); let total = 0;
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('That zip is password-protected.');
    if (name.length > 220 || name.startsWith('/') || name.split('/').some((s) => s === '..' || s === '.') || name.includes('\\')) throw new Error(`The zip contains an unsafe file name: ${name.slice(0, 60)}`);
    total += usize; if (total > MAX_TOTAL) throw new Error('That zip is too big to open in a browser.');
    if (v.getUint32(lo, true) !== 0x04034b50) throw new Error('The zip file is damaged.');
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = u8.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error(`The zip uses an unsupported compression (${method}).`);
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`"${name}" in the zip is damaged (its checksum does not match).`);
    out.set(name, data);
  }
  return out;
}

const sha256 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

/* ───── talking to the server ───── */
async function api(method: 'GET' | 'POST', url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ ok: false, error: `The server answered ${r.status}.` }));
  if (!r.ok && !j.problems) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
}
async function pages(part: string): Promise<any[]> {
  const items: any[] = []; let after = 0;
  for (let guard = 0; guard < 500; guard++) { const j = await api('GET', `/api/admin/backup?part=${part}&after=${after}`); items.push(...j.items); if (j.next == null) break; after = j.next; }
  return items;
}
const say = (el: HTMLElement | null, text: string) => { if (el) el.textContent = text; };
const json = (v: unknown) => enc.encode(JSON.stringify(v, null, 1));

/* ───── export ───── */
async function exportAll(withMessages: boolean, status: HTMLElement) {
  const files: { name: string; data: Uint8Array }[] = [];
  say(status, 'Reading your content…');
  const [site, resume, now, counts] = await Promise.all(['site', 'resume', 'now', 'summary'].map((p) => api('GET', `/api/admin/backup?part=${p}`)));
  const projects = await pages('projects'), assets = await pages('assets'), messages = withMessages ? await pages('messages') : null;
  const put = (name: string, v: unknown) => files.push({ name, data: json(v) });
  put('site.json', { settings: site.settings, seo_pages: site.seo_pages }); put('projects.json', { items: projects }); put('resume.json', { sections: resume.sections }); put('now.json', { categories: now.categories }); put('assets.json', { items: assets });
  if (messages) put('messages.json', { items: messages });
  let bytes = 0, done = 0, failed: string[] = [];
  const queue = assets.slice();
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let a; (a = queue.shift()); ) {
      const r = await fetch(`/media/${a.id}/${encodeURIComponent(a.filename)}`).catch(() => null);
      if (!r || !r.ok) { failed.push(a.filename); continue; }
      const data = new Uint8Array(await r.arrayBuffer()); bytes += data.length; if (bytes > MAX_TOTAL) throw new Error('The files are too big to collect in a browser. Delete files you no longer need first.');
      files.push({ name: `files/${a.id}/${a.filename}`, data }); say(status, `Collecting files… ${++done} of ${assets.length}`);
    }
  }));
  if (failed.length) throw new Error(`Could not read ${failed.length} file(s): ${failed.slice(0, 3).join(', ')}. Nothing was downloaded; try again.`);
  const sums: Record<string, string> = {}; for (const f of files) sums[f.name] = await sha256(f.data);
  const manifest = { format: 'folio-backup', version: 1, created_at: new Date().toISOString(), includes_messages: !!messages, counts: { ...counts, messages: messages ? messages.length : null }, sha256: sums };
  files.unshift({ name: 'manifest.json', data: json(manifest) });
  files.push({ name: 'README.txt', data: enc.encode('A backup of a Folio site. Open it with any zip program; the text content is in the .json files and the original files are in files/. Restore it from Dashboard > Backup & restore. If it includes messages.json it contains visitors\' personal data: keep it private.\n') });
  const blob = makeZip(files), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `folio-backup-${new Date().toISOString().slice(0, 10)}.zip`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { files: files.length, bytes: blob.size, counts: manifest.counts };
}

/* ───── import ───── */
type Parsed = { manifest: any; site?: any; projects?: any[]; resume?: any[]; now?: any[]; assets?: any[]; messages?: any[]; zip: Map<string, Uint8Array> };
async function parseBackup(buf: ArrayBuffer): Promise<Parsed> {
  const zip = await readZip(buf), m = zip.get('manifest.json');
  if (!m) throw new Error('This zip is not a backup made by this page (it has no manifest.json).');
  const manifest = JSON.parse(dec.decode(m));
  if (manifest.format !== 'folio-backup') throw new Error('This zip is not a Folio backup.');
  if (!Number.isInteger(manifest.version) || manifest.version > 1) throw new Error('This backup was made by a newer version of the site; update the site first.');
  for (const [name, sum] of Object.entries<string>(manifest.sha256 ?? {})) { const d = zip.get(name); if (!d) throw new Error(`The backup is incomplete: "${name}" is missing.`); if (await sha256(d) !== sum) throw new Error(`"${name}" was changed after the backup was made.`); }
  const read = (n: string) => { const d = zip.get(n); return d ? JSON.parse(dec.decode(d)) : undefined; };
  return { manifest, zip, site: read('site.json'), projects: read('projects.json')?.items, resume: read('resume.json')?.sections, now: read('now.json')?.categories, assets: read('assets.json')?.items, messages: read('messages.json')?.items };
}
type Choice = { files: boolean; site: boolean; projects: false | 'replace' | 'add'; resume: boolean; now: boolean; messages: boolean };
type Total = { added: number; updated: number; skipped: number; problems: string[] };
async function runImport(p: Parsed, c: Choice, dry: boolean, status: HTMLElement): Promise<Total> {
  const t: Total = { added: 0, updated: 0, skipped: 0, problems: [] };
  const take = (r: any, label = '') => { t.added += r.added ?? 0; t.updated += r.updated ?? 0; t.skipped += r.skipped ?? 0; for (const x of r.problems ?? []) t.problems.push(label + x); };
  if (c.files && p.assets) {
    let n = 0;
    for (const a of p.assets) {
      say(status, `${dry ? 'Checking' : 'Restoring'} files… ${++n} of ${p.assets.length}`);
      const data = p.zip.get(`files/${a.id}/${a.filename}`); if (!data) { t.skipped++; t.problems.push(`${a.filename}: the file is not in the backup.`); continue; }
      if (dry) { if (data.length > 15 * 1024 * 1024) { t.skipped++; t.problems.push(`${a.filename}: larger than the 15 MB limit.`); } else t.added++; continue; }
      const f = new FormData(); f.set('file', new File([data as BlobPart], a.filename, { type: a.mime })); f.set('id', a.id); f.set('alt', a.alt ?? ''); f.set('decorative', a.decorative ? '1' : '0'); if (a.created_at) f.set('created_at', String(a.created_at));
      const r = await fetch('/api/admin/backup-file', { method: 'POST', body: f }).then((x) => x.json()).catch(() => ({ ok: false, error: 'the upload failed' }));
      if (r.ok && r.added) t.added++; else if (r.ok) t.skipped++; else { t.skipped++; t.problems.push(`${a.filename}: ${r.error}`); }
    }
  }
  if (c.site && p.site) { say(status, 'Site settings…'); take(await api('POST', '/api/admin/backup', { part: 'site', dryRun: dry, settings: p.site.settings, seo_pages: p.site.seo_pages })); }
  if (c.projects && p.projects) {
    if (c.projects === 'replace') await api('POST', '/api/admin/backup', { part: 'clear-projects', dryRun: dry });
    for (let i = 0; i < p.projects.length; i += 10) { say(status, `Projects… ${Math.min(i + 10, p.projects.length)} of ${p.projects.length}`); take(await api('POST', '/api/admin/backup', { part: 'projects', mode: c.projects, dryRun: dry, items: p.projects.slice(i, i + 10) })); }
  }
  if (c.resume && p.resume) { for (let i = 0; i < p.resume.length; i++) { say(status, `Resume… section ${i + 1} of ${p.resume.length}`); take(await api('POST', '/api/admin/backup', { part: 'resume-section', first: i === 0, dryRun: dry, section: p.resume[i] })); } }
  if (c.now && p.now) { for (let i = 0; i < p.now.length; i++) { say(status, `Now board… ${i + 1} of ${p.now.length}`); take(await api('POST', '/api/admin/backup', { part: 'now-category', first: i === 0, dryRun: dry, category: p.now[i] })); } }
  if (c.messages && p.messages) { for (let i = 0; i < p.messages.length; i += 200) { say(status, `Messages… ${Math.min(i + 200, p.messages.length)} of ${p.messages.length}`); take(await api('POST', '/api/admin/backup', { part: 'messages', dryRun: dry, items: p.messages.slice(i, i + 200) })); } }
  return t;
}

/* ───── the page ───── */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
function init() {
  const exportBtn = $<HTMLButtonElement>('bk-export'), exportStatus = $('bk-export-status')!;
  exportBtn?.addEventListener('click', async () => {
    exportBtn.disabled = true; exportStatus.dataset.state = '';
    try { const r = await exportAll($<HTMLInputElement>('bk-messages')!.checked, exportStatus); say(exportStatus, `Done: ${r.files} files, ${(r.bytes / 1048576).toFixed(1)} MB. Your download should have started.`); }
    catch (e) { exportStatus.dataset.state = 'error'; say(exportStatus, (e as Error).message); }
    exportBtn.disabled = false;
  });
  let parsed: Parsed | null = null;
  const pick = $<HTMLInputElement>('bk-file')!, panel = $('bk-import-panel')!, info = $('bk-info')!, status = $('bk-import-status')!, result = $('bk-result')!, go = $<HTMLButtonElement>('bk-go')!, check = $<HTMLButtonElement>('bk-check')!, confirm = $<HTMLInputElement>('bk-confirm')!;
  const choice = (): Choice => { const on = (id: string) => !!$<HTMLInputElement>(id)?.checked && !$<HTMLInputElement>(id)!.disabled; return { files: on('bk-c-files'), site: on('bk-c-site'), projects: on('bk-c-projects') ? ($<HTMLInputElement>('bk-m-add')!.checked ? 'add' : 'replace') : false, resume: on('bk-c-resume'), now: on('bk-c-now'), messages: on('bk-c-messages') }; };
  const needsConfirm = () => { const c = choice(); return c.site || c.projects === 'replace' || c.resume || c.now; };
  const refresh = () => { const c = choice(); if (c.projects === 'replace' && parsed?.resume && !c.resume) { $<HTMLInputElement>('bk-c-resume')!.checked = true; } const need = needsConfirm(); $('bk-confirm-row')!.hidden = !need; go.disabled = !parsed || (need && confirm.value.trim() !== 'REPLACE'); };
  panel.addEventListener('input', refresh); panel.addEventListener('change', refresh);
  pick.addEventListener('change', async () => {
    parsed = null; panel.hidden = true; result.textContent = ''; say(status, '');
    const file = pick.files?.[0]; if (!file) return;
    try {
      say(status, 'Reading the backup…'); parsed = await parseBackup(await file.arrayBuffer());
      const m = parsed.manifest; const n = (x?: any[]) => x?.length ?? 0;
      say(info, `Made ${new Date(m.created_at).toLocaleString()}. Contains: ${n(parsed.projects)} projects, ${n(parsed.assets)} files, ${n(parsed.resume)} resume sections, ${n(parsed.now)} Now categories${parsed.messages ? `, ${parsed.messages.length} messages` : ', no messages'}.`);
      const has: Record<string, boolean> = { 'bk-c-files': !!parsed.assets?.length, 'bk-c-site': !!parsed.site, 'bk-c-projects': !!parsed.projects, 'bk-c-resume': !!parsed.resume, 'bk-c-now': !!parsed.now, 'bk-c-messages': !!parsed.messages };
      for (const [id, ok] of Object.entries(has)) { const el = $<HTMLInputElement>(id)!; el.disabled = !ok; el.checked = ok && id !== 'bk-c-messages'; el.closest('label')!.toggleAttribute('data-off', !ok); }
      confirm.value = ''; panel.hidden = false; say(status, ''); refresh();
    } catch (e) { status.dataset.state = 'error'; say(status, (e as Error).message); }
  });
  const show = (t: Total, dry: boolean) => {
    result.replaceChildren(); const h = document.createElement('p'); h.textContent = `${dry ? 'Check finished. Nothing was changed. ' : 'Import finished. '}Added ${t.added}, replaced ${t.updated}, skipped ${t.skipped}.`; result.append(h);
    if (t.problems.length) { const ul = document.createElement('ul'); for (const x of t.problems.slice(0, 100)) { const li = document.createElement('li'); li.textContent = x; ul.append(li); } if (t.problems.length > 100) { const li = document.createElement('li'); li.textContent = `…and ${t.problems.length - 100} more.`; ul.append(li); } result.append(ul); }
    result.setAttribute('tabindex', '-1'); result.focus();
  };
  const run = async (dry: boolean) => {
    if (!parsed) return; check.disabled = go.disabled = true; status.dataset.state = '';
    try { show(await runImport(parsed, choice(), dry, status), dry); say(status, ''); }
    catch (e) { status.dataset.state = 'error'; say(status, `Stopped: ${(e as Error).message}. Some pieces may already have been imported; run it again (it is safe to repeat) or restore from the backup you made before.`); }
    check.disabled = false; refresh();
  };
  check.addEventListener('click', () => run(true)); go.addEventListener('click', () => run(false));
}
if (typeof document !== 'undefined') init();
