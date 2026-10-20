/**
 * Does an If-None-Match request header match this ETag?
 *
 * HTTP says If-None-Match uses WEAK comparison: W/"abc" matches "abc". This matters because a CDN that compresses a response may
 * turn the strong ETag we sent into a weak one (W/"abc"), so the browser sends W/"abc" back. An exact string comparison would then
 * never match, and every revisit would download the whole page instead of getting an empty 304. The header may also hold a list
 * ("a", W/"b") or "*". Pass allowStar=false where a match must mean "you hold exactly this version" (pages: "*" must not
 * turn a missing page into a 304).
 */
export function etagMatches(header: string | null, etag: string, allowStar = true): boolean {
  if (!header) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  const want = bare(etag);
  return (allowStar && header.trim() === '*') || header.split(',').some((t) => bare(t) === want);
}
