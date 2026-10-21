// DB row -> API object mappers and lookups.
import { MODEL_PHOTOS, type Design, type Job, type Mockup, type ModelPhoto, type Preset, type Reference, type Shoot } from '../shared/types.ts';
import { all, get } from './db.ts';
import { fileUrl } from './files.ts';

type Row = Record<string, any>;
const json = <T>(v: unknown, fallback: T): T => { try { return v ? JSON.parse(String(v)) : fallback; } catch { return fallback; } };

export const toDesign = (r: Row): Design => ({
  id: r.id, title: r.title, prompt: r.prompt, placement: r.placement, status: r.status, favorite: !!r.favorite,
  source: r.source, parentId: r.parent_id, batchId: r.batch_id, threadId: r.thread_id, setId: r.set_id ?? null, genMs: r.gen_ms ?? null,
  url: fileUrl(r.file)!, thumbUrl: fileUrl(r.thumb)!, width: r.width, height: r.height, transparent: !!r.transparent, createdAt: r.created_at,
});

export const toReference = (r: Row): Reference => ({ id: r.id, name: r.name, url: fileUrl(r.file)!, thumbUrl: fileUrl(r.thumb)!, createdAt: r.created_at });

export const toMockup = (r: Row): Mockup => {
  const renders = json<Record<string, string>>(r.renders, {});
  return {
    id: r.id, name: r.name, productId: r.product_id, bodyWidth: r.body_width,
    views: json(r.views, { front: [], back: [] }),
    renders: Object.fromEntries(Object.entries(renders).map(([k, v]) => [k, `${fileUrl(v)}?v=${encodeURIComponent(r.updated_at)}`])),
    listingId: r.listing_id ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
};

/** Stored extra photos of a model, by view. */
export const presetViewRows = (r: Row) => json<Partial<Record<ModelPhoto, { file: string; thumb: string }>>>(r.views, {});

export const toPreset = (r: Row): Preset => {
  const views = presetViewRows(r);
  return {
    id: r.id, kind: r.kind, name: r.name, description: r.description, url: fileUrl(r.file), thumbUrl: fileUrl(r.thumb),
    views: Object.fromEntries(MODEL_PHOTOS.filter(v => views[v]?.file).map(v => [v, { url: fileUrl(views[v]!.file)!, thumbUrl: fileUrl(views[v]!.thumb)! }])),
    groupId: r.group_id ?? null, createdAt: r.created_at,
  };
};

export const toShoot = (r: Row): Shoot => ({
  id: r.id, mockupId: r.mockup_id, shot: r.shot, kind: r.kind, modelId: r.model_id, locationId: r.location_id, styleId: r.style_id,
  notes: r.notes, favorite: !!r.favorite, url: fileUrl(r.file)!, thumbUrl: fileUrl(r.thumb)!, batchId: r.batch_id, listingId: r.listing_id ?? null,
  caption: String(r.caption ?? ''), hashtags: String(r.hashtags ?? '').split(/\s+/).filter(Boolean), createdAt: r.created_at,
});

export const toJob = (r: Row): Job => ({
  id: r.id, type: r.type, status: r.status, label: r.label, batchId: r.batch_id, input: json(r.input, {}), result: json(r.result, null),
  error: r.error, attempts: r.attempts, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
});

export const designRow = (id: string) => get('SELECT * FROM designs WHERE id = ?', id);
export const mockupRow = (id: string) => get('SELECT * FROM mockups WHERE id = ?', id);
export const presetRow = (id: string | null | undefined) => (id ? get('SELECT * FROM presets WHERE id = ?', id) : undefined);
export const refRows = (ids: string[]) => (ids.length ? all(`SELECT * FROM refs WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : []);
export const designRows = (ids: string[]) => (ids.length ? all(`SELECT * FROM designs WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : []);
