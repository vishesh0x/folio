/** Fallbacks only. The owner's values, saved in Dashboard → Settings (D1), take precedence. */
export const SITE_DEFAULTS = {
  name: 'Your Name',
  tagline: 'Designer & developer',
  description: 'Personal website and portfolio.',
};
/** The public navigation links. */
export const NAV: { href: string; label: string; cta?: boolean }[] = [
  { href: '/projects', label: 'Projects' },
  { href: '/now', label: 'Now' },
  { href: '/resume', label: 'Resume' },
  { href: '/contact', label: 'Contact', cta: true },
];
