import type { APIRoute } from 'astro';
import { renderMarkdown } from '../../../lib/markdown';

// Live preview for the editor. The renderer never passes raw HTML through, so the result is safe to insert.
export const POST: APIRoute = async ({ request }) => {
  let md = '';
  try { md = String(((await request.json()) as { md?: string }).md ?? ''); } catch { return new Response('{"error":"Bad request"}', { status: 400, headers: { 'content-type': 'application/json' } }); }
  const { html } = await renderMarkdown(md.slice(0, 200_000));
  return new Response(JSON.stringify({ html }), { headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
};
