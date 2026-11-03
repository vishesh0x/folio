import { test, expect } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { makeZip, readZip } from '../../../src/scripts/backup';

// The browser code that writes and reads backup zips, tested directly (no server). A backup file may
// come from another zip program, be damaged, or be hostile, so the reader is as important as the
// writer.
const enc = new TextEncoder();
const bytes = (blob: Blob) => blob.arrayBuffer();

function crc(b: Uint8Array) { let c = 0xffffffff; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }
/**
 * A zip built by hand, so tests can make deflated entries (as other zip programs do) and deliberately
 * wrong ones.
 */
function rawZip(entries: { name: string; data: Uint8Array; method?: 0 | 8; flags?: number; crc?: number; usize?: number; localOffsetBias?: number }[], eocd: { count?: number; cdOffset?: number } = {}) {
  const parts: Uint8Array[] = [], central: Uint8Array[] = []; let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), body = e.method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data, c = e.crc ?? crc(e.data), usize = e.usize ?? e.data.length;
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, e.flags ?? 0, true); h.setUint16(8, e.method ?? 0, true); h.setUint32(14, c, true); h.setUint32(18, body.length, true); h.setUint32(22, usize, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, body);
    const d = new DataView(new ArrayBuffer(46)); d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, e.flags ?? 0, true); d.setUint16(10, e.method ?? 0, true); d.setUint32(16, c, true); d.setUint32(20, body.length, true); d.setUint32(24, usize, true); d.setUint16(28, name.length, true); d.setUint32(42, off, true);
    central.push(new Uint8Array(d.buffer), name); off += 30 + name.length + body.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, eocd.count ?? entries.length, true); end.setUint16(10, eocd.count ?? entries.length, true); end.setUint32(12, size, true); end.setUint32(16, eocd.cdOffset ?? off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out.buffer;
}

test.describe('writing and reading', () => {
  test('what is written is read back exactly: names (including accents), empty files, and a few MB of data', async () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 251);
    const zip = makeZip([{ name: 'manifest.json', data: enc.encode('{"a":1}') }, { name: 'files/abc/café-ü.png', data: big }, { name: 'empty.txt', data: new Uint8Array(0) }]);
    const back = await readZip(await bytes(zip));
    expect([...back.keys()]).toEqual(['manifest.json', 'files/abc/café-ü.png', 'empty.txt']);
    expect(Buffer.from(back.get('files/abc/café-ü.png')!).equals(Buffer.from(big))).toBe(true);
    expect(back.get('empty.txt')!.length).toBe(0);
  });
  test('it is a real zip: begins with the zip signature and ends with the end-of-archive record, with names readable in the bytes', async () => {
    const buf = Buffer.from(await bytes(makeZip([{ name: 'site.json', data: enc.encode('{"hello":"world"}') }])));
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304'); expect(buf.includes(Buffer.from('site.json'))).toBe(true); expect(buf.includes(Buffer.from('{"hello":"world"}'))).toBe(true);
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
  });
  test('zips made by other programs (deflated entries) are read too', async () => {
    const text = enc.encode('hello hello hello hello '.repeat(500));
    const back = await readZip(rawZip([{ name: 'a.txt', data: text, method: 8 }, { name: 'b.txt', data: enc.encode('stored'), method: 0 }]));
    expect(Buffer.from(back.get('a.txt')!).equals(Buffer.from(text))).toBe(true); expect(Buffer.from(back.get('b.txt')!).toString()).toBe('stored');
  });
});

test.describe('refusing what it should not open', () => {
  const data = enc.encode('payload');
  const refuse = async (buf: ArrayBuffer, re: RegExp) => { await expect(readZip(buf)).rejects.toThrow(re); };
  test('not a zip, or cut short', async () => {
    await refuse(enc.encode('this is a text file, not a zip at all').buffer as ArrayBuffer, /not a zip/);
    const ok = rawZip([{ name: 'a', data }]); await refuse(ok.slice(0, ok.byteLength - 10), /not a zip|damaged/);
  });
  test('a file whose content was changed (checksum mismatch) is refused', async () => {
    const buf = new Uint8Array(rawZip([{ name: 'a.txt', data }])); buf[30 + 5] ^= 0xff;  // A byte of the stored content
    await refuse(buf.buffer, /damaged|checksum/);
  });
  for (const name of ['../evil.txt', '/etc/passwd', 'files/../../x', 'a\\b.txt', './x', 'x/./y']) test(`an unsafe file name is refused: ${name}`, async () => { await refuse(rawZip([{ name, data }]), /unsafe file name/); });
  test('password-protected, zip64 and absurd entry counts are refused', async () => {
    await refuse(rawZip([{ name: 'a', data, flags: 1 }]), /password/);
    await refuse(rawZip([{ name: 'a', data }], { cdOffset: 0xffffffff }), /zip64/);
    await refuse(rawZip([{ name: 'a', data }], { count: 7000 }), /too many files/);
  });
  test('a "zip bomb" (tiny file claiming to be gigabytes) is refused before anything is inflated', async () => {
    await refuse(rawZip([{ name: 'a', data, usize: 0x7fffffff }]), /too big/);
  });
});
