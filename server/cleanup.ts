// Deleting things that others hang on: a product has color mockups, a mockup has photos. Files go with their rows.
import { all, get, run } from './db.ts';
import { removeFiles } from './files.ts';
import { cancelJob } from './queue.ts';
import { pruneEmptyListing } from './listings.ts';

const marks = (list: unknown[]) => list.map(() => '?').join(',');

/** Delete photos: rows and files. */
export async function deleteShoots(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = all(`SELECT id, file, thumb FROM shoots WHERE id IN (${marks(ids)})`, ...ids);
  if (!rows.length) return 0;
  run(`DELETE FROM shoots WHERE id IN (${marks(rows)})`, ...rows.map(r => r.id));
  await removeFiles(...rows.flatMap(r => [String(r.file), String(r.thumb)]));
  return rows.length;
}

/**
 * Delete mockups with their renders and, unless asked to keep them, the photos made from them (a photo whose mockup is gone belongs to no product).
 * Photos still being made for them are cancelled. A product left with no colors goes too, when nobody has worked on it.
 */
export async function deleteMockups(ids: string[], opts: { keepPhotos?: boolean } = {}): Promise<{ mockups: number; photos: number }> {
  if (!ids.length) return { mockups: 0, photos: 0 };
  const rows = all(`SELECT id, renders, listing_id FROM mockups WHERE id IN (${marks(ids)})`, ...ids);
  if (!rows.length) return { mockups: 0, photos: 0 };
  const gone = new Set(rows.map(r => String(r.id)));
  for (const j of all(`SELECT id, input FROM jobs WHERE type = 'shoot' AND status IN ('queued','running')`)) {
    try { if (gone.has(String(JSON.parse(String(j.input)).mockupId))) cancelJob(String(j.id)); } catch { /* unreadable input */ }
  }
  const photos = opts.keepPhotos ? 0 : await deleteShoots(all(`SELECT id FROM shoots WHERE mockup_id IN (${marks(rows)})`, ...rows.map(r => r.id)).map(r => String(r.id)));
  run(`DELETE FROM mockups WHERE id IN (${marks(rows)})`, ...rows.map(r => r.id));
  await removeFiles(...rows.flatMap(r => Object.values(JSON.parse(String(r.renders || '{}'))) as string[]));
  for (const l of new Set(rows.map(r => r.listing_id).filter(Boolean))) pruneEmptyListing(String(l));
  return { mockups: rows.length, photos };
}

/**
 * Delete products. With `mockups`, their color mockups go too (and with `photos`, the photos made from them).
 * Without `mockups` only the product record goes and its mockups wait for a new product (the Studio makes one for them again).
 * Nothing is ever deleted in Shopify from here.
 */
export async function deleteListings(ids: string[], opts: { mockups?: boolean; photos?: boolean } = {}): Promise<{ products: number; mockups: number; photos: number }> {
  let products = 0, mockups = 0, photos = 0;
  for (const id of ids) {
    if (!get('SELECT 1 x FROM listings WHERE id = ?', id)) continue;
    if (opts.mockups) {
      const r = await deleteMockups(all('SELECT id FROM mockups WHERE listing_id = ?', id).map(m => String(m.id)), { keepPhotos: !opts.photos });
      mockups += r.mockups; photos += r.photos;
    } else run('UPDATE mockups SET listing_id = NULL WHERE listing_id = ?', id);
    run('DELETE FROM listings WHERE id = ?', id);
    products++;
  }
  return { products, mockups, photos };
}
