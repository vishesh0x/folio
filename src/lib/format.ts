export const bytes = (n: number) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(n ? 1 : 0, Math.round(n / 1024)) + ' KB');
export function ago(ts: number, now = Math.floor(Date.now() / 1000)): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: s > 86400 * 300 ? 'numeric' : undefined }).format(new Date(ts * 1000));
}
