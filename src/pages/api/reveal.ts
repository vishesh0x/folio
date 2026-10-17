import type { APIRoute } from 'astro';
import { getSettings } from '../../lib/settings';
import { allow, ipOf } from '../../lib/throttle';
import { isSameOrigin } from '../../lib/csrf';
import { turnstileOn, verifyTurnstile } from '../../lib/turnstile';
import { getResumeOpts } from '../../lib/resume';

// Your email and phone are never in the page HTML. The browser asks for them when a visitor clicks "Show".
// This stops scrapers that only read HTML; a person (or a full headless browser) can still get them, by design.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, url }) => {
  if (!isSameOrigin(request, url)) return json({ error: 'Forbidden' }, 403); // (the middleware already checks this; kept here as a second lock)
  if (!(await allow(`reveal:${ipOf(request)}`, 10, 3600))) return json({ error: 'Too many requests. Try again later.' }, 429);
  let kind = '', token = '';
  try { const b = (await request.json()) as any; kind = String(b?.kind ?? ''); token = typeof b?.token === 'string' ? b.token : ''; } catch { return json({ error: 'Bad request' }, 400); }
  if (kind !== 'email' && kind !== 'phone') return json({ error: 'Not available' }, 404);
  // With Turnstile on, nothing is handed out without a token Cloudflare confirms (the rate limit above still applies).
  if (turnstileOn() && !(await verifyTurnstile(token, ipOf(request)))) return json({ error: 'The spam check did not pass. Please try again.' }, 400);
  const s = await getSettings();
  // The phone number is only available if the resume is set to show it AND to use click-to-reveal.
  const o = await getResumeOpts();
  const value = kind === 'email' ? s.email : kind === 'phone' && o.show_phone && o.contact_mode === 'reveal' ? s.phone : '';
  return value ? json({ value }) : json({ error: 'Not available' }, 404);
};
