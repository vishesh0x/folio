// How much CPU does the Worker really use per request?  The free Workers plan allows 10 ms of CPU per request; time spent WAITING (for the
// database, storage, the network) does not count. The operating system keeps an exact account of the CPU time each thread of the local
// Worker runtime (workerd) has used, so we read that before and after a run of requests and divide. (A sampling profiler was tried first
// and rejected: on a one-core machine it counts time spent waiting for the core as busy, and results varied by a factor of ten.)
//   const r = await cpuPerRequest(8791, () => send('GET', '/now?x=' + Math.random()), { runs: 60 });
//   r.msPerRequest = CPU of the busiest thread (where the JavaScript runs) per request;  r.msProcess = all threads of the runtime together
// Reading these numbers:
//   * the machine's processor is not Cloudflare's, so use them to COMPARE (before/after, 10 files against 1,000), not as a promise;
//   * local D1/R2/cache are simulated by JavaScript inside the same runtime, so absolute figures here are an UPPER bound for production;
//   * the first requests run slower (code is compiled on first use), so `warmup` requests are made first and not counted.
import { readdirSync, readFileSync } from 'node:fs';

const TICK = 1000 / 100; // Linux counts CPU in 10 ms ticks (USER_HZ = 100)
export function workerdPid(port) {
  for (const p of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try { const c = readFileSync(`/proc/${p}/cmdline`, 'utf8'); if (c.includes('workerd') && c.includes(`entry=localhost:${port}`)) return Number(p); } catch {}
  }
  throw new Error(`no local Worker runtime found for port ${port}`);
}
const threadTicks = (pid) => Object.fromEntries(readdirSync(`/proc/${pid}/task`).flatMap((t) => {
  try { const s = readFileSync(`/proc/${pid}/task/${t}/stat`, 'utf8'); const f = s.slice(s.lastIndexOf(')') + 2).split(' '); return [[t, Number(f[11]) + Number(f[12])]]; } catch { return []; }
}));
export async function cpuPerRequest(port, fn, { runs = 60, warmup = 15 } = {}) {
  const pid = workerdPid(port);
  for (let i = 0; i < warmup; i++) await fn(i);
  const before = threadTicks(pid); const t0 = Date.now();
  for (let i = 0; i < runs; i++) await fn(warmup + i);
  const after = threadTicks(pid), wallMs = Date.now() - t0;
  const deltas = Object.keys(after).map((t) => (after[t] - (before[t] ?? 0)) * TICK);
  return { runs, wallMs, msPerRequest: Math.max(...deltas) / runs, msProcess: deltas.reduce((a, b) => a + b, 0) / runs };
}
