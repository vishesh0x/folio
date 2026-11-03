/**
 * How big a request body the site accepts, decided from the Content-Length the sender declares, BEFORE
 * any of the body is read.
 *
 * Why: a Worker has 128 MB of memory, and reading a form (`request.formData()`) holds the whole body
 * in memory at once, while Cloudflare lets request bodies of up to 100 MB through on the free plan.
 * Checking the size only after reading means that a huge body (an accidentally chosen video, or a
 * stranger's junk posted to the contact form) ends in "Worker exceeded resource limits" instead of a
 * friendly message. Limits: the two upload endpoints take a file (largest allowed: a 15 MiB PDF,
 * src/lib/assets.ts MAX_PDF) plus a few small fields; every other form is text (the longest, a
 * project, is 200,000 characters, which can be a few megabytes once encoded). A body sent without a
 * Content-Length (chunked) cannot be measured in advance, so the middleware refuses it with 411
 * (lengthMissing).
 */
export const MAX_UPLOAD_REQUEST = 16 * 1024 * 1024;
/** Largest request body accepted for ordinary forms. */
export const MAX_FORM_REQUEST = 4 * 1024 * 1024;
/** Routes that accept file uploads and therefore get a larger limit. */
export const UPLOAD_PATHS = ['/api/admin/assets', '/api/admin/assets/upload', '/api/admin/backup-file'];

/** The limit that applies to a POST to this path, in bytes. */
export const requestLimit = (path: string) => (UPLOAD_PATHS.includes(path) ? MAX_UPLOAD_REQUEST : MAX_FORM_REQUEST);

/** If the declared body size is over the limit for this path, the limit; otherwise null. */
export function requestTooLarge(path: string, contentLength: string | null): number | null {
  if (!contentLength || !/^\d+$/.test(contentLength.trim())) return null;
  const limit = requestLimit(path);
  return Number(contentLength) > limit ? limit : null;
}

/**
 * True when a request carries a body but no usable Content-Length (for example a chunked upload). Such
 * a body cannot be judged by requestTooLarge before it is read, so the middleware refuses it with 411.
 * Browsers always send a length for forms and uploads, and a request with no body at all (a plain POST
 * button) is not affected.
 */
export const lengthMissing = (contentLength: string | null, hasBody: boolean) => hasBody && !(contentLength && /^\d+$/.test(contentLength.trim()));

/** The message shown when a request is refused for its size. */
export const tooLargeMessage = (path: string) => UPLOAD_PATHS.includes(path) ? 'That file is too large (limit 10 MB for images, 15 MB for PDFs).' : 'That request is too large.';
