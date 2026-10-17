import type { APIRoute } from 'astro';
import { createProject, deleteProject, duplicateProject, move, setFeatured, setStatus, uniqueSlug } from '../../../lib/projects-admin';

const to = (path: string) => new Response(null, { status: 303, headers: { Location: path } });
const list = (q = '') => to('/dashboard/projects' + q);

export const POST: APIRoute = async ({ request }) => {
  const f = await request.formData();
  const action = String(f.get('action') ?? '');
  const id = Number(f.get('id'));
  const valid = Number.isInteger(id) && id > 0;

  if (action === 'create') {
    const newId = await createProject({ slug: await uniqueSlug('untitled'), title: 'Untitled project', summary: '', body_md: '', tags: [], cover_asset: null, cover_alt: '', live_url: '', source_url: '', status: 'draft', featured: 0, seo_title: '', seo_desc: '', seo_image: null });
    return to(`/dashboard/projects/${newId}?created=1`);
  }
  if (!valid) return list();
  if (action === 'delete') { await deleteProject(id); return list('?deleted=1'); }
  if (action === 'duplicate') { const n = await duplicateProject(id); return n ? to(`/dashboard/projects/${n}?created=1`) : list(); }
  if (action === 'publish') await setStatus(id, 'published');
  else if (action === 'unpublish') await setStatus(id, 'draft');
  else if (action === 'feature') await setFeatured(id, true);
  else if (action === 'unfeature') await setFeatured(id, false);
  else if (action === 'up' || action === 'down') await move(id, action);
  return list();
};
