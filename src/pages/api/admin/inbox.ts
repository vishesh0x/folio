import type { APIRoute } from 'astro';
import { setRead, removeMessage, markAllRead, deleteByEmail, deleteOlderThan } from '../../../lib/inbox';

// Only ever send people back to the inbox, never to a URL the form supplied.
const back = (to: string) => new Response(null, { status: 303, headers: { Location: /^\/dashboard\/inbox(\/\d+|\?[\w=&]*)?$/.test(to) ? to : '/dashboard/inbox' } });

export const POST: APIRoute = async ({ request }) => {
  const f = await request.formData();
  const action = String(f.get('action') ?? '');
  const id = Number(f.get('id'));
  const to = String(f.get('redirect') ?? '/dashboard/inbox');
  if (action === 'mark-all-read') { await markAllRead(); return back(to); }
  // Deleting people's data in bulk needs the confirmation box ticked; the result is shown on the inbox page (?deleted=N).
  if (action === 'delete-email' || action === 'delete-older') {
    if (f.get('confirm') !== 'yes') return back('/dashboard/inbox?deleted=none');
    if (action === 'delete-email') { const email = String(f.get('email') ?? '').trim(); if (!email || email.length > 254) return back('/dashboard/inbox?deleted=none'); return back(`/dashboard/inbox?deleted=${await deleteByEmail(email)}`); }
    const days = Number(f.get('days')); if (!Number.isFinite(days) || days < 1 || days > 3650) return back('/dashboard/inbox?deleted=none');
    return back(`/dashboard/inbox?deleted=${await deleteOlderThan(days)}`);
  }
  if (!Number.isInteger(id) || id < 1) return back(to);
  if (action === 'read') await setRead(id, true);
  else if (action === 'unread') await setRead(id, false);
  else if (action === 'delete') { await removeMessage(id); return back('/dashboard/inbox'); }
  return back(to);
};
