/**
 * Which "network" is a visitor on, for rate limiting?
 *
 * IPv4: the address itself. IPv6: the first 64 bits (the /64). One home or phone connection is given a whole /64, i.e. 2^64 addresses,
 * so counting per full IPv6 address would let a single visitor start over with a new address on every attempt. An IPv4-mapped IPv6
 * address (::ffff:1.2.3.4) is the same visitor as 1.2.3.4. Anything that is not an IP address ("local" in development) is left alone.
 * Pure function, no dependencies, so it can be tested directly.
 */
function parseV6(s: string): number[] | null {
  let ip = s;
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);          // trailing IPv4 part, e.g. ::ffff:1.2.3.4
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    ip = ip.slice(0, dotted.index) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

export function networkOf(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  if (!ip.includes(':')) return ip.slice(0, 64);
  const g = parseV6(ip);
  if (!g) return ip.slice(0, 64);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  return g.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';
}
