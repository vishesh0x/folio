import type { APIRoute } from 'astro';
import { destroySession } from '../../lib/auth';

// POST only (a GET link could be triggered by any other site). The CSRF check in src/middleware.ts guards it.
export const POST: APIRoute = async ({ cookies, redirect }) => {
  await destroySession(cookies);
  return redirect('/auth', 303);
};
