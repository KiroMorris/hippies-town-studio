// Products (Shopify-ready listings): one design set on one garment style; each color mockup is a variant,
// and every shoot made from those mockups lands in the product's gallery automatically.
import { SHOT_TEMPLATES, SIZES, smallUrl, type Listing, type ListingCheck, type ListingDetail, type ListingMedia, type View } from '../shared/types.ts';
import { all, get, insert, newId, now, run, update } from './db.ts';
import { getProduct } from './catalog.ts';
import { profileForStyle } from './shopify-profiles.ts';
import { fileUrl } from './files.ts';

type Row = Record<string, any>;
const rows = (sql: string, ...p: unknown[]) => all(sql, ...p) as Row[];
const json = <T>(v: unknown, fallback: T): T => { try { return v ? JSON.parse(String(v)) : fallback; } catch { return fallback; } };

/** A description that is empty, or only the one-line starter the Studio fills in, still needs writing. */
export const isUnwritten = (description: unknown) => {
  const d = String(description ?? '').trim();
  return !d || d.length < 50 || (!/\n\s*\n/.test(d) && /, printed on [^.]+\.$/.test(d));
};

export const styleOf = (productId: string) => productId.split('__')[0];
const designIdsOf = (views: unknown) => {
  const v = json<Record<View, { designId: string }[]>>(views, { front: [], back: [] });
  return [...new Set([...(v.front ?? []), ...(v.back ?? [])].map(l => l.designId))].sort();
};
/** The designs actually printed on a product: those in its mockups' layers. The saved key can be older than a mockup's latest edit (a sleeve print added later), so it is only the fallback. */
export function listingDesignIds(row: Row, mockups: Row[]) {
  const placed = [...new Set(mockups.flatMap(m => designIdsOf(m.views)))].sort();
  return placed.length ? placed : String(row.design_key).split(',').filter(Boolean);
}

/** Put a mockup in the product for its style + designs, creating the product if needed. Mockups without prints stay unassigned. */
export function assignListing(mockupId: string) {
  const m = get('SELECT * FROM mockups WHERE id = ?', mockupId);
  if (!m || m.listing_id) return;
  const ids = designIdsOf(m.views);
  if (!ids.length) return;
  const style = styleOf(String(m.product_id)), key = ids.join(',');
  let listing = get('SELECT id FROM listings WHERE style = ? AND design_key = ?', style, key);
  if (!listing) {
    const designs = rows(`SELECT id, title FROM designs WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    const product = getProduct(String(m.product_id));
    const title = `${designs.map(d => d.title).join(' + ') || 'Untitled'} - ${product?.style ?? style}`;
    const id = newId('lst');
    insert('listings', { id, title, style, design_key: key, sizes: JSON.stringify(profileForStyle(product?.style ?? '')?.family.sizes ?? ['S', 'M', 'L', 'XL', '2XL']), created_at: now(), updated_at: now() });
    listing = { id };
  }
  update('mockups', mockupId, { listing_id: listing.id });
}

/** A product loses its last color when that mockup moves to another garment style: remove the empty shell, unless someone has worked on it (pushed, priced, written, tagged). */
export function pruneEmptyListing(listingId: string) {
  const l = get('SELECT * FROM listings WHERE id = ?', listingId);
  if (!l || get('SELECT 1 x FROM mockups WHERE listing_id = ?', listingId)) return;
  const worked = l.shopify || l.shopify_id || l.price != null || l.compare_at != null || !isUnwritten(l.description) || json<string[]>(l.tags, []).length || l.seo_title || l.seo_description || l.copy_at || l.status === 'ready';
  if (!worked) run('DELETE FROM listings WHERE id = ?', listingId);
}

/** Give every existing mockup a product (runs on boot; cheap and idempotent). */
export function backfillListings() {
  for (const m of rows('SELECT id FROM mockups WHERE listing_id IS NULL')) assignListing(String(m.id));
}

const SHOT_ORDER = Object.fromEntries(SHOT_TEMPLATES.map((t, i) => [t.key, i]));

function mediaFor(listing: Row, mockups: Row[]): ListingMedia[] {
  const hidden = new Set(json<string[]>(listing.hidden, []));
  const color = (m: Row) => getProduct(String(m.product_id))?.color ?? '';
  const byId = Object.fromEntries(mockups.map(m => [m.id, m]));
  const shoots = mockups.length ? rows(`SELECT * FROM shoots WHERE mockup_id IN (${mockups.map(() => '?').join(',')})`, ...mockups.map(m => m.id)) : [];
  // Default order: e-commerce shots (favorites first), flat mockups, lifestyle, back mockups.
  const items: (ListingMedia & { rank: number })[] = [];
  for (const s of shoots) {
    const t = SHOT_TEMPLATES.find(x => x.key === s.shot);
    items.push({ key: `shoot:${s.id}`, kind: 'shoot', url: fileUrl(s.file)!, thumbUrl: fileUrl(s.thumb)!, label: t?.label ?? s.shot, color: color(byId[s.mockup_id]), hidden: false,
      rank: (s.kind === 'ecom' ? 0 : 2000) + (s.favorite ? 0 : 500) + (SHOT_ORDER[s.shot] ?? 50) * 10 });
  }
  for (const m of mockups) for (const [v, file] of Object.entries(json<Record<string, string>>(m.renders, {}))) {
    const url = `${fileUrl(file)}?v=${encodeURIComponent(m.updated_at)}`;
    items.push({ key: `mockup:${m.id}:${v}`, kind: 'mockup', url, thumbUrl: smallUrl(url), label: `Mockup · ${v}`, color: color(m), hidden: false, rank: v === 'front' ? 1000 : 3000 });
  }
  const saved = json<string[]>(listing.media, []);
  const pos = (k: string) => { const i = saved.indexOf(k); return i < 0 ? Infinity : i; };
  return items
    .sort((a, b) => pos(a.key) - pos(b.key) || a.rank - b.rank)
    .map(({ rank: _rank, ...m }) => ({ ...m, hidden: hidden.has(m.key) }));
}

function checks(l: Row, designIds: string[], media: ListingMedia[], colors: number): ListingCheck[] {
  const opaque = designIds.length ? Number(get(`SELECT COUNT(*) n FROM designs WHERE transparent = 0 AND id IN (${designIds.map(() => '?').join(',')})`, ...designIds)!.n) : 0;
  const visible = media.filter(m => !m.hidden).length;
  return [
    { key: 'title', label: 'Title', ok: String(l.title).trim().length >= 5 },
    { key: 'description', label: 'Description (50+ characters)', ok: !isUnwritten(l.description) },
    { key: 'price', label: 'Price', ok: Number(l.price) > 0 },
    { key: 'variants', label: 'At least one color and size', ok: colors > 0 && json<string[]>(l.sizes, []).length > 0 },
    { key: 'photos', label: `3+ photos (${visible})`, ok: visible >= 3 },
    { key: 'print', label: 'Print files have transparent backgrounds', ok: designIds.length > 0 && opaque === 0 },
  ];
}

export function toListing(l: Row, withMedia: true): ListingDetail;
export function toListing(l: Row, withMedia?: false): Listing;
export function toListing(l: Row, withMedia = false): Listing | ListingDetail {
  const mockups = rows('SELECT * FROM mockups WHERE listing_id = ? ORDER BY created_at', l.id);
  const media = mediaFor(l, mockups);
  const designIds = listingDesignIds(l, mockups);
  const first = getProduct(String(mockups[0]?.product_id ?? ''));
  const prof = profileForStyle(first?.style ?? '');
  const pushed = json<Row | null>(l.shopify, null);
  const cover = media.find(m => !m.hidden);
  const out: Listing = {
    id: l.id, title: l.title, style: first?.style ?? l.style, productType: first?.type ?? null, description: l.description,
    price: l.price ?? null, compareAt: l.compare_at ?? null, tags: json(l.tags, []), sizes: json(l.sizes, []), status: l.status, designIds,
    seoTitle: String(l.seo_title ?? ''), seoDescription: String(l.seo_description ?? ''), copyAt: l.copy_at ?? null, note: String(l.note ?? ''),
    colors: mockups.map(m => {
      const front = json<Record<string, string>>(m.renders, {}).front;
      return { mockupId: m.id, productId: m.product_id, color: getProduct(String(m.product_id))?.color ?? m.product_id, thumbUrl: front ? smallUrl(`${fileUrl(front)}?v=${encodeURIComponent(m.updated_at)}`) : null };
    }),
    coverUrl: cover?.thumbUrl ?? null, photoCount: media.filter(m => !m.hidden).length,
    checks: checks(l, designIds, media, mockups.length), shopifyId: l.shopify_id ?? null,
    shopify: pushed?.id ? { id: pushed.id, handle: pushed.handle, adminUrl: pushed.adminUrl, status: pushed.status, pushedAt: pushed.pushedAt, variantCount: pushed.variantCount ?? 0, imageCount: pushed.imageCount ?? 0, warnings: pushed.warnings ?? [] } : null,
    shopifyRemovedAt: !pushed?.id ? (pushed?.removedAt ?? null) : null,
    profile: prof ? { key: prof.key, label: prof.family.label, basedOn: prof.family.basedOn, productType: prof.family.productType, templateSuffix: prof.family.templateSuffix, optionName: prof.family.optionName, sizes: prof.family.sizes, price: prof.family.price, compareAt: prof.family.compareAt, morePrintsPrice: prof.family.morePrintsPrice, skuPrefix: prof.family.skuPrefix, inventoryPolicy: prof.family.inventoryPolicy } : null,
    sizeOptions: prof?.family.sizes ?? SIZES,
    createdAt: l.created_at, updatedAt: l.updated_at,
  };
  return withMedia ? { ...out, media } : out;
}
