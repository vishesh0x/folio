// SQL that fills a test database with many files and many long projects, to see what happens to the owner's Files page as the site grows.
//   assets   how many uploaded files (rows only: nothing is stored in R2, the dashboard lists rows)
//   projects how many projects;  bodyKb  size of each project's text;  refs  how many pictures each project shows
// Everything created has an id/slug starting with "scale", so scaleClear() removes exactly that and nothing else.
export const scaleId = (n) => `scale${String(n).padStart(7, '0')}`;          // 12 characters, like a real id
export const scaleFile = (n) => `Photo-${n}.jpg`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const PARA = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
export function scaleSql({ assets = 100, projects = 10, bodyKb = 20, refs = 6 } = {}) {
  const out = [];
  for (let n = 0; n < assets; n++) out.push(`INSERT INTO assets (id,r2_key,filename,mime,size,width,height,alt,decorative) VALUES (${q(scaleId(n))},${q(`assets/${scaleId(n)}/${scaleFile(n)}`)},${q(scaleFile(n))},'image/jpeg',200000,1600,1200,'A photo',0);`);
  for (let p = 0; p < projects; p++) {
    let body = `# Project ${p}\n\n`;
    const pieces = Math.max(refs, 1), per = Math.floor((bodyKb * 1024) / pieces);
    for (let k = 0; k < pieces; k++) {
      body += PARA.repeat(Math.max(1, Math.floor(per / PARA.length))) + '\n\n';
      const a = (p * refs + k) % Math.max(assets, 1);
      body += k % 2 ? `![[${scaleFile(a)}]]\n\n` : `![A photo](/media/${scaleId(a)}/${scaleFile(a)})\n\n`;
    }
    out.push(`INSERT INTO projects (slug,title,summary,body_md,tags,status,sort_order) VALUES (${q(`scale-project-${p}`)},${q(`Scale project ${p}`)},'x',${q(body)},'[]','published',${100 + p});`);
  }
  return out.join('\n');
}
export const scaleClear = () => "DELETE FROM projects WHERE slug LIKE 'scale-project-%'; DELETE FROM assets WHERE id LIKE 'scale%';";
