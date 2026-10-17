import type { APIRoute } from 'astro';
import { getById, toMarkdownFile } from '../../../../../lib/projects-admin';

// Download a project as a Markdown file with Obsidian-style front matter.
export const GET: APIRoute = async ({ params }) => {
  const p = await getById(Number(params.id));
  if (!p) return new Response('Not found', { status: 404 });
  return new Response(toMarkdownFile(p), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${p.slug || 'project'}.md"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
};
