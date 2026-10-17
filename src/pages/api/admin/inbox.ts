import type { APIRoute } from 'astro';
import { setRead, removeMessage, markAllRead } from '../../../lib/inbox';

// Only ever send people back to the inbox, never to a URL the form supplied.
const back = (to: string) => new Response(null, { status: 303, headers: { Location: /^\/dashboard\/inbox(\/\d+|\?[\w=&]*)?$/.test(to) ? to : '/dashboard/inbox' } });

export const POST: APIRoute = async ({ request }) => {
  const f = await request.formData();
  const action = String(f.get('action') ?? '');
  const id = Number(f.get('id'));
  const to = String(f.get('redirect') ?? '/dashboard/inbox');
  if (action === 'mark-all-read') { await markAllRead(); return back(to); }
  if (!Number.isInteger(id) || id < 1) return back(to);
  if (action === 'read') await setRead(id, true);
  else if (action === 'unread') await setRead(id, false);
  else if (action === 'delete') { await removeMessage(id); return back('/dashboard/inbox'); }
  return back(to);
};
