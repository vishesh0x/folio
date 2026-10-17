// Fallbacks only. From Step 3 these come from the dashboard "Site settings" (D1).
export const SITE_DEFAULTS = {
  name: 'Your Name',
  tagline: 'Designer & developer',
  description: 'Personal website and portfolio.',
};
export const NAV: { href: string; label: string; cta?: boolean }[] = [
  { href: '/projects', label: 'Projects' },
  { href: '/now', label: 'Now' },
  { href: '/resume', label: 'Resume' },
  { href: '/contact', label: 'Contact', cta: true },
];
