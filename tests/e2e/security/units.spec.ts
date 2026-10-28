import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { networkOf } from '../../../src/lib/ip';
import { acceptAnswer, hostMatches, isCloudflareTestSecret, isLocalHost, verifierUrl } from '../../../src/lib/turnstile-rules';
import { stripMetadata, exifOrientation } from '../../../src/lib/strip';
import { sniffBinary } from '../../../src/lib/sniff';

// Pure logic, tested directly (no server): IPv6 networks, Turnstile's rules, metadata stripping, file-type detection.

test.describe('networkOf: who counts as the same visitor for rate limiting', () => {
  const CASES: [string, string][] = [
    ['203.0.113.9', '203.0.113.9'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'], ['2001:db8:1:2::2', '2001:db8:1:2::/64'], ['2001:0db8:0001:0002:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2:abcd::1', '2001:db8:1:2::/64'], ['[2001:db8:1:2::1]', '2001:db8:1:2::/64'], ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['2001:db8:1:3::1', '2001:db8:1:3::/64'], ['::1', '0:0:0:0::/64'],
    ['::ffff:203.0.113.9', '203.0.113.9'], ['::ffff:cb00:7109', '203.0.113.9'], ['0:0:0:0:0:ffff:203.0.113.9', '203.0.113.9'],
    ['local', 'local'], ['not an ip', 'not an ip'], ['1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8:9'], ['2001:db8::1::2', '2001:db8::1::2'],
  ];
  for (const [input, want] of CASES) test(`${input} → ${want}`, () => expect(networkOf(input)).toBe(want));
  test('two addresses in one /64 are one visitor, two different /64s are two', () => {
    expect(networkOf('2001:db8:aaaa:1::1')).toBe(networkOf('2001:db8:aaaa:1:1234:5678:9abc:def0'));
    expect(networkOf('2001:db8:aaaa:1::1')).not.toBe(networkOf('2001:db8:aaaa:2::1'));
  });
  test('is bounded: absurd input cannot make a huge key', () => expect(networkOf('x'.repeat(5000)).length).toBeLessThanOrEqual(64));
});

test.describe('Turnstile rules', () => {
  test('the test-only verifier override is honoured for localhost only', () => {
    const OFFICIAL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify', FAKE = 'http://127.0.0.1:9911/verify';
    for (const h of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) expect(verifierUrl(h, FAKE, OFFICIAL), h).toBe(FAKE);
    for (const h of ['visheshraghuvanshi.in', 'www.visheshraghuvanshi.in', 'example.workers.dev', 'localhost.evil.example', 'evil.example', '']) expect(verifierUrl(h, FAKE, OFFICIAL), h).toBe(OFFICIAL);
    expect(verifierUrl('localhost', undefined, OFFICIAL)).toBe(OFFICIAL);
    expect(isLocalHost('localhost.evil.example')).toBe(false);
  });
  test('host names are compared sensibly', () => {
    expect(hostMatches('Example.com', 'example.com')).toBe(true); expect(hostMatches('www.example.com', 'example.com')).toBe(true);
    expect(hostMatches('example.com:443', 'example.com')).toBe(true); expect(hostMatches('evil.example', 'example.com')).toBe(false); expect(hostMatches('example.com.evil.example', 'example.com')).toBe(false);
  });
  const REAL = '0x4AAAAAAA-real-looking-secret-key', here = { hostname: 'site.example', action: 'reveal' };
  test('an answer must say success, and name this site and this widget', () => {
    expect(acceptAnswer({ success: true, hostname: 'site.example', action: 'reveal' }, here, REAL)).toBe(true);
    expect(acceptAnswer({ success: true, hostname: 'www.site.example' }, here, REAL)).toBe(true);        // no action named: an unnamed widget is fine
    expect(acceptAnswer({ success: true }, here, REAL)).toBe(true);
    expect(acceptAnswer({ success: false, hostname: 'site.example' }, here, REAL)).toBe(false);
    expect(acceptAnswer({}, here, REAL)).toBe(false);
    expect(acceptAnswer({ success: true, hostname: 'evil.example', action: 'reveal' }, here, REAL), 'token from another site').toBe(false);
    expect(acceptAnswer({ success: true, hostname: 'site.example', action: 'contact' }, here, REAL), 'token from another widget').toBe(false);
  });
  test('Cloudflare\'s dummy secrets answer with a made-up site, so only success is required for them', () => {
    expect(isCloudflareTestSecret('1x0000000000000000000000000000000AA')).toBe(true); expect(isCloudflareTestSecret('2x0000000000000000000000000000000AA')).toBe(true);
    expect(isCloudflareTestSecret('0x4AAAAAAAreal')).toBe(false); expect(isCloudflareTestSecret('1x000')).toBe(false);
    expect(acceptAnswer({ success: true, hostname: 'example.com', action: 'test' }, here, '1x0000000000000000000000000000000AA')).toBe(true);
  });
});

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/${n}`));
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const SECRETS = ['SecretCamera', 'SERIAL-1234', 'SecretEditing', 'SECRET-COMMENT', 'SECRET-XMP', 'SECRET-PERSON', 'SECRET-ITXT', '2024:06:01', 'xmpmeta'];

test.describe('stripMetadata: location, camera and comments are removed, the picture is not', () => {
  for (const [file, mime] of [['photo-gps.jpg', 'image/jpeg'], ['photo-gps-noorient.jpg', 'image/jpeg'], ['photo-meta.png', 'image/png'], ['photo-meta.webp', 'image/webp']] as const) {
    test(`${file}: nothing personal is left`, () => {
      const before = fx(file), after = stripMetadata(before, mime);
      const marks = file.includes('noorient') ? ['Exif'] : SECRETS;                       // the GPS-only photo has numbers, not text
      expect(marks.filter((s) => text(before).includes(s)).length, 'fixture should contain personal data').toBeGreaterThan(0);
      expect(marks.filter((s) => text(after).includes(s))).toEqual([]);
      expect(after.length).toBeLessThan(before.length);
      expect(sniffBinary(after)?.mime).toBe(mime);                                        // still the same kind of file...
      expect(sniffBinary(after)?.width).toBe(sniffBinary(before)?.width);                 // ...of the same size
    });
  }
  test('a phone photo keeps its "rotate me" flag (otherwise portrait photos would show sideways) but nothing else of its EXIF', () => {
    const out = text(stripMetadata(fx('photo-gps.jpg'), 'image/jpeg')), at = out.indexOf('Exif\0\0');
    expect(at).toBeGreaterThan(0);
    expect(exifOrientation(new Uint8Array(Buffer.from(out.slice(at + 6), 'latin1')))).toBe(6);
    const segment = (out.charCodeAt(at - 2) << 8) | out.charCodeAt(at - 1);              // the length written in front of the EXIF block
    expect(segment, 'the EXIF block holds only the orientation').toBeLessThanOrEqual(40);
  });
  test('a photo with GPS but no rotation flag ends with no EXIF block at all', () => {
    expect(text(stripMetadata(fx('photo-gps-noorient.jpg'), 'image/jpeg'))).not.toContain('Exif');
  });
  test('files with nothing to remove come back byte for byte identical', () => {
    for (const [f, m] of [['plain.png', 'image/png'], ['plain.webp', 'image/webp']] as const) expect(Buffer.from(stripMetadata(fx(f), m)).equals(Buffer.from(fx(f)))).toBe(true);
  });
  test('a PNG loses anything stored after its end marker, and keeps everything before it', () => {
    const png = fx('plain.png'), tail = Buffer.concat([Buffer.from(png), Buffer.from('HIDDEN-SECOND-FILE')]);
    const out = stripMetadata(new Uint8Array(tail), 'image/png');
    expect(Buffer.from(out).equals(Buffer.from(png))).toBe(true);
  });
  test('unreadable or odd input is returned unchanged and never throws', () => {
    for (const junk of [new Uint8Array([]), new Uint8Array([0xff, 0xd8]), new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]), fx('photo-gps.jpg').slice(0, 60), new Uint8Array(500).fill(7)])
      for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']) expect(() => stripMetadata(junk, m)).not.toThrow();
  });
  test('PNG chunks stay intact: signature, then the same IHDR and IEND', () => {
    const o = stripMetadata(fx('photo-meta.png'), 'image/png'), s = text(o);
    expect(s.slice(1, 4)).toBe('PNG'); expect(s.includes('IHDR')).toBe(true); expect(s.includes('IDAT')).toBe(true); expect(s.endsWith('IEND\xaeB`\x82')).toBe(true);
  });
  test('WebP: the RIFF length is correct after chunks were removed', () => {
    const o = stripMetadata(fx('photo-meta.webp'), 'image/webp');
    expect(new DataView(o.buffer, o.byteOffset).getUint32(4, true)).toBe(o.length - 8);
  });
});

test.describe('sniffBinary: the first bytes decide', () => {
  const png = fx('plain.png');
  test('a real PNG, JPEG, WebP, GIF, PDF', () => {
    expect(sniffBinary(png)?.mime).toBe('image/png'); expect(sniffBinary(fx('photo-gps.jpg'))?.mime).toBe('image/jpeg'); expect(sniffBinary(fx('plain.webp'))?.mime).toBe('image/webp');
    expect(sniffBinary(new TextEncoder().encode('GIF89a\x01\0\x01\0\x80\0\0\0\0\0\xff\xff\xff;'))?.mime).toBe('image/gif'); expect(sniffBinary(new TextEncoder().encode('GIF87a\x01\0\x01\0\x80\0\0\0\0\0\xff\xff\xff;'))?.mime).toBe('image/gif');
    expect(sniffBinary(new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n'))?.mime).toBe('application/pdf');
  });
  test('look-alikes are NOT accepted', () => {
    const e = (s: string) => new TextEncoder().encode(s);
    expect(sniffBinary(e('GIF<script>alert(1)</script>'))).toBeNull();                       // "GIF" alone is not a GIF
    expect(sniffBinary(e('GIF90a\x01\0\x01\0'))).toBeNull();
    const noIhdr = png.slice(); noIhdr.set(e('XXXX'), 12); expect(sniffBinary(noIhdr)).toBeNull();     // PNG signature but no header chunk
    expect(sniffBinary(e('<html><script>alert(1)</script></html>'))).toBeNull(); expect(sniffBinary(e('MZ\x90\0\x03\0\0\0'))).toBeNull(); expect(sniffBinary(e('PK\x03\x04'))).toBeNull();
    expect(sniffBinary(new Uint8Array(0))).toBeNull(); expect(sniffBinary(new Uint8Array(8))).toBeNull();
  });
});
