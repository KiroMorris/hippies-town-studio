// Push a product to the Shopify store as a DRAFT, shaped like the store's own products of that family
// (product type, theme template, taxonomy category, sizes, SKUs, price ladder, tags, metafields, sales channels).
// Conventions come from shopify-profiles.json (see scripts/shopify-profiles.mjs). Photos go through Shopify's staged uploads.
import sharp from 'sharp';
import { config } from './config.ts';
import { all, get, now, run, update } from './db.ts';
import { abs } from './files.ts';
import { getProduct } from './catalog.ts';
import { listingDesignIds, toListing } from './listings.ts';
import { loadProfiles, profileForStyle, type Family } from './shopify-profiles.ts';
import { closingLinks } from './copy-facts.ts';
import type { ListingDetail, ShopifyInfo, ShopifyProfilesSummary, ShopifySyncResult } from '../shared/types.ts';

type Row = Record<string, any>;
const rows = (sql: string, ...p: unknown[]) => all(sql, ...p) as Row[];
const json = <T>(v: unknown, fallback: T): T => { try { return v ? JSON.parse(String(v)) : fallback; } catch { return fallback; } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const code = (s: string) => s.replace(/\s+/g, '').slice(0, 3).toUpperCase();

/** An error whose message is safe to show the user. */
export class ShopifyError extends Error {}

// ---------- Admin API ----------
export const shopifyConfigured = () => !!(config.shopify.domain && config.shopify.token);

export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!shopifyConfigured()) throw new ShopifyError('Shopify is not set up. Add SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN to studio/.env and restart the server.');
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://${config.shopify.domain}/admin/api/${config.shopify.apiVersion}/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': config.shopify.token }, body: JSON.stringify({ query, variables }),
    });
    if (r.status === 401 || r.status === 403) throw new ShopifyError('Shopify refused the access token. Check SHOPIFY_ACCESS_TOKEN in studio/.env.');
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await sleep(1500 * (attempt + 1)); continue; }
    if (!r.ok) throw new ShopifyError(`Shopify answered with error ${r.status}.`);
    const j: any = await r.json();
    if (j.errors?.some((e: any) => e.extensions?.code === 'THROTTLED') && attempt < 5) { await sleep(2000 * (attempt + 1)); continue; }
    if (j.errors?.length) throw new ShopifyError(`Shopify: ${j.errors.map((e: any) => e.message).join('; ').slice(0, 400)}`);
    return j.data as T;
  }
}

let shopCache: { at: number; name: string } | null = null;
export async function shopifyStatus() {
  const base = { configured: shopifyConfigured(), domain: config.shopify.domain || null, profilesAt: loadProfiles()?.generatedAt ?? null, shop: null as string | null, error: null as string | null };
  if (!base.configured) return base;
  try {
    if (!shopCache || Date.now() - shopCache.at > 60_000) shopCache = { at: Date.now(), name: (await gql<{ shop: { name: string } }>('{ shop { name } }')).shop.name };
    return { ...base, shop: shopCache.name };
  } catch (e) { return { ...base, error: (e as Error).message }; }
}

/** What was read from the store, for the Publish to Shopify page. */
export function profilesSummary(): ShopifyProfilesSummary | null {
  const p = loadProfiles();
  if (!p) return null;
  return {
    generatedAt: p.generatedAt, store: { name: p.store.name, domain: p.store.domain, currency: p.store.currency, productCount: p.store.productCount }, channels: p.publications.map(c => c.name),
    families: Object.entries(p.families).map(([key, f]) => ({
      key, label: f.label, basedOn: f.basedOn, productType: f.productType, template: f.templateSuffix, optionName: f.optionName, sizes: f.sizes, price: f.price, compareAt: f.compareAt,
      morePrintsPrice: f.morePrintsPrice, skuPrefix: f.skuPrefix, inventoryPolicy: f.inventoryPolicy, taxable: f.taxable, tags: f.tags,
      styles: Object.entries(p.styles).filter(([, k]) => k === key).map(([s]) => s),
    })),
  };
}

// ---------- copy that matches the store's own descriptions ----------
export const COPY: Record<string, { bullets: string[]; care: string; fabric: string }> = {
  // Hippies Town's own spec lines (bhippie.com product pages, 2026-10)
  crewneck: { bullets: ['Unisex', 'Oversize Fit with loose shoulders', 'Double-needle stitch', '100% Cotton', 'DTF print'], care: 'Wash inside out in cold water and hang dry to keep the print sharp.', fabric: '100% cotton' },
  'oversized-hoodie': { bullets: ['Unisex', 'Oversize Fit with loose shoulders', 'Double-needle stitch', '100% Premium Cotton', 'DTF print'], care: 'Wash inside out in cold water and hang dry to keep the print sharp.', fabric: '100% premium cotton' },
  'washed-hoodie': { bullets: ['Unisex', 'Oversize Fit with loose shoulders', 'Acid washed finish, every piece a little different', 'Double-needle stitch', '100% Premium Cotton', 'DTF print'], care: 'Wash inside out in cold water and hang dry. The wash softens with every wear.', fabric: 'acid-washed premium cotton' },
  'long-sleeve': { bullets: ['Unisex', 'Oversize Fit with loose shoulders', 'Acid washed finish', 'Double-needle stitching', '100% Cotton', 'DTF print'], care: 'Wash inside out in cold water and hang dry.', fabric: 'acid-washed cotton' },
  'washed-tee': { bullets: ['Unisex', 'Oversize Fit with Loose Shoulders', 'Washed finish', '100% Cotton', 'Double-needle stitching', 'DTF print'], care: 'Wash inside out in cold water and hang dry.', fabric: 'washed 100% cotton' },
  tshirt: { bullets: ['Unisex', 'Oversize Fit with Loose Shoulders', '100% Cotton, 1% Lycra Elasticity', 'Double-needle stitching', 'DTF print'], care: 'Wash inside out in cold water and hang dry.', fabric: '100% cotton with 1% lycra' },
};
const VENDOR = 'Hippies Town';
const WHO = "For anyone who likes their clothes loose, comfy and a little loud. Wear it on chill days, layer it, or gift it to the friend who gets the vibe.";
const SHIPPING = 'Made and printed in Egypt. Delivery across Egypt. Buy 2 Get 10% Off Everything.';
const POLICY = '<a href="/policies/refund-policy">Exchange and return policy</a>';
const PLACEMENT_ORDER = ['front', 'back', 'sleeve'];
const list = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] ?? '');
const ALT: Record<string, string> = {
  'Studio · front on model': 'Front Print Model Shot', 'Studio · back on model': 'Back Print Model Shot', 'Flat lay': 'Flat Lay', 'Ghost mannequin': 'Ghost Mannequin',
  'Print close-up': 'Print Close-Up', 'Lifestyle · front': 'Lifestyle Model Shot', 'Lifestyle · back': 'Lifestyle Back Shot', 'Lifestyle · candid walk': 'Candid Lifestyle Shot',
  'Mockup · front': 'Front Print', 'Mockup · back': 'Back Print',
};

function sizeLine(sizes: string[]) {
  const kg = sizes.flatMap(s => [...s.matchAll(/(\d+)-(\d+)\s*KG/gi)].map(m => [Number(m[1]), Number(m[2])]));
  const name = (s: string) => s.split(' (')[0];
  return `Available ${name(sizes[0])} through ${name(sizes[sizes.length - 1])}${kg.length ? ` (${Math.min(...kg.map(k => k[0]))}–${Math.max(...kg.map(k => k[1]))}KG)` : ''}`;
}

/** The story's first paragraph is the intro, then "About the Design", then "Who It's For"; more paragraphs follow. HTML is used as written. */
function descriptionHtml(title: string, story: string, famKey: string, f: Family, areas: string[], tags: string[]) {
  if (/<(p|div|h\d|ul)\b/i.test(story)) return story;
  const copy = COPY[famKey] ?? COPY.tshirt;
  const [intro, about, who, ...more] = story.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const bullets = [...copy.bullets, sizeLine(f.sizes)]; // no "Prints on …" line: the photos show where the print sits (owner, 2026-10-11)
  const word = f.titleSuffix || 'Product';
  return [ // Hippies Town's page shape: a short line, then "<Garment> Description" spec bullets
    '<div class="product-description">',
    `<p>${esc(intro ?? `${title}, printed on ${copy.fabric}.`)}</p>`,
    ...(about ? [`<p>${esc(about)}</p>`] : []),
    ...(who ? [`<p>${esc(who)}</p>`] : []),
    ...more.map(p => `<p>${esc(p)}</p>`),
    `<p><strong>${esc(word)} Description</strong></p>`, `<ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`,
    '<h3>Care</h3>', `<p>${esc(copy.care)}</p>`,
    `<p>${esc(SHIPPING)} ${POLICY}</p>`, `<p>${closingLinks(famKey, tags)}</p>`,
    '</div>',
  ].join('\n');
}

function derivedSeo(title: string, story: string, famKey: string) {
  const fabric = (COPY[famKey] ?? COPY.tshirt).fabric;
  const lead = story.split(/\n{2,}/)[0]?.split(/(?<=[.!?])\s/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const tail = `${title} on ${fabric}. Unisex oversize fit with loose shoulders. Made in Egypt.`;
  // the first sentence of the story when it fits, otherwise the plain line; never cut mid-sentence
  const description = [lead && !/<\w/.test(lead) ? `${lead} ${tail}` : '', tail, `${title}: ${fabric}. Oversized unisex fit. Made in Egypt.`].find(d => d && d.length <= 160) ?? tail.slice(0, 160);
  const suffix = ' | Hippies Town Egypt';
  return { title: title.length + suffix.length <= 70 ? title + suffix : title.slice(0, 70), description };
}

/** The search listing: what the owner (or Codex) wrote for it, otherwise one derived from the story. */
function seoFor(title: string, story: string, famKey: string, row: Row) {
  const own = { title: String(row.seo_title ?? '').trim(), description: String(row.seo_description ?? '').trim() };
  const fallback = derivedSeo(title, story, famKey);
  return { title: own.title || fallback.title, description: own.description || fallback.description };
}

// ---------- the plan: everything we would send, built without touching Shopify ----------
function context(listingId: string) {
  const row = get('SELECT * FROM listings WHERE id = ?', listingId);
  if (!row) throw new ShopifyError('Product not found.');
  const mockups = rows('SELECT * FROM mockups WHERE listing_id = ? ORDER BY created_at', listingId);
  const style = getProduct(String(mockups[0]?.product_id ?? ''))?.style ?? '';
  const designIds = listingDesignIds(row, mockups);
  const placed = designIds.length ? rows(`SELECT DISTINCT placement FROM designs WHERE id IN (${designIds.map(() => '?').join(',')})`, ...designIds).map(d => String(d.placement)) : [];
  return { row: row as Row, mockups, style, prof: profileForStyle(style), areas: PLACEMENT_ORDER.filter(p => placed.includes(p)) };
}

function pricing(f: Family, areas: string[], row: Row) {
  const more = areas.length > 1 && !!f.morePrintsPrice;
  if (Number(row.price) > 0) { const price = Number(row.price); return { price, compareAt: Number(row.compare_at) > price ? Number(row.compare_at) : null }; }
  return { price: more ? f.morePrintsPrice! : f.price, compareAt: more ? f.morePrintsCompareAt : f.compareAt };
}

const LEGACY_SIZES = ['S', 'M', 'L', 'XL', '2XL'];
function sizesFor(row: Row, f: Family) {
  const chosen = json<string[]>(row.sizes, []);
  const valid = f.sizes.filter(s => chosen.includes(s));
  return valid.length ? valid : f.sizes;
}

export interface ImagePlan { key: string; file: string; filename: string; alt: string }

export function buildPlan(listingId: string) {
  const { row, mockups, style, prof, areas } = context(listingId);
  if (!prof) throw new ShopifyError(`This garment style ("${style || 'unknown'}") has no store profile yet. Run: node scripts/shopify-profiles.mjs`);
  const { key: famKey, family: f } = prof;
  const detail = toListing(row, true) as ListingDetail;
  const title = String(row.title).trim();
  const story = String(row.description ?? '').trim();
  const warnings: string[] = [];

  // one variant per color name: when a color has several mockups, the newest one wins
  const byColor = new Map<string, Row>();
  for (const m of mockups) { const color = getProduct(String(m.product_id))?.color; if (color) byColor.set(color, m); }
  const colors = [...byColor.keys()];
  const multi = colors.length > 1;
  if (mockups.length > byColor.size) warnings.push('Some colors had more than one mockup; the newest flat mockup is used for each color.');
  const keep = new Set([...byColor.values()].map(m => String(m.id)));

  const media = detail.media.filter(m => !m.hidden && (m.kind !== 'mockup' || keep.has(m.key.split(':')[1])));
  if (!media.length) throw new ShopifyError('This product has no photos yet. Shoot some photos or add a mockup first.');
  const onStore = json<Record<string, any>>(row.shopify, {});
  // a product that is live (or archived) keeps its web address when you rename it; a draft has no visitors yet, so its address follows its title
  const handle = onStore.id && onStore.handle && onStore.status && onStore.status !== 'DRAFT' ? String(onStore.handle) : slug(title);
  const images: ImagePlan[] = media.map((m, i) => ({
    key: m.key, file: abs(m.url.split('?')[0].replace(/^\/files\//, '')), filename: `${handle}-${i + 1}.jpg`,
    alt: `${title} - ${ALT[m.label] ?? m.label}${m.kind === 'mockup' && multi && m.color ? ` ${m.color}` : ''} | Hippies Town`.slice(0, 500),
  }));
  const colorImage = new Map<string, number>(); // color -> its flat mockup render (shoot color labels can be wrong, mockups never are)
  if (multi) for (const [color, m] of byColor) { const i = media.findIndex(x => x.key === `mockup:${m.id}:front`); if (i >= 0) colorImage.set(color, i); }
  const hasModelPhotos = media.some(m => m.kind === 'shoot' && /on model|Lifestyle/.test(m.label));
  if (!hasModelPhotos) warnings.push('No model photos yet.');
  if (media.length < 3) warnings.push(`Only ${media.length} photo${media.length === 1 ? '' : 's'}: add more in Shopify or shoot more here.`);

  const sizes = sizesFor(row, f);
  const { price, compareAt } = pricing(f, areas, row);
  const saved = json<Record<string, any>>(row.shopify, {});
  const skus: Record<string, string> = { ...(saved.skus ?? {}) };
  let counter = Math.max(f.skuNext, Number(get('SELECT value FROM kv WHERE key = ?', `shopify.sku.${f.skuPrefix}`)?.value) || 0);
  const variants: Row[] = [];
  for (const size of sizes) for (const color of multi ? colors : [null]) {
    const vkey = `${size}|${color ?? ''}`;
    skus[vkey] ??= `${f.skuPrefix}${counter++}${code(size.split(' (')[0])}${color ? code(color) : ''}`;
    variants.push({
      optionValues: [{ optionName: f.optionName, name: size }, ...(color ? [{ optionName: 'Color', name: color }] : [])],
      price: price.toFixed(2), ...(compareAt ? { compareAtPrice: compareAt.toFixed(2) } : {}), sku: skus[vkey],
      taxable: f.taxable, inventoryPolicy: 'CONTINUE', inventoryItem: { tracked: f.tracked, requiresShipping: f.requiresShipping },
    });
  }
  const seen = new Set<string>();
  // every product from the Studio keeps selling when out of stock (printed on demand); tags are the product's own plus the family's
  const tags = [...json<string[]>(row.tags, []), ...f.tags].filter(t => { const k = t.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });

  const input: Row = {
    title, handle, vendor: VENDOR, productType: f.productType, tags, descriptionHtml: descriptionHtml(title, story, famKey, f, areas, tags), seo: seoFor(title, story, famKey, row),
    ...(f.templateSuffix ? { templateSuffix: f.templateSuffix } : {}), ...(f.category ? { category: f.category } : {}),
    productOptions: [{ name: f.optionName, position: 1, values: sizes.map(name => ({ name })) }, ...(multi ? [{ name: 'Color', position: 2, values: colors.map(name => ({ name })) }] : [])],
    variants, metafields: f.metafields,
  };
  return { row, detail, famKey, family: f, input, images, colorImage, colors, sizes, price, compareAt, tags, warnings, skus, nextCounter: counter, areas, handle };
}

/** What a push would create, for the product page (nothing is sent to Shopify). */
export function previewListing(listingId: string) {
  const p = buildPlan(listingId);
  return {
    family: p.family.label, productType: p.family.productType, template: p.family.templateSuffix, vendor: p.family.vendor, handle: p.handle,
    options: p.input.productOptions.map((o: Row) => `${o.name}: ${o.values.map((v: Row) => v.name).join(', ')}`),
    variantCount: p.input.variants.length, price: p.price, compareAt: p.compareAt, sampleSkus: p.input.variants.slice(0, 3).map((v: Row) => v.sku),
    imageCount: p.images.length, tags: p.tags, seo: p.input.seo, descriptionHtml: p.input.descriptionHtml, warnings: p.warnings, status: 'DRAFT',
  };
}

/** Fill what's missing from the store's conventions: sizes, price, compare-at and a starter description. Never overwrites what you set. */
export function autofillListing(listingId: string) {
  const { row, prof, areas } = context(listingId);
  if (!prof) throw new ShopifyError('This garment style has no store profile yet. Run: node scripts/shopify-profiles.mjs');
  const f = prof.family, fields: Row = {};
  const sizes = json<string[]>(row.sizes, []);
  if (!sizes.length || sizes.join() === LEGACY_SIZES.join() || !sizes.some(s => f.sizes.includes(s))) fields.sizes = JSON.stringify(f.sizes);
  if (!(Number(row.price) > 0)) { const p = pricing(f, areas, { ...row, price: null }); fields.price = p.price; fields.compare_at = p.compareAt; }
  if (!String(row.description ?? '').trim()) fields.description = `${row.title}, printed on ${(COPY[prof.key] ?? COPY.tshirt).fabric}.`;
  if (Object.keys(fields).length) update('listings', listingId, { ...fields, updated_at: now() });
  return Object.keys(fields);
}

// ---------- pushing ----------
const Q_STAGED = `mutation StagedUploads($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`;
const M_SET = `mutation ProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) { productSet(input: $input, identifier: $identifier, synchronous: true) { product { id handle status } userErrors { field message code } } }`;
const M_VARIANT_MEDIA = `mutation VariantMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) { productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) { userErrors { field message } } }`;
const M_PUBLISH = `mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`;
const Q_BY_HANDLE = `query ByHandle($handle: String!) { productByIdentifier(identifier: { handle: $handle }) { id title status } }`;
const Q_NODES = `query Nodes($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id status handle } } }`;
const Q_EXISTS = `query Exists($id: ID!) { node(id: $id) { id } }`;
const Q_PRODUCT = `query Product($id: ID!) { product(id: $id) { id handle status title productType vendor templateSuffix tags category { id } options { name values } seo { title description } resourcePublicationsCount { count }
  variants(first: 100) { nodes { id sku price compareAtPrice selectedOptions { name value } media(first: 1) { nodes { id } } } }
  media(first: 100) { nodes { id status alt ... on MediaImage { image { url } } } } } }`;

const userErrors = (errs: Row[] | undefined) => (errs ?? []).map(e => `${(e.field ?? []).join('.')}: ${e.message}`.replace(/^: /, '')).join('; ');

async function prepare(file: string) {
  return sharp(file).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

async function uploadImages(images: ImagePlan[]) {
  const buffers = await Promise.all(images.map(im => prepare(im.file)));
  const d = await gql<any>(Q_STAGED, { input: images.map(im => ({ resource: 'IMAGE', filename: im.filename, mimeType: 'image/jpeg', httpMethod: 'POST' })) });
  if (d.stagedUploadsCreate.userErrors?.length) throw new ShopifyError(`Shopify would not accept the photos: ${userErrors(d.stagedUploadsCreate.userErrors)}`);
  const targets: Row[] = d.stagedUploadsCreate.stagedTargets;
  const urls: string[] = [];
  for (let i = 0; i < images.length; i += 4) {
    await Promise.all(images.slice(i, i + 4).map(async (im, j) => {
      const t = targets[i + j], form = new FormData();
      for (const p of t.parameters) form.append(p.name, p.value);
      form.append('file', new Blob([new Uint8Array(buffers[i + j])], { type: 'image/jpeg' }), im.filename);
      const r = await fetch(t.url, { method: 'POST', body: form });
      if (!r.ok) throw new ShopifyError(`Uploading ${im.filename} failed (${r.status}).`);
      urls[i + j] = t.resourceUrl;
    }));
  }
  return urls;
}

/**
 * Compare the linked products with what is really in Shopify. A product deleted there becomes "not on Shopify" here
 * (its SKUs are kept for next time), so it can be pushed again; a status change (draft -> active) is picked up too.
 * Nothing is cleared unless Shopify answers and says the product is gone.
 */
export async function syncWithShopify(): Promise<ShopifySyncResult> {
  const linked = shopifyConfigured() ? rows('SELECT id, title, shopify_id, shopify FROM listings WHERE shopify_id IS NOT NULL') : [];
  const out: ShopifySyncResult = { checked: linked.length, changed: [] };
  for (let i = 0; i < linked.length; i += 100) {
    const chunk = linked.slice(i, i + 100);
    const nodes: (Row | null)[] = (await gql<any>(Q_NODES, { ids: chunk.map(l => String(l.shopify_id)) })).nodes;
    chunk.forEach((l, j) => {
      const node = nodes[j], saved = json<Row>(l.shopify, {});
      if (!node?.id) {
        update('listings', String(l.id), { shopify_id: null, shopify: JSON.stringify({ skus: saved.skus ?? {}, removedAt: now() }), updated_at: now() });
        out.changed.push({ id: String(l.id), title: String(l.title), change: 'deleted' });
      } else if (saved.status !== node.status || saved.handle !== node.handle) {
        update('listings', String(l.id), { shopify: JSON.stringify({ ...saved, status: node.status, handle: node.handle }) });
        out.changed.push({ id: String(l.id), title: String(l.title), change: 'status', status: node.status });
      }
    });
  }
  return out;
}

const busy = new Set<string>();

export async function pushListing(listingId: string) {
  if (busy.has(listingId)) throw new ShopifyError('This product is already being pushed.');
  busy.add(listingId);
  try {
    const plan = buildPlan(listingId);
    const saved = json<Record<string, any>>(plan.row.shopify, {});
    let existingId: string | null = saved.id ?? plan.row.shopify_id ?? null;
    const warnings = [...plan.warnings];
    // it may have been deleted in Shopify since the last push: then a new draft is created instead of updating something that is gone
    if (existingId && !(await gql<any>(Q_EXISTS, { id: existingId })).node) { existingId = null; warnings.push('The earlier Shopify product had been deleted, so a new draft was created.'); }
    let input = plan.input;

    if (existingId) {
      // update text, options, variants and prices; photos stay as they are, and so does the status (you may have activated it)
      const { files: _f, handle: _h, ...rest } = input;
      input = rest;
    } else {
      const clash = (await gql<any>(Q_BY_HANDLE, { handle: plan.handle })).productByIdentifier;
      if (clash) throw new ShopifyError(`A product with the address "${plan.handle}" already exists in Shopify ("${clash.title}"). Rename this product and push again.`);
      const urls = await uploadImages(plan.images);
      input = { ...input, status: 'DRAFT', files: plan.images.map((im, i) => ({ originalSource: urls[i], alt: im.alt, contentType: 'IMAGE', filename: im.filename })) };
    }

    const set = (await gql<any>(M_SET, { input, ...(existingId ? { identifier: { id: existingId } } : {}) })).productSet;
    if (set.userErrors?.length) throw new ShopifyError(`Shopify rejected the product: ${userErrors(set.userErrors)}`);
    const id: string = set.product.id;
    update('listings', listingId, { shopify_id: id, updated_at: now() }); // remember it right away, so a later step failing never loses the link

    let product = (await gql<any>(Q_PRODUCT, { id })).product;
    if (!existingId) {
      // photos are processed in the background: wait for them, then give each color's variants its own photo
      for (let i = 0; i < 45 && product.media.nodes.some((n: Row) => n.status !== 'READY' && n.status !== 'FAILED'); i++) { await sleep(2000); product = (await gql<any>(Q_PRODUCT, { id })).product; }
      if (product.media.nodes.some((n: Row) => n.status === 'FAILED')) warnings.push('Shopify could not process one or more photos.');
      if (plan.colorImage.size) {
        const stem = (i: number) => plan.images[i].filename.replace(/\.jpg$/, '');
        const mediaFor = (i: number) => product.media.nodes.find((n: Row) => String(n.image?.url ?? '').includes(stem(i)))?.id ?? product.media.nodes[i]?.id;
        const variantMedia = product.variants.nodes.flatMap((v: Row) => {
          const color = v.selectedOptions.find((o: Row) => o.name === 'Color')?.value, idx = plan.colorImage.get(color);
          const mediaId = idx === undefined ? null : mediaFor(idx);
          return mediaId ? [{ variantId: v.id, mediaIds: [mediaId] }] : [];
        });
        if (variantMedia.length) {
          const r = (await gql<any>(M_VARIANT_MEDIA, { productId: id, variantMedia })).productVariantAppendMedia;
          if (r.userErrors?.length) warnings.push(`Color photos were not linked to variants: ${userErrors(r.userErrors)}`);
        }
      }
      // same sales channels as the store's active products (drafts stay hidden until you activate them)
      const channels = loadProfiles()?.publications ?? [];
      if (channels.length) {
        const r = (await gql<any>(M_PUBLISH, { id, input: channels.map(c => ({ publicationId: c.id })) })).publishablePublish;
        if (r.userErrors?.length) warnings.push(`Not published to the sales channels: ${userErrors(r.userErrors)}`);
      }
      product = (await gql<any>(Q_PRODUCT, { id })).product;
    }

    const storeHandle = config.shopify.domain.replace(/\.myshopify\.com$/, '');
    const info: ShopifyInfo = {
      id, handle: product.handle, adminUrl: `https://admin.shopify.com/store/${storeHandle}/products/${id.split('/').pop()}`, status: product.status,
      pushedAt: now(), variantCount: product.variants.nodes.length, imageCount: product.media.nodes.length, warnings,
    };
    update('listings', listingId, { shopify_id: id, shopify: JSON.stringify({ ...info, skus: plan.skus }), updated_at: now() });
    run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, `shopify.sku.${plan.family.skuPrefix}`, String(plan.nextCounter));
    return { ...info, created: !existingId };
  } finally {
    busy.delete(listingId);
  }
}
