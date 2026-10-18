-- Demo images + diagrams for the test site (run after demo.sql). NOT for production.
INSERT INTO assets (id, r2_key, filename, mime, size, width, height, alt, decorative) VALUES ('demoCover0001','assets/demoCover0001/demo-cover.png','demo-cover.png','image/png',27040,1424,752,'Abstract demo cover',0);
UPDATE projects SET cover_asset='demoCover0001', cover_alt='Abstract demo cover' WHERE slug IN ('wanderhost-booking','pocket-ledger','edge-notes');
UPDATE settings SET value = json_set(value,'$.portrait_asset','demoCover0001') WHERE key='site';
UPDATE projects SET body_md = body_md || '

## Architecture

```mermaid
flowchart LR
  Visitor([Visitor]) --> Edge[Cloudflare edge cache]
  Edge -->|miss| Worker[Astro Worker]
  Worker --> D1[(D1 database)]
  Worker --> R2[(R2 bucket)]
  Worker --> Edge
```

### A request, step by step

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Worker
  participant D as D1
  B->>W: GET /projects/wanderhost
  W->>D: SELECT project
  D-->>W: row
  W-->>B: HTML (cached 5 min)
```

### A very wide pipeline

```mermaid
flowchart LR
  A1[Write in Obsidian] --> A2[Paste into editor] --> A3[Preview] --> A4[Publish] --> A5[Cache purge] --> A6[Edge cache warm] --> A7[Visitor sees it] --> A8[Lighthouse check] --> A9[Fix anything red] --> A10[Ship again]
```
' WHERE slug='wanderhost-booking';
UPDATE projects SET body_md = body_md || '

## A broken diagram

```mermaid
flowchart LR
  A --> B -->
  this is not valid ((
```
' WHERE slug='edge-notes';
