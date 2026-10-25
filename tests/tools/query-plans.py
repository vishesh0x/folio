#!/usr/bin/env python3
"""Dev tool: runs EXPLAIN QUERY PLAN on every SQL statement in src/ against a COPY of a local D1 database, and reports table scans.
   python3 tests/tools/query-plans.py [path-to.sqlite]     (default: the local dev database under .wrangler/)
A "SCAN <table>" on a table that grows (messages, sessions, login_attempts, assets, projects, now_items, resume_entries, ...) deserves a look;
SCAN on a small fixed table (settings, seo_pages) is fine. "USE TEMP B-TREE FOR ORDER BY" means an extra sort."""
import re, glob, sqlite3, shutil, sys, tempfile, os, itertools

db = sys.argv[1] if len(sys.argv) > 1 else next(p for p in glob.glob('.wrangler/*/v3/d1/miniflare-D1DatabaseObject/*.sqlite') if 'metadata' not in p)
tmp = tempfile.mktemp(suffix='.sqlite')
# the backup API reads the -wal file too (a plain file copy would miss recent changes, such as a new index)
src = sqlite3.connect(db); con = sqlite3.connect(tmp); src.backup(con); src.close()
GROWS = {'messages', 'sessions', 'login_attempts', 'assets', 'projects', 'now_items', 'now_categories', 'resume_entries', 'resume_sections', 'users'}

# Expand the few dynamic parts so every real variant is checked
PROJECT_SELECT = re.search(r"const SELECT = `([^`]*)`", open('src/lib/projects.ts').read()).group(1)
SUBS = [("${SELECT}", [PROJECT_SELECT]), ("${where}", ['', 'WHERE is_read = 0', "WHERE status = 'draft'"]), ("${cols}", ['id, filename, mime, width, height, alt, decorative']),
        ("${table}", ['now_categories', 'now_items', 'resume_sections', 'resume_entries']),
        ("${opts.featured ? 'AND p.featured = 1' : ''}", ['', 'AND p.featured = 1']),
        ("${list.map(() => '?').join(',')}", ['?,?,?']), ("${ids.map(() => '?').join(',')}", ['?,?,?'])]

stmts = {}
for f in sorted(glob.glob('src/**/*.ts', recursive=True) + glob.glob('src/**/*.astro', recursive=True)):
    s = open(f).read()
    for m in re.finditer(r'\.prepare\(\s*(`(?:[^`\\]|\\.)*`|\'(?:[^\'\\]|\\.)*\'|"(?:[^"\\]|\\.)*")', s):
        q = m.group(1)[1:-1]
        if '\\n' in q: q = q.replace('\\n', ' ')
        variants = [q]
        for key, vals in SUBS:
            if key in q: variants = [v.replace(key, val) for v in variants for val in vals]
        for v in variants:
            v = re.sub(r'\s+', ' ', v).strip()
            if '${' in v: v = re.sub(r'\$\{[^}]*\}', "'x'", v)
            stmts.setdefault(v, f'{f}:{s[:m.start()].count(chr(10)) + 1}')

rows = []
for q, where in stmts.items():
    try:
        n = len(set(re.findall(r'\?(\d+)', q))) or q.count('?'); plan = con.execute('EXPLAIN QUERY PLAN ' + q, [1] * n).fetchall()
    except Exception as e:
        rows.append((where, q, [f'(could not plan: {e})'])); continue
    rows.append((where, q, [r[3] for r in plan]))

bad = 0
for where, q, plan in rows:
    scans = [p for p in plan if p.startswith('SCAN ') and p.split()[1] in GROWS]
    sort = [p for p in plan if 'TEMP B-TREE' in p]
    if scans or sort:
        bad += 1; print(f'{where}\n   {q[:150]}\n   ' + '\n   '.join(plan) + '\n')
print(f'{len(rows)} distinct statements planned; {bad} with a table scan on a growing table or an extra sort.')
os.remove(tmp)
