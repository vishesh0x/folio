import { format, parseISO } from "date-fns";

/**
 * Format a `YYYY-MM-DD` (date-only) or full ISO string.
 * `new Date("2026-09-01")` is UTC midnight, which renders as the previous day
 * in timezones behind UTC. `parseISO` treats date-only strings as local time.
 */
export function formatDate(value: string | null | undefined, pattern = "MMM yyyy"): string | null {
  if (!value) return null;
  const d = parseISO(value);
  return Number.isNaN(d.getTime()) ? null : format(d, pattern);
}
