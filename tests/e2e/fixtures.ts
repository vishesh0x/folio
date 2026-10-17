import { test as base, expect, type APIRequestContext } from '@playwright/test';

/**
 * `wrangler dev`'s local proxy occasionally answers 500 "Network connection lost" to a request the Worker never saw (it
 * happens when the Worker replies, e.g. 401/403, without reading the request body). That is a harness flake, not a site
 * bug, and it is not seen on Cloudflare. A REAL application failure renders the site's own "Something broke" page, so we
 * retry only 500s that are NOT that page; genuine app errors still fail the test.
 */
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'fetch', 'head'] as const;
export function withRetry(ctx: APIRequestContext, tries = 4): APIRequestContext {
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !(METHODS as readonly string[]).includes(prop)) return typeof v === 'function' ? v.bind(target) : v;
      return async (...args: any[]) => {
        let res = await (v as Function).apply(target, args);
        for (let i = 1; i < tries && res.status() === 500 && !(await res.text()).includes('Something broke'); i++) {
          await new Promise((r) => setTimeout(r, 200));
          res = await (v as Function).apply(target, args);
        }
        return res;
      };
    },
  });
}

export const test = base.extend<{ request: APIRequestContext }>({
  request: async ({ request }, use) => { await use(withRetry(request)); },
});
export { expect };
