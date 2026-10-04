-- Sample content for Folio. Safe to re-run (uses INSERT OR REPLACE).
-- Edit everything from the dashboard afterwards.

INSERT OR REPLACE INTO site_config (id, name, role, tagline, bio, email, location, avatar_alt, meta_title, meta_description, socials, available) VALUES
(1, 'Vishesh Kumar', 'Software Developer', 'I build thoughtful software and draw in the margins.',
 'Developer who enjoys crafting fast, useful web products. When away from the keyboard you will find me sketching, reading, or wandering around a new city.',
 'hello@example.com', 'India', '', 'Vishesh Kumar - Developer', 'Portfolio, projects and notes from Vishesh Kumar.',
 '[{"label":"GitHub","url":"https://github.com/"},{"label":"LinkedIn","url":"https://linkedin.com/"},{"label":"X","url":"https://x.com/"}]', 1);

INSERT OR REPLACE INTO page_seo (page, title, description) VALUES
('home','Vishesh Kumar - Developer','Portfolio, projects and notes from Vishesh Kumar.'),
('projects','Projects - Vishesh Kumar','Things I have designed, built and shipped.'),
('now','Now - Vishesh Kumar','What I am focused on at the moment: building, reading, drawing.'),
('resume','Resume - Vishesh Kumar','Experience, skills, education and certifications.'),
('contact','Contact - Vishesh Kumar','Get in touch for work, collaborations or just to say hi.');

INSERT OR REPLACE INTO projects (id, slug, title, summary, content, tags, tech, repo_url, live_url, featured, sort_order, start_date) VALUES
('b0000000-0000-4000-8000-000000000001','portfolio-site','Personal Portfolio','This site - a portfolio with a full content dashboard.',
'# Personal Portfolio

A portfolio with its own **dashboard** for editing everything.

> [!note] Built with markdown
> Project pages support Obsidian-style callouts, `code`, tables and [[sketchbook|wikilinks]].

## Features

- [x] Projects with markdown
- [x] Now board
- [ ] Blog

```ts
const hello = (name: string) => `Hello, ${name}`;
```',
 '["web","design"]','["React","TypeScript","Tailwind","Cloudflare"]','https://github.com/','https://example.com', 1, 0, '2026-09-01'),
('b0000000-0000-4000-8000-000000000002','sketchbook','Digital Sketchbook','A tiny app for organizing daily drawing practice.',
'# Digital Sketchbook

Organize daily sketches by prompt and streak.

> [!tip]
> Consistency beats intensity.',
 '["app","art"]','["React","Canvas"]','https://github.com/',NULL, 1, 1, '2026-05-01');

INSERT OR REPLACE INTO now_categories (id, name, emoji, sort_order) VALUES
('11111111-1111-4111-8111-111111111111','Building','🛠',0),
('22222222-2222-4222-8222-222222222222','Reading','📚',1),
('33333333-3333-4333-8333-333333333333','Drawing','✏️',2);

INSERT OR REPLACE INTO now_items (id, category_id, title, description, status, sort_order) VALUES
('c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','This portfolio','Designing a personal site with a content dashboard.','doing',0),
('c0000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','The Pragmatic Programmer','Re-reading, one chapter a week.','doing',0),
('c0000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','Atomic Habits','Finished last month.','done',1),
('c0000000-0000-4000-8000-000000000004','33333333-3333-4333-8333-333333333333','Daily figure sketches','30-day gesture drawing challenge.','doing',0);

INSERT OR REPLACE INTO resume_profile (id, full_name, headline, email, location, website, summary) VALUES
(1,'Vishesh Kumar','Software Developer','hello@example.com','India','https://example.com',
 'Developer focused on building fast, accessible web products end to end - from database to pixels.');

INSERT OR REPLACE INTO resume_sections (id, title, kind, sort_order) VALUES
('aaaaaaaa-0000-4000-8000-000000000001','Experience','experience',0),
('aaaaaaaa-0000-4000-8000-000000000002','Projects','projects',1),
('aaaaaaaa-0000-4000-8000-000000000003','Skills','skills',2),
('aaaaaaaa-0000-4000-8000-000000000004','Education','education',3),
('aaaaaaaa-0000-4000-8000-000000000005','Certifications','certifications',4);

INSERT OR REPLACE INTO resume_entries (id, section_id, title, organization, location, start_date, end_date, description, tags, sort_order) VALUES
('d0000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Software Developer','Acme Inc.','Remote','2024','Present','- Built and shipped customer-facing features
- Improved page load times by 40%','[]',0),
('d0000000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000002','Personal Portfolio','','','2026','','A portfolio with a full content dashboard.','["React","TypeScript"]',0),
('d0000000-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000003','Languages','','','','','','["TypeScript","Python","SQL"]',0),
('d0000000-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000003','Frameworks','','','','','','["React","Node.js","Tailwind"]',1),
('d0000000-0000-4000-8000-000000000005','aaaaaaaa-0000-4000-8000-000000000004','B.Tech, Computer Science','Your University','India','2020','2024','','[]',0),
('d0000000-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-000000000005','Example Certification','Issuer','','2025','','','[]',0);
