-- Demo content for visual/responsive tests. NOT for production.
INSERT INTO settings (key,value) VALUES ('site','{"name": "Vishesh Raghuvanshi", "tagline": "Full-stack developer & designer", "bio": "I build fast, accessible products on the edge. Currently exploring Cloudflare Workers, D1 and small, useful tools.", "email": "hello@visheshraghuvanshi.in", "phone": "+91 98765 43210", "location": "Bengaluru, India", "now_intro": "What I''m focused on right now.", "site_url": "https://visheshraghuvanshi.in", "meta_description": "Portfolio of Vishesh Raghuvanshi.", "og_asset": null, "portrait_asset": null, "favicon_asset": null, "resume_asset": null, "headline": "I build *fast* things for the web", "availability": "Open to new work", "highlights": [{"value": "6+", "label": "Years building"}, {"value": "24", "label": "Projects shipped"}, {"value": "100", "label": "Lighthouse scores, repeatedly"}, {"value": "3", "label": "Countries worked in"}], "socials": [{"label": "GitHub", "url": "https://github.com/example"}, {"label": "LinkedIn", "url": "https://linkedin.com/in/example"}, {"label": "X", "url": "https://x.com/example"}, {"label": "Dribbble", "url": "https://dribbble.com/example"}, {"label": "Email", "url": "mailto:hello@visheshraghuvanshi.in"}]}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO projects (slug,title,summary,body_md,tags,live_url,source_url,status,featured,sort_order) VALUES ('wanderhost-booking','WanderHost booking platform','A booking platform for small independent stays with calendar sync.','# Overview

WanderHost is a booking platform for small stays. This paragraph is intentionally long so we can see how text wraps on a narrow phone screen without any sideways scrolling at all, even for words like Supercalifragilisticexpialidocious_and_a_very_long_identifier_name_without_spaces.

> [!tip] A callout
> Callouts must wrap too: https://example.com/a/very/long/path/that/keeps/going/and/going/and/going/and/going/forever/and/ever?with=query&and=more&params=here

## Stack

| Layer | Choice | Why it was picked over the alternatives we looked at |
|---|---|---|
| Runtime | Cloudflare Workers | Edge latency and no cold starts for most requests in practice |
| Database | D1 | SQLite semantics with simple operations and backups |
| Storage | R2 | Cheap egress and a private-by-default bucket model |

```ts
export const handler = async (request: Request, env: Env): Promise<Response> => { return new Response(''this long line should scroll inside its own box, not the page''); };
```

## Next
- [x] Write it
- [ ] Ship it
','["astro","d1","workers"]','https://example.com','https://github.com/example/wanderhost','published',1,0);
INSERT INTO projects (slug,title,summary,body_md,tags,live_url,source_url,status,featured,sort_order) VALUES ('pocket-ledger','Pocket Ledger','A tiny offline-first expense tracker that fits in your pocket.','# Pocket Ledger

Small and quick.','["pwa","typescript"]','https://example.com',NULL,'published',1,1);
INSERT INTO projects (slug,title,summary,body_md,tags,live_url,source_url,status,featured,sort_order) VALUES ('edge-notes','Edge Notes','Markdown notes synced through Workers KV and R2.','# Edge notes

Hello.','["markdown"]',NULL,'https://github.com/example/edge','published',0,2);
INSERT INTO projects (slug,title,summary,body_md,tags,live_url,source_url,status,featured,sort_order) VALUES ('an-extremely-long-project-title-with-Antidisestablishmentarianism-inside','An extremely long project title with Antidisestablishmentarianism inside it','Checks wrapping of very long words in cards and headings on narrow screens.','# Long

body','["a-very-long-tag-name-that-could-overflow-a-chip","design"]',NULL,NULL,'published',0,3);
INSERT INTO projects (slug,title,summary,body_md,tags,live_url,source_url,status,featured,sort_order) VALUES ('secret-draft','Secret draft','Not public.','x','[]',NULL,NULL,'draft',0,4);
INSERT INTO now_categories (id,name,icon,sort_order) VALUES (1,'Building','🛠',0),(2,'Reading','📚',1),(3,'Learning','🎧',2);
INSERT INTO now_items (category_id,title,note,link,status,started_at,finished_at,updated_at,progress) VALUES
 (1,'WanderHost v2','Rebuilding the calendar sync on Durable Objects. Averyveryverylongunbrokenwordtotestwrappingonnarrowphones_1234567890.','https://example.com','current',unixepoch(),NULL,unixepoch(),65),
 (1,'This website','Cloudflare Workers, D1 and R2.',NULL,'current',unixepoch(),NULL,unixepoch(),NULL),
 (2,'Designing Data-Intensive Applications','Chapter 7, transactions.',NULL,'current',NULL,NULL,unixepoch(),40),
 (2,'A finished book','Loved it.',NULL,'done',NULL,unixepoch(),unixepoch(),NULL),
 (3,'Rust, slowly','One small crate a week.',NULL,'current',NULL,NULL,unixepoch(),NULL);
INSERT INTO resume_sections (id,kind,title,visible,sort_order) VALUES (1,'summary','Summary',1,0),(2,'experience','Experience',1,1),(3,'education','Education',1,2),(4,'skills','Skills',1,3),(5,'certifications','Certifications',1,4),(6,'projects','Selected Projects',1,5);
INSERT INTO resume_entries (section_id,project_id,data,visible,sort_order) VALUES
 (1,NULL,'{"text":"Full-stack engineer who loves small, useful things.\n\nSecond paragraph here."}',1,0),
 (2,NULL,'{"role":"Senior Software Engineer","company":"Acme Cloud Platforms Private Limited","location":"Bengaluru","start":"Jan 2022","current":true,"bullets":["Led the platform team of eight engineers across three time zones","Cut p95 latency by 62% by moving hot paths to the edge"]}',1,0),
 (2,NULL,'{"role":"Engineer","company":"Beta","start":"2018","end":"2021","description":"Built things."}',1,1),
 (3,NULL,'{"degree":"B.Tech Computer Science","school":"University of Somewhere","start":"2014","end":"2018"}',1,0),
 (4,NULL,'{"group":"Languages","items":"TypeScript, Python, SQL, Rust"}',1,0),
 (4,NULL,'{"group":"Tools","items":"Cloudflare, Git, Playwright, Figma"}',1,1),
 (5,NULL,'{"name":"Cloudflare Certified Developer","issuer":"Cloudflare","date":"2024","url":"https://example.com/cert"}',1,0),
 (6,1,'{}',1,0),(6,2,'{}',1,1);
UPDATE resume_sections SET id=id;
INSERT INTO messages (name,email,subject,body,is_read) VALUES ('Priya Shah','priya@example.com','Project enquiry','Hi Vishesh, I loved the WanderHost case study and would like to talk about a booking site for our guesthouses in Goa. Could we set up a call next week?',0);
INSERT INTO messages (name,email,subject,body,is_read) VALUES ('Tom','tom@example.com','Hello','Quick hello!',1);
