// Which uploaded files does a piece of Markdown show?
//
// ONE definition, used by the page renderer (src/lib/markdown.ts, to know which files to load) and by the Files page
// (src/lib/assets.ts, to know which files are in use and so must not be deleted). If the two ever disagreed, a picture could be shown on a page
// and still be offered for deletion. A file is shown by:
//   /media/<12-character id>/...      a normal Markdown image or link to the file
//   ![[<12-character id>]]            an Obsidian-style embed by id
//   ![[file name]] or ![[file name|300]]   an embed by name (the renderer ignores capitals and spaces around the name)
// It reads the text once, so the cost grows with the amount of text, not with (files x projects).
export const ASSET_ID = '[A-Za-z0-9_-]{12}';
const MEDIA_URL = new RegExp(`/media/(${ASSET_ID})/`, 'g');
const EMBED = /!\[\[([^\]|]+)/g;
const ID_ONLY = new RegExp(`^${ASSET_ID}$`);

export function assetRefs(md: string): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>(), names = new Set<string>();
  for (const m of md.matchAll(MEDIA_URL)) ids.add(m[1]);
  for (const m of md.matchAll(EMBED)) { const t = m[1].trim(); (ID_ONLY.test(t) ? ids : names).add(t); }
  return { ids, names };
}
