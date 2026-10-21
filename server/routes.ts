import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  MODEL_VIEWS, PLACEMENT_DEFAULTS, PRINT_TOP, SHOOT_FRAMINGS, SHOOT_RATIOS, SHOT_TEMPLATES, isCloseUp, isSleeveLayer, layerSize, refitViews, shotsFor, sleeveSide,
  type GenerateDesignsRequest, type GenerateShootsRequest, type Layer, type Placement, type Product, type View,
} from '../shared/types.ts';
import { all, get, insert, newId, now, run, transaction, update } from './db.ts';
import { abs, removeFiles, storeImage } from './files.ts';
import { resized, widthOf } from './thumbs.ts';
import { getProduct, productAsset, products } from './catalog.ts';
import { renderView } from './render.ts';
import { fetchImageFromLink, linkErrorMessage } from './fetchImage.ts';
import { assignListing, pruneEmptyListing, styleOf, toListing } from './listings.ts';
import { ShopifyError, autofillListing, previewListing, profilesSummary, pushListing, shopifyStatus, syncWithShopify } from './shopify.ts';
import { cancelJob, enqueue, filesNeededByJobs, jobsUsing, queueCopy, queueStats, resumeQueue, retryAll, retryJob } from './queue.ts';
import { needsCopy } from './copy.ts';
import { dissolveLoneSets, linkDesigns, planMatch, unlinkDesigns } from './sets.ts';
import { deleteListings, deleteMockups, deleteShoots } from './cleanup.ts';
import { captionFor, checkPrint, describeModel, describeReference, improveText, printExpectation, rankModels, shotIdeas, type AssistField } from './assist.ts';
import { ClaudeError } from './claude.ts';
import { UpscaleError, upscalePrint } from './upscale.ts';
import { designRow, designRows, mockupRow, presetRow, presetViewRows, refRows, toDesign, toJob, toMockup, toPreset, toReference, toShoot } from './models.ts';

export const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30e6, files: 50 } });

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new HttpError(status, message); };
const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).then(out => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);

const PLACEMENTS: Placement[] = ['front', 'back', 'sleeve'];
const VIEWS: View[] = ['front', 'back'];
const asPlacement = (v: unknown): Placement => (PLACEMENTS.includes(v as Placement) ? (v as Placement) : 'front');
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const stripExt = (name: string) => path.parse(name).name.replace(/[_-]+/g, ' ').trim() || 'Untitled';

// ---------- health & stats ----------
api.get('/health', (_req, res) => { res.json({ ok: true }); });
api.get('/stats', wrap(() => ({
  queue: queueStats(),
  counts: {
    designs: Number(get(`SELECT COUNT(*) n FROM designs WHERE status != 'archived'`)!.n),
    mockups: Number(get('SELECT COUNT(*) n FROM mockups')!.n),
    shoots: Number(get('SELECT COUNT(*) n FROM shoots')!.n),
    listings: Number(get('SELECT COUNT(*) n FROM listings')!.n),
  },
})));

// ---------- products ----------
api.get('/products', (_req, res) => { res.json(products); });
api.get('/products/:id/:view/:kind', wrap(async (req, res) => {
  const view = req.params.view as View, kind = req.params.kind as 'image' | 'mask';
  if (!VIEWS.includes(view) || !['image', 'mask'].includes(kind) || !getProduct(String(req.params.id))) fail(404, 'Not found');
  const file = await productAsset(String(req.params.id), view, kind), w = kind === 'image' ? widthOf(req.query.w) : null; // ?w=480: a small webp for grids
  res.set('Cache-Control', 'public, max-age=86400').sendFile(w ? await resized(file, w).catch(() => file) : file);
}));

// ---------- designs ----------
api.get('/designs', wrap(req => {
  const where: string[] = [], params: unknown[] = [];
  const { status, placement, favorite, q, batch, set } = req.query as Record<string, string | undefined>;
  if (status && status !== 'all') { where.push('status = ?'); params.push(status); } else if (!status) where.push(`status != 'archived'`);
  if (placement && PLACEMENTS.includes(placement as Placement)) { where.push('placement = ?'); params.push(placement); }
  if (favorite === '1') where.push('favorite = 1');
  if (batch) { where.push('batch_id = ?'); params.push(batch); }
  if (set) { where.push('set_id = ?'); params.push(set); }
  if (q) { where.push('(title LIKE ? OR prompt LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  return all(`SELECT * FROM designs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`, ...params).map(toDesign);
}));

api.get('/designs/:id', wrap(req => { const r = designRow(String(req.params.id)); return r ? toDesign(r) : fail(404, 'Design not found'); }));

api.post('/designs/upload', upload.array('files'), wrap(async req => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) fail(400, 'No files received.');
  const placement = asPlacement(req.body.placement);
  const out = [];
  for (const f of files) {
    const id = newId('dsn');
    const img = await storeImage('designs', id, f.buffer, { trim: true }).catch(() => fail(400, `${f.originalname} is not a readable image.`));
    insert('designs', {
      id, title: stripExt(f.originalname), prompt: '', placement, status: 'draft', favorite: 0, source: 'uploaded', parent_id: null, batch_id: null,
      thread_id: null, file: img.file, thumb: img.thumb, width: img.width, height: img.height, transparent: img.transparent ? 1 : 0, created_at: now(),
    });
    out.push(toDesign(designRow(id)!));
  }
  return out;
}));

api.patch('/designs/:id', wrap(req => {
  const row = designRow(String(req.params.id)) ?? fail(404, 'Design not found');
  const b = req.body ?? {};
  // A linked set holds one print per placement, so a design cannot take one its set already uses.
  if (PLACEMENTS.includes(b.placement) && b.placement !== row.placement && row.set_id && get('SELECT 1 x FROM designs WHERE set_id = ? AND placement = ? AND id != ?', row.set_id, b.placement, row.id)) fail(409, `Its linked set already has a ${b.placement} print. Unlink one of them first.`);
  update('designs', String(row.id), {
    ...(typeof b.title === 'string' && b.title.trim() ? { title: b.title.trim().slice(0, 120) } : {}),
    ...(['draft', 'approved', 'archived'].includes(b.status) ? { status: b.status } : {}),
    ...(typeof b.favorite === 'boolean' ? { favorite: b.favorite ? 1 : 0 } : {}),
    ...(PLACEMENTS.includes(b.placement) ? { placement: b.placement } : {}),
  });
  return toDesign(designRow(String(row.id))!);
}));

async function deleteDesigns(ids: string[]) {
  const used = all(`SELECT views FROM mockups`).some(m => ids.some(id => String(m.views).includes(`"${id}"`)));
  if (used) fail(409, 'Some of these designs are used in mockups. Remove them from the mockups (or archive the designs) first.');
  const rows = designRows(ids);
  if (jobsUsing(rows.map(r => String(r.file)), ids)) fail(409, `Designs waiting in the queue are based on ${ids.length === 1 ? 'this design' : 'one of these designs'}. Cancel them in the Queue, or wait until they are made.`);
  for (const r of rows) { run('DELETE FROM designs WHERE id = ?', r.id); await removeFiles(String(r.file), String(r.thumb)); }
  dissolveLoneSets(rows.map(r => r.set_id)); // a set left with one print is no longer a set
}

api.delete('/designs/:id', wrap(async req => { await deleteDesigns([String(req.params.id)]); return { ok: true }; }));

api.post('/designs/bulk', wrap(async req => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const action = String(req.body?.action);
  if (!ids.length) fail(400, 'Select at least one design.');
  const marks = ids.map(() => '?').join(',');
  const set = (sql: string) => run(`UPDATE designs SET ${sql} WHERE id IN (${marks})`, ...ids);
  if (action === 'approve') set(`status = 'approved'`);
  else if (action === 'draft') set(`status = 'draft'`);
  else if (action === 'archive') set(`status = 'archived'`);
  else if (action === 'favorite') set('favorite = 1');
  else if (action === 'unfavorite') set('favorite = 0');
  else if (action === 'delete') await deleteDesigns(ids);
  else if (action === 'unlink') unlinkDesigns(ids);
  else fail(400, 'Unknown action.');
  return { ok: true };
}));

/** Queue design jobs: every idea × every reference (or all references together) × count. */
api.post('/designs/generate', wrap(req => {
  const b = req.body as GenerateDesignsRequest;
  const ideas = (Array.isArray(b.ideas) ? b.ideas : []).map(s => String(s).trim()).filter(Boolean).slice(0, 50);
  const refs = refRows((b.referenceIds ?? []).map(String)).map(r => ({ file: String(r.file), name: String(r.name) }));
  const fromDesigns = designRows((b.designIds ?? []).map(String)).map(r => ({ file: String(r.file), name: String(r.title), id: String(r.id) }));
  const allRefs = [...refs, ...fromDesigns];
  const exact = !!b.exact; // recreate the reference's artwork exactly instead of making something new from it
  if (exact && !allRefs.length) fail(400, 'Add the reference image to extract the design from.');
  if (!ideas.length && !allRefs.length) fail(400, 'Write at least one idea or add a reference.');
  const wanted = (Array.isArray(b.placements) && b.placements.length ? b.placements : [b.placement]).map(asPlacement);
  const placements = PLACEMENTS.filter(p => wanted.includes(p)); // front, back, sleeve order: the first one is made first
  const count = clamp(b.count, 1, 8, 1);
  const refGroups = allRefs.length ? (b.separateReferences || exact ? allRefs.map(r => [r]) : [allRefs]) : [[]];
  const ideaList = ideas.length ? ideas : [''];
  const total = ideaList.length * refGroups.length * count * placements.length;
  if (total > 100) fail(400, `That is ${total} designs. Keep one batch to 100 or fewer.`);

  const batchId = newId('bat');
  const egyptian = !!b.egyptian && !exact;
  const jobIds = transaction(() => ideaList.flatMap(idea => refGroups.flatMap(group => Array.from({ length: count }, (_, variant) => variant).flatMap(variant => {
    const base = exact ? `Extract from ${short(group.map(g => g.name).join(' + '), 40)}` : idea ? short(idea) : `Inspired by ${short(group.map(g => g.name).join(' + '), 40)}`;
    const title = count > 1 ? `${base} · v${variant + 1}` : base;
    const parentId = group.length === 1 && 'id' in group[0] ? (group[0] as { id: string }).id : null;
    // Several placements make a linked set: each print waits for the one before it and is made from it, so they read as one collection.
    // (An exact extraction does not wait: every print is taken from the reference itself.)
    const setId = placements.length > 1 ? newId('set') : null;
    const ids: string[] = [];
    for (const placement of placements) {
      const label = placements.length > 1 ? `${title} · ${placement}` : title;
      ids.push(enqueue('design', `Design · ${label}`, { idea, placement, count, variant, title, parentId, egyptian, exact, refFiles: group.map(g => g.file), setId, after: exact ? null : ids[ids.length - 1] ?? null }, batchId));
    }
    return ids;
  }))));
  return { batchId, jobIds };
}));

api.post('/designs/:id/refine', wrap(req => {
  const row = designRow(String(req.params.id)) ?? fail(404, 'Design not found');
  const feedback = String(req.body?.feedback ?? '').trim().slice(0, 1500);
  if (!feedback) fail(400, 'Write what to change.');
  const batchId = newId('bat');
  const jobId = enqueue('refine', `Refine · ${short(String(row.title))}`, { designId: row.id, feedback }, batchId);
  return { batchId, jobIds: [jobId] };
}));

/** Link designs as one set (a front, a back and a sleeve print that go on a garment together). `into` changes an existing set's members. */
api.post('/designs/link', wrap(req => {
  const members = (Array.isArray(req.body?.members) ? req.body.members : []).map((m: Record<string, unknown>) => ({ id: String(m?.id), placement: m?.placement as Placement }));
  return designRows(linkDesigns(members, req.body?.into ? String(req.body.into) : null)).map(toDesign);
}));

/** Have Codex make the missing prints of a design's set (its back, its sleeve), designed to match it. The design joins the set when the first one is saved. */
api.post('/designs/:id/match', wrap(req => {
  const { row, setId, placements } = planMatch(String(req.params.id), req.body?.placements);
  const batchId = newId('bat'), base = String(row.title).replace(/ · (Front|Back|Sleeve)$/, '');
  const jobIds: string[] = [];
  for (const placement of placements) {
    jobIds.push(enqueue('design', `Design · ${short(base)} · ${placement}`, {
      idea: String(row.prompt ?? '').slice(0, 600), placement, count: 1, variant: 0, title: `${base} · ${placement[0].toUpperCase()}${placement.slice(1)}`, parentId: row.id,
      egyptian: false, refFiles: [row.file], setId, joinId: row.id, after: jobIds[jobIds.length - 1] ?? null,
    }, batchId));
  }
  return { batchId, jobIds };
}));

api.get('/designs/:id/download', wrap(async (req, res) => {
  const row = designRow(String(req.params.id)) ?? fail(404, 'Design not found');
  const name = String(row.title).replace(/[^\w\- ]+/g, '').trim() || String(row.id);
  if (!req.query.max) return res.download(abs(String(row.file)), `${name}.png`);
  // ?max=20: a PNG under 20 MB with the same pixel size and transparency: 256 colours with dithering (~3 s for 4K; lossless squeezing barely helps and took minutes), smaller only if still too big.
  const limit = Number(req.query.max) * 1_000_000;
  const src = abs(String(row.file));
  const small = { palette: true, colours: 256, dither: 1, effort: 1, compressionLevel: 6 } as const;
  let out = await fs.readFile(src);
  if (out.length > limit) out = await sharp(src).png(small).toBuffer();
  for (let scale = 0.85; out.length > limit && scale > 0.3; scale -= 0.15) out = await sharp(src).resize(Math.round(Number(row.width) * scale)).png(small).toBuffer();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="${name} (under ${req.query.max} MB).png"`);
  res.end(out);
}));

/** Upscale a print to 4096 px on its long side with fal.ai. The 4K file becomes the design's print file (a new name, so no stale cache); the original stays on disk beside it. */
api.post('/designs/:id/upscale', wrap(async req => {
  const row = designRow(String(req.params.id)) ?? fail(404, 'Design not found');
  const out = await upscalePrint(await fs.readFile(abs(String(row.file)))).catch(e => fail(e instanceof UpscaleError ? 400 : 502, (e as Error).message));
  const file = `designs/${row.id}-4k.png`;
  await fs.writeFile(abs(file), out);
  const meta = await sharp(out).metadata();
  update('designs', String(row.id), { file, width: meta.width!, height: meta.height! });
  return toDesign(designRow(String(row.id))!);
}));

// ---------- references ----------
api.get('/references', wrap(() => all('SELECT * FROM refs ORDER BY created_at DESC').map(toReference)));
api.post('/references', upload.array('files'), wrap(async req => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) fail(400, 'No files received.');
  const out = [];
  for (const f of files) {
    const id = newId('ref');
    const img = await storeImage('references', id, f.buffer).catch(() => fail(400, `${f.originalname} is not a readable image.`));
    insert('refs', { id, name: stripExt(f.originalname), file: img.file, thumb: img.thumb, created_at: now() });
    out.push(toReference(get('SELECT * FROM refs WHERE id = ?', id)!));
  }
  return out;
}));
/** Add references from image links (or pages that have a picture) instead of files. Bad links are reported, good ones still land. */
api.post('/references/from-url', wrap(async req => {
  const raw: unknown[] = Array.isArray(req.body?.urls) ? req.body.urls : [req.body?.url];
  const links = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))].slice(0, 12);
  if (!links.length) fail(400, 'Paste an image link.');
  const references = [], errors: string[] = [];
  for (const link of links) {
    try {
      const { buffer, name } = await fetchImageFromLink(link);
      const id = newId('ref');
      const img = await storeImage('references', id, buffer).catch(() => fail(400, 'That image could not be read.'));
      insert('refs', { id, name, file: img.file, thumb: img.thumb, created_at: now() });
      references.push(toReference(get('SELECT * FROM refs WHERE id = ?', id)!));
    } catch (e) {
      errors.push(`${link.length > 50 ? `${link.slice(0, 47)}…` : link} — ${e instanceof HttpError ? e.message : linkErrorMessage(e)}`);
    }
  }
  if (!references.length) fail(400, errors[0]);
  return { references, errors };
}));
api.delete('/references/:id', wrap(async req => {
  const r = get('SELECT * FROM refs WHERE id = ?', String(req.params.id)) ?? fail(404, 'Reference not found');
  run('DELETE FROM refs WHERE id = ?', r.id);
  // Designs waiting in the queue (and failed ones you may retry) need this image: it leaves the library now, the file goes once nothing needs it.
  await removeFiles(...(filesNeededByJobs().has(String(r.file)) ? [String(r.thumb)] : [String(r.file), String(r.thumb)]));
  return { ok: true };
}));

// ---------- mockups ----------
function cleanLayers(raw: unknown): Record<View, Layer[]> {
  const views = (raw ?? {}) as Record<string, unknown>;
  return Object.fromEntries(VIEWS.map(v => [v, (Array.isArray(views[v]) ? views[v] as Record<string, unknown>[] : []).slice(0, 20).map(l => {
    if (!designRow(String(l.designId))) fail(400, 'A layer references a design that no longer exists.');
    return {
      id: String(l.id || newId('lyr')), designId: String(l.designId),
      x: clamp(l.x, -512, 1536, 512), y: clamp(l.y, -512, 1536, 400), widthCm: clamp(l.widthCm, 1, 60, 25),
      rotation: clamp(l.rotation, -180, 180, 0), flip: !!l.flip, opacity: clamp(l.opacity, 5, 100, 100),
    };
  })])) as Record<View, Layer[]>;
}

// Renders are serialized per mockup id, written to temp files and renamed into place, and the DB row is only
// written after every render succeeded, so a mockup's saved views and its render files never diverge.
const renderChains = new Map<string, Promise<unknown>>();
function serialized<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (renderChains.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
  renderChains.set(id, next);
  const clear = () => { if (renderChains.get(id) === next) renderChains.delete(id); };
  next.then(clear, clear);
  return next;
}

type MockupSpec = { name: string; productId: string; bodyWidth: number; views: Record<View, Layer[]> };
async function renderAndStore(id: string, spec: MockupSpec, create: boolean) {
  await serialized(id, async () => {
    const renders: Partial<Record<View, string>> = {};
    const tmps: Partial<Record<View, string>> = {};
    try {
      for (const v of VIEWS) {
        if (!spec.views[v].length) continue;
        const rel = `mockups/${id}__${v}.png`, tmp = `mockups/${id}__${v}.tmp-${Date.now()}.png`;
        await renderView(spec.productId, v, spec.views[v], spec.bodyWidth, abs(tmp));
        tmps[v] = tmp; renders[v] = rel;
      }
    } catch (e) { await removeFiles(...Object.values(tmps)); throw e; }
    // All renders succeeded: swap files into place, then write the DB row.
    for (const v of VIEWS) {
      if (tmps[v]) await fs.rename(abs(tmps[v]!), abs(renders[v]!));
      else await removeFiles(`mockups/${id}__${v}.png`);
    }
    const fields = { name: spec.name, product_id: spec.productId, body_width: spec.bodyWidth, views: JSON.stringify(spec.views), renders: JSON.stringify(renders), updated_at: now() };
    if (create) insert('mockups', { id, ...fields, created_at: now() });
    else update('mockups', id, fields);
  });
}

async function createMockup(o: MockupSpec) {
  const id = newId('mck');
  await renderAndStore(id, o, true);
  assignListing(id);
  return toMockup(mockupRow(id)!);
}

const productLabel = (id: string) => { const p = getProduct(id); return p ? `${p.color} ${p.style}` : id; };

api.get('/mockups', wrap(req => {
  const design = req.query.design ? String(req.query.design) : null;
  return all('SELECT * FROM mockups ORDER BY updated_at DESC').filter(m => !design || String(m.views).includes(`"${design}"`)).map(toMockup);
}));
api.get('/mockups/:id', wrap(req => { const r = mockupRow(String(req.params.id)); return r ? toMockup(r) : fail(404, 'Mockup not found'); }));

api.post('/mockups', wrap(async req => {
  const b = req.body ?? {};
  const product = getProduct(String(b.productId)) ?? fail(400, 'Unknown product.');
  return createMockup({
    name: String(b.name || productLabel(product.id)).slice(0, 120), productId: product.id,
    bodyWidth: clamp(b.bodyWidth, 30, 100, product.defaultBodyWidth), views: cleanLayers(b.views),
  });
}));

api.put('/mockups/:id', wrap(async req => {
  const row = mockupRow(String(req.params.id)) ?? fail(404, 'Mockup not found');
  const b = req.body ?? {};
  const product = getProduct(String(b.productId ?? row.product_id)) ?? fail(400, 'Unknown product.');
  await renderAndStore(String(row.id), {
    name: String(b.name || row.name).slice(0, 120), productId: product.id,
    bodyWidth: clamp(b.bodyWidth, 30, 100, Number(row.body_width)), views: cleanLayers(b.views),
  }, false);
  // Another garment style is another product: the mockup leaves its product and joins the one for these designs on the new style.
  const was = row.listing_id ? String(row.listing_id) : null, moved = styleOf(String(row.product_id)) !== styleOf(product.id);
  if (was && moved) update('mockups', String(row.id), { listing_id: null });
  assignListing(String(row.id));
  if (was && moved) pruneEmptyListing(was);
  return toMockup(mockupRow(String(row.id))!);
}));

/** Deletes the mockup, its renders and the photos made from it (?keepPhotos=1 keeps the photos). */
api.delete('/mockups/:id', wrap(async req => {
  const row = mockupRow(String(req.params.id)) ?? fail(404, 'Mockup not found');
  return { ok: true, ...(await deleteMockups([String(row.id)], { keepPhotos: req.query.keepPhotos === '1' })) };
}));

/** Copy a mockup's placement onto other products/colors (same cm sizes and positions). */
api.post('/mockups/:id/clone', wrap(async req => {
  const row = mockupRow(String(req.params.id)) ?? fail(404, 'Mockup not found');
  const ids: string[] = (Array.isArray(req.body?.productIds) ? req.body.productIds : []).map(String).filter((id: string) => id !== row.product_id && getProduct(id));
  if (!ids.length) fail(400, 'Choose at least one other product or color.');
  const views = JSON.parse(String(row.views)) as Record<View, Layer[]>;
  const from = getProduct(String(row.product_id))?.type;
  const baseName = String(row.name).split(' — ')[0];
  const out = [];
  for (const pid of ids) {
    const to = getProduct(pid)!;
    out.push(await createMockup({ name: `${baseName} — ${productLabel(pid)}`, productId: pid, bodyWidth: to.defaultBodyWidth, views: from ? refitViews(views, from, to.type, d => designRow(d)?.placement as Placement | undefined) : views }));
  }
  return out;
}));

/** Auto-place designs on products at their placement's default spot. One mockup per design × product, or all designs combined per product. */
api.post('/mockups/quick', wrap(async req => {
  const designs = designRows((req.body?.designIds ?? []).map(String));
  const productIds: string[] = (req.body?.productIds ?? []).map(String).filter((id: string) => getProduct(id));
  if (!designs.length || !productIds.length) fail(400, 'Choose designs and at least one product.');
  if (designs.length * productIds.length > 200) fail(400, 'That is more than 200 mockups at once. Narrow it down.');
  const combine = !!req.body?.combine;
  const place = (d: Record<string, any>, product: Product): [View, Layer] => {
    const placement = (PLACEMENTS.includes(d.placement) ? d.placement : 'front') as Placement;
    const def = PLACEMENT_DEFAULTS[placement];
    const { h } = layerSize(def.widthCm, product.defaultBodyWidth, Number(d.height) / Number(d.width));
    const top = PRINT_TOP[product.type][placement];
    return [def.view, { id: newId('lyr'), designId: String(d.id), x: def.x, y: top + h / 2, widthCm: def.widthCm, rotation: 0, flip: false, opacity: 100 }];
  };
  const groups = combine ? [designs] : designs.map(d => [d]);
  const out = [];
  for (const group of groups) for (const pid of productIds) {
    const product = getProduct(pid)!;
    const views: Record<View, Layer[]> = { front: [], back: [] };
    for (const d of group) { const [v, l] = place(d, product); views[v].push(l); }
    const name = `${group.map(d => short(String(d.title), 32)).join(' + ')} — ${productLabel(pid)}`;
    out.push(await createMockup({ name, productId: pid, bodyWidth: product.defaultBodyWidth, views }));
  }
  return out;
}));

// ---------- presets (models, locations, styles) ----------
const viewFiles = (row: Record<string, unknown>) => Object.values(presetViewRows(row)).flatMap(v => (v ? [v.file, v.thumb] : []));
api.get('/presets', wrap(req => {
  const kind = req.query.kind ? String(req.query.kind) : null;
  return (kind ? all('SELECT * FROM presets WHERE kind = ? ORDER BY name', kind) : all('SELECT * FROM presets ORDER BY kind, name')).map(toPreset);
}));
api.post('/presets', upload.single('image'), wrap(async req => {
  const kind = String(req.body.kind);
  if (!['model', 'location', 'studio', 'style'].includes(kind)) fail(400, 'Unknown preset type.');
  const name = String(req.body.name ?? '').trim().slice(0, 80) || fail(400, 'Give it a name.');
  const description = String(req.body.description ?? '').trim().slice(0, 1500);
  const id = newId('pre');
  let img = null;
  if (req.file) img = await storeImage('presets', `${id}_${Date.now().toString(36)}`, req.file.buffer).catch(() => fail(400, 'That image could not be read.'));
  insert('presets', { id, kind, name, description, file: img?.file ?? null, thumb: img?.thumb ?? null, created_at: now() });
  let jobId = null;
  if (!img && req.body.generate === 'true') {
    if (!description) fail(400, 'Describe it so Codex can generate a reference photo.');
    jobId = enqueue('preset', `${kind[0].toUpperCase()}${kind.slice(1)} · ${name}`, { presetId: id, ...(kind === 'model' && req.body.sheet === 'true' ? { sheet: true } : {}) });
  } else if (img && kind === 'model' && req.body.sheet === 'true') jobId = enqueue('preset', `Model · ${name} · character sheet`, { presetId: id, view: 'sheet' }); // an uploaded photo goes straight to its character sheet
  return { preset: toPreset(presetRow(id)!), jobId };
}));
api.patch('/presets/:id', upload.single('image'), wrap(async req => {
  const row = presetRow(String(req.params.id)) ?? fail(404, 'Preset not found');
  const changes: Record<string, unknown> = {};
  if (typeof req.body.name === 'string' && req.body.name.trim()) changes.name = req.body.name.trim().slice(0, 80);
  if (typeof req.body.description === 'string') changes.description = req.body.description.trim().slice(0, 1500);
  if (req.file) {
    const img = await storeImage('presets', `${row.id}_${Date.now().toString(36)}`, req.file.buffer).catch(() => fail(400, 'That image could not be read.'));
    await removeFiles(row.file as string, row.thumb as string, ...viewFiles(row));
    Object.assign(changes, { file: img.file, thumb: img.thumb, views: '{}' }); // extra photos were made from the old main photo
  }
  update('presets', String(row.id), changes);
  return toPreset(presetRow(String(row.id))!);
}));
api.post('/presets/:id/generate', wrap(req => {
  const row = presetRow(String(req.params.id)) ?? fail(404, 'Preset not found');
  if (!String(row.description).trim()) fail(400, 'Add a description first.');
  return { jobId: enqueue('preset', `${String(row.kind)} · ${row.name}`, { presetId: row.id, ...(row.kind === 'model' && req.body?.sheet ? { sheet: true } : {}) }) };
}));
/** Make the face close-up, full-body and back photos of a model from its main photo (body: { views: [...] } limits which). */
api.post('/presets/:id/views', wrap(req => {
  const row = presetRow(String(req.params.id)) ?? fail(404, 'Preset not found');
  if (row.kind !== 'model') fail(400, 'Only models have extra photos.');
  if (!row.file) fail(400, 'Make the main photo first.');
  const only = Array.isArray(req.body?.views) ? req.body.views.map(String) : null;
  return { jobIds: MODEL_VIEWS.filter(v => !only || only.includes(v)).map(view => enqueue('preset', `Model · ${row.name} · ${view}`, { presetId: row.id, view })) };
}));
/** The course's "generate several, then pick": the same description made several times as separate models in one group; `keep` keeps one and removes the rest. */
api.post('/presets/options', wrap(req => {
  const b = req.body ?? {};
  const name = String(b.name ?? '').trim().slice(0, 80) || fail(400, 'Give it a name.');
  const description = String(b.description ?? '').trim().slice(0, 1500) || fail(400, 'Describe the person first, so Codex can make the photos.');
  const count = Math.round(clamp(b.count, 2, 6, 4)), groupId = newId('grp');
  const ids = transaction(() => Array.from({ length: count }, (_, i) => {
    const id = newId('pre');
    insert('presets', { id, kind: 'model', name: `${name} · option ${i + 1}`, description, file: null, thumb: null, group_id: groupId, created_at: now() });
    enqueue('preset', `Model · ${name} · option ${i + 1}`, { presetId: id });
    return id;
  }));
  return { groupId, ids };
}));
/** Keeps this option as the model (named without " · option N") and removes the other options of its group, with any photo still being made for them. */
api.post('/presets/:id/keep', wrap(async req => {
  const row = presetRow(String(req.params.id)) ?? fail(404, 'Model not found');
  const group = row.group_id ? String(row.group_id) : null;
  if (!group) return toPreset(row);
  if (!row.file) fail(400, 'Wait until this option has its photo, then keep it.');
  for (const s of all('SELECT * FROM presets WHERE group_id = ? AND id != ?', group, row.id)) {
    for (const j of all(`SELECT id FROM jobs WHERE type = 'preset' AND status IN ('queued','running') AND json_extract(input, '$.presetId') = ?`, s.id)) cancelJob(String(j.id));
    run('DELETE FROM presets WHERE id = ?', s.id);
    await removeFiles(s.file as string, s.thumb as string, ...viewFiles(s));
  }
  const kept = String(row.name).replace(/ · option \d+$/, '');
  update('presets', String(row.id), { group_id: null, name: kept });
  if (req.body?.sheet !== false && !presetViewRows(row).sheet) enqueue('preset', `Model · ${kept} · character sheet`, { presetId: row.id, view: 'sheet' }); // keeping one leads straight to its character sheet
  return toPreset(presetRow(String(row.id))!);
}));
/** Make the character sheet of a model from its main photo. */
api.post('/presets/:id/sheet', wrap(req => {
  const row = presetRow(String(req.params.id)) ?? fail(404, 'Preset not found');
  if (row.kind !== 'model') fail(400, 'Only models have a character sheet.');
  if (!row.file) fail(400, 'Make the main photo first.');
  return { jobId: enqueue('preset', `Model · ${row.name} · character sheet`, { presetId: row.id, view: 'sheet' }) };
}));
api.delete('/presets/:id', wrap(async req => {
  const row = presetRow(String(req.params.id)) ?? fail(404, 'Preset not found');
  run('DELETE FROM presets WHERE id = ?', row.id);
  await removeFiles(row.file as string, row.thumb as string, ...viewFiles(row));
  return { ok: true };
}));

// ---------- products (Shopify-ready listings) ----------
const listingRow = (id: string) => get('SELECT * FROM listings WHERE id = ?', id) ?? fail(404, 'Product not found');
const strList = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.map(x => String(x).trim()).filter(Boolean))].slice(0, max) : undefined);
const money = (v: unknown) => (v === null || v === '' ? null : clamp(v, 0, 1e7, 0));

api.get('/listings', wrap(() => all('SELECT * FROM listings ORDER BY updated_at DESC').map(l => toListing(l))));
api.get('/listings/:id', wrap(req => toListing(listingRow(String(req.params.id)), true)));
api.patch('/listings/:id', wrap(req => {
  const row = listingRow(String(req.params.id)), b = req.body ?? {};
  const f: Record<string, unknown> = { updated_at: now() };
  if (typeof b.title === 'string' && b.title.trim()) f.title = b.title.trim().slice(0, 200);
  if (typeof b.description === 'string') f.description = b.description.slice(0, 20000);
  if ('price' in b) f.price = money(b.price);
  if ('compareAt' in b) f.compare_at = money(b.compareAt);
  if (typeof b.seoTitle === 'string') f.seo_title = b.seoTitle.trim().slice(0, 255);
  if (typeof b.seoDescription === 'string') f.seo_description = b.seoDescription.trim().slice(0, 320);
  if (typeof b.note === 'string') f.note = b.note.trim().slice(0, 2000);
  for (const [k, max] of [['tags', 50], ['sizes', 12], ['media', 500], ['hidden', 500]] as const) { const v = strList(b[k], max); if (v) f[k] = JSON.stringify(v); }
  if (['draft', 'ready'].includes(b.status)) f.status = b.status;
  update('listings', String(row.id), f);
  return toListing(listingRow(String(row.id)), true);
}));
/** Removes only the product record; its mockups and photos stay (they get a fresh product next time they're saved). */
api.delete('/listings/:id', wrap(async req => {
  const row = listingRow(String(req.params.id));
  return { ok: true, ...(await deleteListings([String(row.id)], { mockups: req.query.mockups === '1', photos: req.query.photos === '1' })) };
}));

// ---------- Shopify push ----------
const shopifyCall = async <T>(fn: () => T | Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { if (e instanceof ShopifyError) fail(422, e.message); throw e; } };
api.get('/shopify/status', wrap(() => shopifyStatus()));
/** Check which linked products still exist in Shopify (called by the Studio while it is open). */
api.post('/shopify/sync', wrap(() => shopifyCall(() => syncWithShopify())));
api.get('/shopify/profiles', wrap(() => profilesSummary() ?? { none: true }));
api.get('/listings/:id/shopify/preview', wrap(req => shopifyCall(() => previewListing(String(listingRow(String(req.params.id)).id)))));
api.post('/listings/:id/shopify/autofill', wrap(req => shopifyCall(() => {
  const id = String(listingRow(String(req.params.id)).id);
  return { changed: autofillListing(id), listing: toListing(listingRow(id), true) };
})));
/** Codex writes the title, story, tags and search listing the way the store's own pages are written (fills what is empty; rewrite: true replaces it). */
api.post('/listings/:id/write', wrap(req => ({ jobIds: queueCopy([String(listingRow(String(req.params.id)).id)], req.body?.rewrite ? 'all' : 'empty') })));
api.post('/listings/write-missing', wrap(() => ({ jobIds: queueCopy(all('SELECT * FROM listings').filter(needsCopy).map(l => String(l.id))) })));
/** Create the product as a draft in Shopify (or update it if it was pushed before). */
api.post('/listings/:id/shopify/push', wrap(req => shopifyCall(async () => {
  const id = String(listingRow(String(req.params.id)).id);
  const info = await pushListing(id);
  return { ...info, listing: toListing(listingRow(id), true) };
})));

// ---------- shoots ----------
api.get('/shot-templates', (_req, res) => { res.json(SHOT_TEMPLATES); });
api.get('/shoots', wrap(req => {
  const mockup = req.query.mockup ? String(req.query.mockup) : null;
  const kind = req.query.kind ? String(req.query.kind) : null;
  const where: string[] = [], params: unknown[] = [];
  if (mockup) { where.push('s.mockup_id = ?'); params.push(mockup); }
  if (req.query.listing) { where.push('m.listing_id = ?'); params.push(String(req.query.listing)); }
  if (req.query.batch) { where.push('s.batch_id = ?'); params.push(String(req.query.batch)); }
  if (kind) { where.push('s.kind = ?'); params.push(kind); }
  if (req.query.model) { where.push('s.model_id = ?'); params.push(String(req.query.model)); } // one model's feed
  if (req.query.favorite === '1') where.push('s.favorite = 1');
  return all(`SELECT s.*, m.listing_id FROM shoots s LEFT JOIN mockups m ON m.id = s.mockup_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC`, ...params).map(toShoot);
}));
api.post('/shoots/generate', wrap(req => {
  const b = req.body as GenerateShootsRequest;
  const mockups = (b.mockupIds ?? []).map(String).map(mockupRow).filter(Boolean) as Record<string, any>[];
  const shots = SHOT_TEMPLATES.filter(t => (b.shots ?? []).includes(t.key));
  if (!mockups.length) fail(400, 'Choose at least one mockup.');
  if (!shots.length) fail(400, 'Choose at least one shot.');
  const count = clamp(b.count, 1, 6, 1);
  // The studio photos on a model are made once on every ticked studio backdrop (none ticked: the fixed grey backdrops).
  const studios = [...new Set((Array.isArray(b.studioIds) ? b.studioIds : b.studioId ? [b.studioId] : []).map(String).filter(Boolean))];
  const tasks = mockups.flatMap(m => {
    const renders = JSON.parse(String(m.renders || '{}'));
    return shotsFor(shots, renders, JSON.parse(String(m.views || '{}'))).flatMap(t => (t.usesStudio && studios.length ? studios : [null]).flatMap(studioId => Array.from({ length: count }, (_, variant) => ({ m, t, variant, studioId }))));
  });
  if (!tasks.length) fail(400, 'None of the chosen mockups have the views those shots need (e.g. a back shot needs a back print).');
  const batchId = newId('bat'), seedBase = Math.floor(Math.random() * 1000); // each photo gets its own seed: its own pose, light and small details
  const jobIds = transaction(() => tasks.map(({ m, t, variant, studioId }, k) => enqueue('shoot', `${t.label} · ${short(String(m.name), 40)}`, {
    mockupId: m.id, shot: t.key, view: t.view, modelId: b.modelId || null, locationId: b.locationId || null, studioId, styleId: b.styleId || null, seed: seedBase + k,
    ...(b.accessory ? { accessory: String(b.accessory).slice(0, 120), accessoryText: String(b.accessoryText ?? '').slice(0, 200) } : {}), ...(b.bottoms ? { bottoms: String(b.bottoms).slice(0, 160) } : {}),
    notes: String(b.notes ?? '').slice(0, 1500), variant, count, ratio: SHOOT_RATIOS.find(r => r === b.ratio) ?? '4:5', framing: SHOOT_FRAMINGS.find(f => f === b.framing) ?? 'medium',
  }, batchId)));
  const wanted = mockups.length * shots.reduce((n, t) => n + (t.usesStudio && studios.length ? studios.length : 1), 0) * count;
  return { batchId, jobIds, skipped: wanted - tasks.length };
}));
api.patch('/shoots/:id', wrap(req => {
  const row = get('SELECT * FROM shoots WHERE id = ?', String(req.params.id)) ?? fail(404, 'Photo not found');
  if (typeof req.body?.favorite === 'boolean') update('shoots', String(row.id), { favorite: req.body.favorite ? 1 : 0 });
  if (typeof req.body?.caption === 'string') update('shoots', String(row.id), { caption: req.body.caption.trim().slice(0, 2000) });
  if (Array.isArray(req.body?.hashtags)) update('shoots', String(row.id), { hashtags: req.body.hashtags.map((h: unknown) => `#${String(h).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((h: string) => h.length > 1).join(' ').slice(0, 600) });
  return toShoot(get('SELECT s.*, m.listing_id FROM shoots s LEFT JOIN mockups m ON m.id = s.mockup_id WHERE s.id = ?', String(row.id))!);
}));
/** Many photos at once: by `ids`, or every photo of one shoot (`batch`). Actions: delete, favorite, unfavorite. */
api.post('/shoots/bulk', wrap(async req => {
  const b = req.body ?? {};
  const ids: string[] = b.batch ? all('SELECT id FROM shoots WHERE batch_id = ?', String(b.batch)).map(r => String(r.id)) : Array.isArray(b.ids) ? b.ids.map(String) : [];
  if (!ids.length) fail(400, 'Choose at least one photo.');
  const action = String(b.action);
  if (action === 'delete') return { ok: true, deleted: await deleteShoots(ids) };
  if (action === 'favorite' || action === 'unfavorite') { run(`UPDATE shoots SET favorite = ? WHERE id IN (${ids.map(() => '?').join(',')})`, action === 'favorite' ? 1 : 0, ...ids); return { ok: true }; }
  return fail(400, 'Unknown action.');
}));
api.delete('/shoots/:id', wrap(async req => {
  const row = get('SELECT * FROM shoots WHERE id = ?', String(req.params.id)) ?? fail(404, 'Photo not found');
  run('DELETE FROM shoots WHERE id = ?', row.id);
  await removeFiles(String(row.file), String(row.thumb));
  return { ok: true };
}));
api.get('/shoots/:id/download', wrap((req, res) => {
  const row = get('SELECT * FROM shoots WHERE id = ?', String(req.params.id)) ?? fail(404, 'Photo not found');
  res.download(abs(String(row.file)), `${row.shot}-${row.id}.png`);
}));

// ---------- jobs ----------
api.get('/jobs', wrap(req => {
  const status = req.query.status ? String(req.query.status) : null;
  const limit = clamp(req.query.limit, 1, 500, 200);
  // Waiting and running jobs are never cut off (one click can queue hundreds of photos); the limit only trims the history of finished ones.
  const rows = status === 'active'
    ? all(`SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at`)
    : all(`SELECT * FROM jobs WHERE status IN ('queued','running') OR id IN (SELECT id FROM jobs WHERE status NOT IN ('queued','running') ORDER BY created_at DESC LIMIT ?) ORDER BY created_at DESC`, limit);
  return rows.map(toJob);
}));
api.post('/jobs/:id/cancel', wrap(req => { if (!cancelJob(String(req.params.id))) fail(404, 'Job not found'); return { ok: true }; }));
api.post('/jobs/:id/retry', wrap(req => { retryJob(String(req.params.id)); return { ok: true }; }));
api.post('/jobs/cancel-all', wrap(() => { for (const j of all(`SELECT id FROM jobs WHERE status IN ('queued','running')`)) cancelJob(String(j.id)); return { ok: true }; }));
api.post('/jobs/retry-all', wrap(() => retryAll()));
api.post('/queue/resume', wrap(() => { resumeQueue(); return { ok: true }; }));
api.post('/jobs/clear', wrap(() => { run(`DELETE FROM jobs WHERE status IN ('done','cancelled','error')`); return { ok: true }; }));

// ---------- Claude helper (server/assist.ts): the Studio's AI chat, on the owner's Claude login ----------
/** Claude problems (not installed, not signed in, busy) are not the browser's fault: 502 with a plain message. */
const viaClaude = async <T,>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { throw e instanceof ClaudeError ? new HttpError(502, e.message) : e; } };
const FIELDS: AssistField[] = ['shoot', 'model', 'location', 'studio', 'style', 'design', 'refine'];
const NO_PRINT = (m: Record<string, any>, view: View) => !JSON.parse(String(m.renders || '{}'))[view];

api.post('/assist/improve', wrap(req => {
  const b = req.body ?? {};
  if (!FIELDS.includes(b.field)) fail(400, 'Unknown box.');
  const text = String(b.text ?? '');
  if (!text.trim()) fail(400, 'Write a few words first, then Improve can work on them.');
  return viaClaude(() => improveText({ field: b.field, text, context: b.context ? String(b.context).slice(0, 600) : undefined }));
}));
api.post('/assist/describe-model', wrap(req => {
  const b = req.body ?? {};
  if (!String(b.idea ?? '').trim()) fail(400, 'Write a rough idea first, for example "24 year old Cairo streetwear creator, athletic, curly hair".');
  return viaClaude(() => describeModel({ idea: String(b.idea), gender: b.gender ? String(b.gender).slice(0, 40) : undefined, age: b.age ? String(b.age).slice(0, 40) : undefined }));
}));
/** Claude looks at the options of a new model side by side and says which reads as a real person. */
api.post('/presets/options/:group/review', wrap(req => {
  const rows = all('SELECT id, file FROM presets WHERE group_id = ? AND file IS NOT NULL ORDER BY name', String(req.params.group));
  if (rows.length < 2) fail(400, 'Wait until at least two options have their photos, then Claude can compare them.');
  return viaClaude(() => rankModels({ photos: rows.map(r => ({ id: String(r.id), path: abs(String(r.file)) })) }));
}));
/** A reference photo (a Pinterest shot, say) is broken into place, look, pose and camera as words. The photo is only read, never stored. */
api.post('/assist/read-photo', upload.single('image'), wrap(async req => {
  if (!req.file) fail(400, 'Choose a photo first.');
  const png = await sharp(req.file!.buffer, { limitInputPixels: 80_000_000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer().catch(() => fail(400, 'That image could not be read.'));
  const dir = path.join(os.tmpdir(), 'studio-read'), file = path.join(dir, `${newId('ref')}.jpg`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, png);
  try { return await viaClaude(() => describeReference({ photoPath: file })); } finally { await fs.rm(file, { force: true }); }
}));
/** Claude looks at the mockup (and the model) and proposes different lifestyle shots; nothing is queued until the owner picks some. */
api.post('/shoots/ideas', wrap(req => {
  const b = req.body ?? {};
  const mockup = mockupRow(Array.isArray(b.mockupIds) ? b.mockupIds[0] : b.mockupId) ?? fail(404, 'Choose a mockup first.');
  const renders = JSON.parse(String(mockup.renders || '{}')) as Partial<Record<View, string>>;
  const render = renders.front ?? renders.back ?? fail(400, 'That mockup has no picture yet.');
  const product = getProduct(String(mockup.product_id));
  const model = b.modelId ? presetRow(b.modelId) : undefined;
  return viaClaude(() => shotIdeas({
    renderPath: abs(render), modelPath: model?.file ? abs(String(model.file)) : null, garment: product ? `${product.color} ${product.style}` : String(mockup.name),
    theme: b.theme ? String(b.theme).slice(0, 300) : undefined, count: clamp(b.count, 2, 8, 5), same: !!b.same,
  }));
}));
/** Queues the picked ideas as shoots: each keeps its own written place and art direction. */
api.post('/shoots/ideas/run', wrap(req => {
  const b = req.body ?? {};
  const mockups = (Array.isArray(b.mockupIds) ? b.mockupIds : [b.mockupId]).map(String).map(mockupRow).filter(Boolean) as Record<string, any>[];
  if (!mockups.length) fail(400, 'Choose a mockup first.');
  const ideas = (Array.isArray(b.ideas) ? b.ideas : []).slice(0, 12) as { shot: string; place: string; notes: string; title?: string; size?: string }[];
  const tasks = mockups.flatMap(mockup => ideas.flatMap(i => { const t = SHOT_TEMPLATES.find(x => x.key === i.shot && x.usesLocation); return t && !NO_PRINT(mockup, t.view) ? [{ mockup, i, t }] : []; }));
  if (!tasks.length) fail(400, 'None of those ideas fit these mockups (a back shot needs a back view).');
  const batchId = newId('bat'), ratio = SHOOT_RATIOS.find(r => r === b.ratio) ?? '4:5', seedBase = Math.floor(Math.random() * 1000);
  const jobIds = transaction(() => tasks.map(({ mockup, i, t }, k) => enqueue('shoot', `${t.label} · ${short(String(i.title || mockup.name), 40)}`, {
    mockupId: mockup.id, shot: t.key, modelId: b.modelId || null, locationId: null, styleId: b.styleId || null, seed: seedBase + k,
    notes: String(i.notes ?? '').slice(0, 1500), placeText: String(i.place ?? '').slice(0, 1500), variant: 0, count: 1, ratio, framing: SHOOT_FRAMINGS.find(f => f === i.size) ?? 'medium',
  }, batchId)));
  return { batchId, jobIds, skipped: mockups.length * ideas.length - tasks.length };
}));
/** "Fix this photo": the photo is edited with one stated change (Codex, about 2 minutes) and saved as a new photo beside the original. */
api.post('/shoots/:id/fix', wrap(req => {
  const row = get('SELECT * FROM shoots WHERE id = ?', String(req.params.id)) ?? fail(404, 'Photo not found');
  const feedback = String(req.body?.feedback ?? '').trim();
  if (!feedback) fail(400, 'Say what to fix, for example "the print is cut off on the left sleeve".');
  return { jobId: enqueue('shoot', `Fix · ${short(feedback, 40)}`, { fixOf: row.id, feedback: feedback.slice(0, 1000) }) };
}));
/** Claude compares a photo with the artwork files of its mockup and says whether the print is faithful (cut off, mirrored, wrong colours, missing sleeve). */
api.post('/shoots/:id/check', wrap(async req => {
  const row = get('SELECT * FROM shoots WHERE id = ?', String(req.params.id)) ?? fail(404, 'Photo not found');
  const mockup = mockupRow(String(row.mockup_id)) ?? fail(400, 'The mockup of this photo was deleted, so there is no artwork to compare with.');
  const template = SHOT_TEMPLATES.find(t => t.key === row.shot) ?? fail(400, 'Unknown shot.');
  const views = JSON.parse(String(mockup.views)) as Record<View, { designId: string; x: number; widthCm: number }[]>;
  // the side the photo was taken of: a sleeve close-up's side, or the back for a front shot of a back-print-only mockup
  const view: View = template.key === 'ecom-detail-sleeve' ? sleeveSide(views) ?? 'front' : !template.usesModel && !views[template.view]?.length && views.back?.length ? 'back' : template.view;
  const layers = template.key === 'ecom-detail-sleeve' ? (views[view] ?? []).filter(isSleeveLayer) : views[view] ?? [];
  const artwork = [...new Set(layers.map(l => l.designId))].map(designRow).filter(Boolean).map(d => ({ path: abs(String(d!.file)), title: String(d!.title) }));
  if (!artwork.length) fail(400, 'This mockup has no print on that side.');
  return viaClaude(() => checkPrint({ photoPath: abs(String(row.file)), artwork, expect: printExpectation(layers, view, isCloseUp(template.key)) }));
}));
/** A caption and hashtags for a photo. Claude looks at the photo itself. */
api.post('/shoots/:id/caption', wrap(async req => {
  const row = get('SELECT * FROM shoots WHERE id = ?', String(req.params.id)) ?? fail(404, 'Photo not found');
  const b = req.body ?? {};
  const out = await viaClaude(() => captionFor({
    photoPath: abs(String(row.file)), platform: b.platform === 'tiktok' ? 'tiktok' : 'instagram', length: b.length === 'short' ? 'short' : 'medium', context: b.context ? String(b.context).slice(0, 400) : undefined,
  }));
  update('shoots', String(row.id), { caption: out.caption.trim().slice(0, 2000), hashtags: out.hashtags.map(h => `#${h.replace(/^#+/, '').replace(/\s+/g, '')}`).filter(h => h.length > 1).join(' ').slice(0, 600) });
  return toShoot(get('SELECT s.*, m.listing_id FROM shoots s LEFT JOIN mockups m ON m.id = s.mockup_id WHERE s.id = ?', String(row.id))!);
}));

// ---------- errors ----------
api.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : err?.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 413 ? 'File is too large (30 MB max).' : String(err?.message || 'Something went wrong.') });
});
