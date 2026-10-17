import type { APIRoute } from 'astro';
import * as N from '../../../lib/now-admin';
import { getSettings, saveSettings } from '../../../lib/settings';

const GONE_ITEM = 'That item no longer exists. It may have been removed in another tab.';
const GONE_CAT = 'That category no longer exists. It may have been removed in another tab.';
const to = (kind: 'ok' | 'error', msg: string, anchor = '') =>
  new Response(null, { status: 303, headers: { Location: `/dashboard/now?${kind}=${encodeURIComponent(msg)}${anchor}` } });

export const POST: APIRoute = async ({ request }) => {
  const f = await request.formData();
  const action = String(f.get('action') ?? '');
  const id = Number(f.get('id'));
  const catId = Number(f.get('category_id'));
  const hasId = Number.isInteger(id) && id > 0;
  const anchor = Number.isInteger(catId) && catId > 0 ? `#cat-${catId}` : '';

  if (action === 'intro') {
    const s = await getSettings();
    await saveSettings({ ...s, now_intro: String(f.get('intro') ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) });
    return to('ok', 'Intro saved.');
  }
  if (action === 'cat-add') {
    const err = await N.addCategory(N.parseName(f.get('name')), N.parseIcon(f.get('icon')));
    return err ? to('error', err) : to('ok', 'Category added.');
  }
  if (action === 'cat-rename' && hasId) {
    const err = await N.renameCategory(id, N.parseName(f.get('name')), N.parseIcon(f.get('icon')));
    return err ? to('error', err, `#cat-${id}`) : to('ok', 'Category saved.', `#cat-${id}`);
  }
  if (action === 'cat-delete' && hasId) return (await N.deleteCategory(id)) ? to('ok', 'Category and its items removed.') : to('error', GONE_CAT);
  if ((action === 'cat-up' || action === 'cat-down') && hasId) return (await N.moveCategory(id, action === 'cat-up' ? 'up' : 'down')) ? to('ok', 'Moved.', `#cat-${id}`) : to('error', GONE_CAT);

  if (action === 'item-add' || action === 'item-update') {
    const title = N.parseTitle(f.get('title')), link = N.parseLink(f.get('link'));
    const started = N.parseMonth(f.get('started')), finished = N.parseMonth(f.get('finished')), progress = N.parseProgress(f.get('progress'));
    const a = action === 'item-update' && hasId ? `#cat-${catId || ''}` : anchor;
    if (!title) return to('error', 'Give it a title.', a);
    if (link === 'bad') return to('error', 'The link must be a full address starting with https://', a);
    if (progress === 'bad') return to('error', 'Progress must be a whole number from 0 to 100.', a);
    if (started === 'bad' || finished === 'bad') return to('error', 'Dates must be a month from 1990 up to this month (not in the future).', a);
    const status = f.get('status') === 'done' ? 'done' : 'current';
    const dateErr = N.checkDates(started, finished, status);
    if (dateErr) return to('error', dateErr, a);
    const input = { title, note: N.parseNote(f.get('note')), link, started_at: started, finished_at: finished, progress };
    if (action === 'item-add') {
      if (!(catId > 0)) return to('error', 'Choose a category.');
      const err = await N.addItem(catId, status, input);
      return err ? to('error', err, a) : to('ok', 'Added.', a);
    }
    if (!hasId || !(catId > 0)) return to('error', 'That item could not be found.');
    const err = await N.updateItem(id, catId, input);
    return err ? to('error', err, a) : to('ok', 'Saved.', a);
  }

  if (hasId) {
    let found = true;
    if (action === 'item-done') found = await N.markDone(id);
    else if (action === 'item-reopen') found = await N.reopen(id);
    else if (action === 'item-delete') { found = await N.deleteItem(id); return found ? to('ok', 'Removed.', anchor) : to('error', GONE_ITEM); }
    else if (action === 'item-up' || action === 'item-down') found = await N.moveItem(id, action === 'item-up' ? 'up' : 'down');
    else return to('error', 'Unknown action.');
    return found ? to('ok', 'Done.', anchor) : to('error', GONE_ITEM, anchor);
  }
  return to('error', 'Nothing was changed.');
};
