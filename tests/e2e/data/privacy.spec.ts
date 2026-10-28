import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { freshIp, login, sameOrigin } from '../helpers';
import { networkOf } from '../../../src/lib/ip';
import { RATE_SALT } from '../../../playwright.config';
import { d1 } from '../d1';

// S1-M5: the rate limiter must not keep visitor IP addresses or email addresses in the database. The test server has a RATE_LIMIT_SALT, and
// this test computes the expected keys itself (same recipe) to prove both that the stored value is the keyed hash and that it groups right.
const keyOf = (value: string) => createHmac('sha256', 'rate-limit-v1:' + RATE_SALT).update(value).digest('hex').slice(0, 32);
const rows = (like: string) => d1('e2e-a', `SELECT key, count FROM login_attempts WHERE key LIKE '${like}'`) as { key: string; count: number }[];

test.use({ storageState: { cookies: [], origins: [] } });

test('counters are stored under a keyed hash of the visitor\'s NETWORK, not their IP address', async ({ request, baseURL }) => {
  const v4 = `203.0.113.${100 + Math.floor(Math.random() * 100)}`, v6a = `2001:db8:${(Math.random() * 60000 | 0).toString(16)}:5::1`, v6b = v6a.replace('::1', ':abcd::99');
  const hit = (ip: string) => request.post('/api/reveal', { data: { kind: 'unknown' }, headers: sameOrigin(baseURL!, ip) });
  for (let i = 0; i < 3; i++) await hit(v4);
  await hit(v6a); await hit(v6b);
  const k4 = `reveal:${keyOf(networkOf(v4))}`, k6 = `reveal:${keyOf(networkOf(v6a))}`;
  expect(rows(k4)).toEqual([{ key: k4, count: 3 }]);
  expect(rows(k6), 'two addresses in one /64 share one counter').toEqual([{ key: k6, count: 2 }]);
  for (const r of d1('e2e-a', "SELECT key FROM login_attempts WHERE key NOT LIKE '%test%'") as { key: string }[])
    expect(r.key, 'no IP address may appear in a stored key').toMatch(/^(login|reveal|contact|setup|acct):[0-9a-f]{32}$/);
});

test('failed sign-ins are counted per account without storing the email address', async ({ request, baseURL }) => {
  const email = `Private.Person+${Date.now()}@Example.com`;
  await login(request, baseURL!, email, 'wrong password here', freshIp());
  await login(request, baseURL!, email.toLowerCase(), 'wrong password again', freshIp());      // same account, different spelling of the case
  const key = `acct:${keyOf(email.trim().toLowerCase())}`;
  expect(rows(key)).toEqual([{ key, count: 2 }]);
  expect(JSON.stringify(d1('e2e-a', 'SELECT key FROM login_attempts')).toLowerCase()).not.toContain('private.person');
});
