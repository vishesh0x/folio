import type { APIRoute } from 'astro';
import { messagesCsv } from '../../../lib/inbox';

// Owner only (everything under /api/admin is behind the sign-in check). Names, email addresses and messages of visitors: never cached, never indexed.
export const GET: APIRoute = async () =>
  new Response(await messagesCsv(), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="messages-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'private, no-store' } });
