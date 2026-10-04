// End-to-end smoke test against a running Folio (vite preview / wrangler dev).
// Needs a FRESH database (no admin yet). Reset local state with:
//   npx wrangler d1 execute folio-db --local --command "DELETE FROM sessions; DELETE FROM admin_users; DELETE FROM rate_limits; DELETE FROM contact_messages;"
//   BASE=http://localhost:4173 SETUP_TOKEN=... node scripts/smoke.mjs
import { readdirSync, readFileSync } from "node:fs";
import zlib from "node:zlib";
import { toJSON } from "seroval";

const BASE = process.env.BASE ?? "http://localhost:4173";
const SETUP_TOKEN = process.env.SETUP_TOKEN ?? "test-setup-token-123";
const dir = "dist/server/assets";
const ids = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(`${dir}/${f}`, "utf8");
  for (const m of src.matchAll(
    /var (\w+) = createServerFn\(\{ method: "(GET|POST)" \}\)[\s\S]*?createSsrRpc\("([a-f0-9]+)"\)/g,
  )) {
    ids[m[1]] = { id: m[3], method: m[2] };
  }
}

const enc = (v) => toJSON(v);
// Tolerant decoder for plain JSON values inside a seroval envelope.
const dec = (x) => {
  if (x.t === 2) return [null, undefined, true, false][x.s];
  if (x.t === 0 || x.t === 1) return x.s;
  if (x.t === 9) return x.a.map(dec);
  if (x.t === 10 || x.t === 11) return Object.fromEntries(x.p.k.map((k, i) => [k, dec(x.p.v[i])]));
  return x;
};

let cookie = "";
async function call(name, data) {
  const { id, method } = ids[name];
  const headers = {
    "x-tsr-serverFn": "true",
    accept: "application/json",
    "sec-fetch-site": "same-origin",
    origin: BASE,
    cookie,
  };
  let res;
  if (method === "GET") {
    res = await fetch(`${BASE}/_serverFn/${id}`, { headers });
  } else {
    res = await fetch(`${BASE}/_serverFn/${id}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(enc({ data: data ?? undefined, context: {} })),
    });
  }
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let body,
    isError = false;
  try {
    // Envelope: { result, error, context } — thrown errors still arrive as HTTP 200.
    const j = JSON.parse(text);
    const at = (k) => j.p.v[j.p.k.indexOf(k)];
    const errNode = at("error");
    if (errNode && !(errNode.t === 2 && errNode.s === 1)) {
      isError = true;
      body = { error: errNode.s?.message?.s ?? "error" };
    } else {
      body = dec(at("result"));
    }
  } catch {
    body = text;
    isError = res.status >= 400;
  }
  return { status: res.status, body, isError, setCookie: set };
}

let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + extra}`);
};
const errText = (r) => (typeof r.body === "string" ? r.body : JSON.stringify(r.body));

// 1. unauthenticated admin call is rejected
let r = await call("adminOverview");
check("admin fn rejects anonymous", /UNAUTHORIZED/.test(errText(r)) || r.status >= 400, errText(r));

// 2. setup with wrong token is rejected, weak password rejected
r = await call("setupAdmin", {
  email: "me@example.com",
  password: "a-long-enough-password",
  setupToken: "wrong",
});
check(
  "setup rejects wrong token",
  /Invalid setup token/i.test(errText(r)) && !r.setCookie.length,
  errText(r),
);
r = await call("setupAdmin", {
  email: "me@example.com",
  password: "short",
  setupToken: SETUP_TOKEN,
});
check(
  "setup rejects short password",
  /12 characters/i.test(errText(r)) && !r.setCookie.length,
  errText(r),
);

// 3. correct setup creates account + cookie session
let adminCookie = "";
r = await call("setupAdmin", {
  email: "me@example.com",
  password: "a-long-enough-password",
  setupToken: SETUP_TOKEN,
});
check("setup succeeds with token", !r.isError && r.setCookie.length > 0, errText(r));
adminCookie = cookie;
check(
  "session cookie is HttpOnly + SameSite=Lax",
  /HttpOnly/i.test(r.setCookie[0] ?? "") && /SameSite=Lax/i.test(r.setCookie[0] ?? ""),
  r.setCookie[0],
);

// 4. second setup is blocked
const saved = cookie;
cookie = "";
r = await call("setupAdmin", {
  email: "evil@example.com",
  password: "another-long-password",
  setupToken: SETUP_TOKEN,
});
check("second setup is blocked", /already exists/i.test(errText(r)), errText(r));
cookie = saved;

// 5. authenticated admin calls work
r = await call("adminOverview");
check(
  "admin overview works when signed in",
  !r.isError && typeof r.body.projects === "number",
  errText(r),
);

// 6. input validation: javascript: URL is rejected server-side
r = await call("adminSaveProject", {
  id: null,
  data: {
    title: "X",
    slug: "x-js",
    summary: "",
    content: "",
    repoUrl: "javascript:alert(1)",
    tags: [],
    tech: [],
  },
});
check(
  "javascript: URL rejected by validation",
  /valid http\(s\) URL/i.test(errText(r)),
  errText(r),
);
r = await call("adminSaveSite", {
  name: "N",
  role: "",
  tagline: "",
  bio: "",
  email: "",
  location: "",
  avatarUrl: null,
  avatarAlt: "",
  faviconUrl: null,
  resumeUrl: "data:text/html,<script>1</script>",
  ogImage: null,
  metaTitle: "",
  metaDescription: "",
  socials: [{ label: "x", url: "javascript:alert(1)" }],
  available: true,
});
check(
  "javascript:/data: URLs rejected in site config",
  /valid http\(s\) URL/i.test(errText(r)),
  errText(r),
);

// 7. slug uniqueness message
r = await call("adminSaveProject", {
  id: null,
  data: { title: "Dup", slug: "portfolio-site", summary: "", content: "", tags: [], tech: [] },
});
check("duplicate slug gives friendly error", /slug is already used/i.test(errText(r)), errText(r));

// 8. contact form: validation, honeypot, rate limit
cookie = "";
r = await call("sendMessage", {
  name: "",
  email: "nope",
  subject: "",
  message: "x",
  website: "",
  turnstileToken: "",
});
check(
  "contact validates input",
  r.isError && /too_small|invalid_string|email/i.test(errText(r)),
  errText(r),
);
r = await call("sendMessage", {
  name: "Bot",
  email: "bot@example.com",
  subject: "",
  message: "buy stuff now",
  website: "http://spam",
  turnstileToken: "",
});
check("honeypot returns ok (silently dropped)", !r.isError && r.body?.ok === true, errText(r));
let okCount = 0,
  limited = false;
for (let i = 0; i < 7; i++) {
  r = await call("sendMessage", {
    name: "Real",
    email: "real@example.com",
    subject: "Hi",
    message: "Hello there, nice site",
    website: "",
    turnstileToken: "",
  });
  if (!r.isError) okCount++;
  else if (/later|already/i.test(errText(r))) limited = true;
}
check(
  "contact allows 5 then rate-limits",
  okCount === 5 && limited,
  `ok=${okCount} limited=${limited}`,
);

// 9. login: wrong password generic error; rate limiting
r = await call("login", { email: "me@example.com", password: "wrong-password-1" });
check("wrong password → generic error", /Invalid email or password/.test(errText(r)), errText(r));
r = await call("login", { email: "nobody@example.com", password: "wrong-password-1" });
check(
  "unknown email → same generic error",
  /Invalid email or password/.test(errText(r)),
  errText(r),
);
let blocked = false;
for (let i = 0; i < 10; i++) {
  r = await call("login", { email: "me@example.com", password: "nope-nope-nope" });
  if (/Too many attempts/.test(errText(r))) blocked = true;
}
check("login is rate limited after repeated failures", blocked, errText(r));

// 10. public pages reflect data; sitemap includes project
const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
check("sitemap lists projects", sm.includes("/projects/portfolio-site"));

// ── uploads + media pipeline ────────────────────────────────────────────────
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255) / w;
      raw[o + 1] = (y * 255) / h;
      raw[o + 2] = 140;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function upload(
  bytes,
  name,
  type,
  { cookie: c = adminCookie, site = "same-origin", alt = "" } = {},
) {
  // The local dev proxy occasionally resets the connection when the server answers
  // (401/403/415) before the multipart body is fully sent; retry that transport glitch once.
  for (let attempt = 0; ; attempt++) {
    const fd = new FormData();
    fd.set("file", new File([bytes], name, { type }));
    fd.set("alt", alt);
    try {
      const res = await fetch(`${BASE}/api/admin/upload`, {
        method: "POST",
        body: fd,
        headers: { cookie: c, "sec-fetch-site": site, origin: BASE },
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 500 && !Object.keys(json).length && attempt < 2) continue;
      return { status: res.status, json };
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
}

const png = makePng(800, 450);
let u = await upload(png, "hero.png", "image/png", { cookie: "" });
check("upload requires sign-in (401)", u.status === 401, JSON.stringify(u));
u = await upload(png, "hero.png", "image/png", { site: "cross-site" });
check("upload blocks cross-site requests (403)", u.status === 403, JSON.stringify(u));
u = await upload(
  Buffer.from("<html><script>alert(1)</script></html>  padding padding"),
  "evil.png",
  "image/png",
);
check("HTML disguised as .png rejected (415)", u.status === 415, JSON.stringify(u));
u = await upload(
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>'),
  "x.svg",
  "image/svg+xml",
);
check("SVG upload rejected (415)", u.status === 415, JSON.stringify(u));
u = await upload(
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(200, 1),
  ]),
  "corrupt.png",
  "image/png",
);
check("corrupt image rejected (415)", u.status === 415, JSON.stringify(u));
u = await upload(png, "My Hero Shot!.PNG", "text/plain", { alt: "A colour gradient" });
check(
  "valid PNG accepted (201) even with wrong client type",
  u.status === 201 && u.json.asset?.mime === "image/png",
  JSON.stringify(u),
);
check(
  "dimensions + alt stored",
  u.json.asset?.width === 800 &&
    u.json.asset?.height === 450 &&
    u.json.asset?.alt === "A colour gradient",
  JSON.stringify(u.json.asset),
);
check(
  "key is sanitised + unique",
  /^[a-z0-9]+-[a-z0-9]+-my-hero-shot\.png$/.test(u.json.asset?.key ?? ""),
  u.json.asset?.key,
);
const key = u.json.asset?.key;

let m = await fetch(`${BASE}/media/${key}`);
const orig = Buffer.from(await m.arrayBuffer());
check(
  "original served from R2",
  m.status === 200 && m.headers.get("content-type") === "image/png" && orig.length === png.length,
  `${m.status} ${m.headers.get("content-type")}`,
);
check(
  "media: nosniff + immutable cache + sandbox CSP",
  m.headers.get("x-content-type-options") === "nosniff" &&
    /immutable/.test(m.headers.get("cache-control") ?? "") &&
    /sandbox/.test(m.headers.get("content-security-policy") ?? ""),
  JSON.stringify([...m.headers]),
);
const etag = m.headers.get("etag");
m = await fetch(`${BASE}/media/${key}`, { headers: { "if-none-match": etag } });
check("conditional request → 304", m.status === 304, String(m.status));

m = await fetch(`${BASE}/media/${key}?w=320`, {
  headers: { accept: "image/avif,image/webp,image/*" },
});
const v = Buffer.from(await m.arrayBuffer());
const vt = m.headers.get("content-type") ?? "";
check(
  "resized variant via Cloudflare Images (AVIF/WebP, smaller)",
  m.status === 200 && /avif|webp/.test(vt) && v.length < orig.length,
  `${m.status} ${vt} ${v.length} vs ${orig.length}`,
);
check(
  "variant varies on Accept + cached immutable",
  /Accept/i.test(m.headers.get("vary") ?? "") &&
    /immutable/.test(m.headers.get("cache-control") ?? ""),
);
m = await fetch(`${BASE}/media/${key}?w=320`, { headers: { accept: "image/png,*/*" } });
check(
  "fallback format for old clients (PNG/JPEG)",
  m.status === 200 && /png|jpeg/.test(m.headers.get("content-type") ?? ""),
  m.headers.get("content-type"),
);
m = await fetch(`${BASE}/media/${key}?w=99999`, { headers: { accept: "image/webp" } });
check("huge width is clamped (no unbounded transforms)", m.status === 200, String(m.status));

for (const bad of ["../wrangler.jsonc", "%2e%2e%2fsecret", "nope.png", "A..b.png", ".hidden"]) {
  m = await fetch(`${BASE}/media/${bad}`);
  check(`media rejects/404s "${bad}"`, m.status === 404, String(m.status));
}
m = await fetch(`${BASE}/media/${key}`, { method: "POST" });
check("media is read-only (405)", m.status === 405, String(m.status));

// asset deletion is guarded when in use
cookie = adminCookie;
r = await call("adminListAssets");
const asset = (r.body ?? []).find?.((a) => a.key === key);
await call("adminSaveSite", {
  name: "N",
  role: "",
  tagline: "",
  bio: "",
  email: "",
  location: "",
  avatarUrl: `/media/${key}`,
  avatarAlt: "Me",
  faviconUrl: null,
  resumeUrl: null,
  ogImage: null,
  metaTitle: "",
  metaDescription: "",
  socials: [],
  available: true,
});
r = await call("adminDeleteAsset", { id: asset?.id, force: false });
check(
  "deleting an in-use asset is refused",
  r.body?.deleted === false && r.body?.usedIn?.includes("Site config"),
  errText(r),
);
r = await call("adminDeleteAsset", { id: asset?.id, force: true });
m = await fetch(`${BASE}/media/${key}`);
check(
  "forced delete removes the R2 object",
  r.body?.deleted === true && m.status === 404,
  `${errText(r)} / ${m.status}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
