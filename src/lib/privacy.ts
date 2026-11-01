// The default privacy notice. It is plain-language text that states what this site really does (each claim here has a test that checks the site
// still behaves that way: tests/e2e/quality/privacy.spec.ts). The owner can replace it in Settings. It is a starting point, not legal advice: the
// owner should read it once and make sure it is true for their own set-up (for example if Cloudflare Web Analytics is switched off).
export function defaultPrivacyMd(name: string): string {
  return `This website belongs to ${name}, an individual. This page explains what happens to your information when you visit it. If anything is unclear, or you want to ask about your data, use the contact form on this site.

## What the site collects

**If you send a message through the contact form**, the site stores the name, email address, subject (if you give one) and message you type, together with the time you sent it. I use them only to read and reply to your message. They are not sold, shared for marketing or used to build a profile of you.

**If you only read the site**, it does not ask for or store anything about you. To keep the form and the sign-in page safe from automated abuse, the site briefly keeps a scrambled code made from your network address (never the address itself), with the number and time of recent attempts. These records are deleted automatically within a few hours.

## Cookies and similar storage

Visitors get **no cookies**. A single session cookie is set only for the site owner when signing in to the private dashboard. Your browser's local storage keeps one small item, your light or dark theme choice; it stays on your device and is not sent to the server.

## Services that process data for this site

The site runs on **Cloudflare**, which acts on my behalf as the provider of hosting, caching, the database that stores contact messages, file storage and image processing. Cloudflare's servers handle every request to the site, so they see technical information that any website host sees (such as your IP address, browser type and the pages you ask for), and they may process it in data centres around the world.

- **Cloudflare Turnstile** may be shown on the contact form and sign-in page to tell people from automated programs. It checks your browser; it is not used to track you across sites.
- **Cloudflare Web Analytics** counts visits in aggregate (pages viewed, countries, browsers) without cookies and without following you across sites.

No advertising, social-media tracking or other third-party scripts are used, and the site loads its fonts and images from its own address.

## How long messages are kept

Messages are kept until I delete them, which I do when they are no longer needed. You can ask me to delete your messages sooner at any time.

## Your choices and rights

You can ask what I hold about you, ask me to correct it, or ask me to delete it. Depending on where you live (for example under the EU and UK GDPR, or India's Digital Personal Data Protection Act, 2023) you may have further rights, including withdrawing consent and complaining to your local data protection authority. Use the contact form to make a request; I will answer as soon as I can.

## Changes

If this notice changes, the new version will replace it on this page.
`;
}
