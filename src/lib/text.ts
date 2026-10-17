const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** "Building *small, sharp* things" -> HTML with the starred part in <em> (coloured by the stylesheet). Everything else is escaped first, so it is safe to insert. */
export function emphasis(s: string): string {
  return esc(s).replace(/\*([^*\n]{1,80})\*/g, '<em>$1</em>');
}
