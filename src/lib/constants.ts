/** Tiny, dependency-free constants shared by client + server (keeps zod out of the main bundle). */
export const MIN_PASSWORD = 12;

/** How a contact detail (email / phone) is exposed on the public site. */
export const PRIVACY_MODES = ["public", "reveal", "hidden"] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];
export const isPrivacyMode = (v: unknown): v is PrivacyMode =>
  typeof v === "string" && (PRIVACY_MODES as readonly string[]).includes(v);
