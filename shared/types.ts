// Types shared by the API server and the React client.

export type Placement = 'front' | 'back' | 'sleeve';
export type View = 'front' | 'back';
export type DesignStatus = 'draft' | 'approved' | 'archived';
export type JobType = 'design' | 'refine' | 'shoot' | 'preset' | 'copy';
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
/** Queue paused after a Codex usage-limit or login error; `until` is a ms timestamp. */
export interface QueuePause { until: number; reason: string }
export type PresetKind = 'model' | 'location' | 'studio' | 'style';
/** Extra photos of a saved model, made from its main photo: a face close-up, a full-body shot and a view from behind. */
export const MODEL_VIEWS = ['face', 'body', 'back'] as const;
export type ModelView = (typeof MODEL_VIEWS)[number];
/** Everything stored under a model's `views`: those three photos and the character sheet (one 16:9 picture of the same person from the front, the side, three-quarter, behind and full length). */
export const MODEL_PHOTOS = [...MODEL_VIEWS, 'sheet'] as const;
export type ModelPhoto = (typeof MODEL_PHOTOS)[number];
export type ShotKind = 'ecom' | 'lifestyle';

export interface Design {
  id: string;
  title: string;
  prompt: string;
  placement: Placement;
  status: DesignStatus;
  favorite: boolean;
  source: 'generated' | 'uploaded' | 'refined';
  parentId: string | null;
  batchId: string | null;
  threadId: string | null;
  /** Linked designs (the front, back and sleeve prints of one collection, made together or linked by hand) share a set. */
  setId: string | null;
  /** How long Codex took to make it, in ms; null for uploads. */
  genMs: number | null;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  transparent: boolean;
  createdAt: string;
}

export interface Reference {
  id: string;
  name: string;
  url: string;
  thumbUrl: string;
  createdAt: string;
}

export interface Product {
  id: string;
  style: string;
  color: string;
  type: 't-shirt' | 'crewneck' | 'hoodie' | 'long-sleeves';
  defaultBodyWidth: number;
  images: Record<View, string>;
  masks: Record<View, string>;
}

/** x/y are the layer center in the 1024×1024 product-photo space. */
export interface Layer {
  id: string;
  designId: string;
  x: number;
  y: number;
  widthCm: number;
  rotation: number;
  flip: boolean;
  opacity: number;
}

export interface Mockup {
  id: string;
  name: string;
  productId: string;
  bodyWidth: number;
  views: Record<View, Layer[]>;
  renders: Partial<Record<View, string>>;
  /** The Shopify product this mockup's color belongs to. */
  listingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Preset {
  id: string;
  kind: PresetKind;
  name: string;
  description: string;
  url: string | null;
  thumbUrl: string | null;
  /** Extra photos of a model (see MODEL_PHOTOS); empty for other kinds. */
  views: Partial<Record<ModelPhoto, { url: string; thumbUrl: string }>>;
  /** Models made together as options to choose from share a group until one is kept. */
  groupId: string | null;
  createdAt: string;
}

export interface ShotTemplate {
  key: string;
  kind: ShotKind;
  label: string;
  view: View;
  usesModel: boolean;
  usesLocation: boolean;
  /** The studio photos on a model: they use a saved studio backdrop (kind 'studio') when one is chosen. */
  usesStudio: boolean;
}

export interface Shoot {
  id: string;
  mockupId: string;
  shot: string;
  kind: ShotKind;
  modelId: string | null;
  locationId: string | null;
  styleId: string | null;
  notes: string;
  favorite: boolean;
  url: string;
  thumbUrl: string;
  batchId: string | null;
  /** Inherited from the mockup. */
  listingId: string | null;
  /** A social caption and hashtags written for the photo (empty until asked for). */
  caption: string;
  hashtags: string[];
  createdAt: string;
}

export type ListingStatus = 'draft' | 'ready' | 'published';

/** One photo in a product's gallery: a shoot, or a mockup render of one view. */
export interface ListingMedia {
  key: string;
  kind: 'shoot' | 'mockup';
  url: string;
  thumbUrl: string;
  label: string;
  color: string;
  hidden: boolean;
}

export interface ListingCheck { key: string; label: string; ok: boolean }

/** Where a product lives on Shopify after a push. */
export interface ShopifyInfo { id: string; handle: string; adminUrl: string; status: string; pushedAt: string; variantCount: number; imageCount: number; warnings: string[] }

/** Result of checking the linked products against Shopify. */
export interface ShopifySyncResult { checked: number; changed: { id: string; title: string; change: 'deleted' | 'status'; status?: string }[] }

/** One product family as the store sets it up, for the Publish to Shopify page. */
export interface ShopifyFamilySummary {
  key: string; label: string; basedOn: string; productType: string; template: string | null; optionName: string; sizes: string[];
  price: number; compareAt: number | null; morePrintsPrice: number | null; skuPrefix: string; inventoryPolicy: string; taxable: boolean; tags: string[]; styles: string[];
}
export interface ShopifyProfilesSummary {
  generatedAt: string; store: { name: string; domain: string; currency: string; productCount: number }; channels: string[]; families: ShopifyFamilySummary[];
}

/** How the store sets up products of this garment's family (read from the live store). */
export interface ShopifyProfileInfo {
  key: string; label: string; basedOn: string; productType: string; templateSuffix: string | null; optionName: string; sizes: string[];
  price: number; compareAt: number | null; morePrintsPrice: number | null; skuPrefix: string; inventoryPolicy: string;
}

/** A sellable product (future Shopify product): one design set on one garment style, with every color as a variant. */
export interface Listing {
  id: string;
  title: string;
  style: string;
  productType: Product['type'] | null;
  description: string;
  price: number | null;
  compareAt: number | null;
  tags: string[];
  sizes: string[];
  status: ListingStatus;
  designIds: string[];
  /** The search-engine listing (Google result); empty means the push derives it from the story. */
  seoTitle: string;
  seoDescription: string;
  /** When Codex last wrote this product's details. */
  copyAt: string | null;
  /** The owner's own note about the product (a to-do, an idea); shown on the product card, never sent to Shopify. */
  note: string;
  colors: { mockupId: string; productId: string; color: string; thumbUrl: string | null }[];
  coverUrl: string | null;
  photoCount: number;
  checks: ListingCheck[];
  shopifyId: string | null;
  /** Set after "Push to Shopify". */
  shopify: ShopifyInfo | null;
  /** Set when the product was deleted in Shopify after a push, so it can be pushed again. */
  shopifyRemovedAt: string | null;
  profile: ShopifyProfileInfo | null;
  /** Sizes this garment can be sold in (the store's sizes for its family). */
  sizeOptions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListingDetail extends Listing { media: ListingMedia[] }

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  label: string;
  batchId: string | null;
  input: Record<string, unknown>;
  result: { kind: 'design' | 'shoot' | 'preset' | 'copy'; id: string; notes?: string[] } | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface GenerateDesignsRequest {
  ideas: string[];
  referenceIds: string[];
  /** Also usable as references: existing designs ("more like this"). */
  designIds?: string[];
  separateReferences: boolean;
  /** One placement, or use `placements` to make a linked set. */
  placement: Placement;
  /** Several placements are made as a linked set: the first print first, each later one made from the ones before it. */
  placements?: Placement[];
  /** Dress the subject in the store's Egyptian-mythology style. Off: the idea or reference decides the look. */
  egyptian?: boolean;
  /** Recreate the artwork in each reference exactly (cleaned up, on a transparent background) instead of making a new design inspired by it. */
  exact?: boolean;
  count: number;
}

/** Link designs as one set: each design with the placement it is linked as. `into` is an existing set whose members are being changed. */
export interface LinkDesignsRequest {
  members: { id: string; placement: Placement }[];
  into?: string | null;
}

/** Picture shapes for lifestyle photos, by where they are posted: the feed and the store (4:5), Stories, Reels and TikTok (9:16), a square post (1:1). E-commerce photos are always 4:5, the store's shape. */
export const SHOOT_RATIOS = ['4:5', '9:16', '1:1'] as const;
export type ShootRatio = (typeof SHOOT_RATIOS)[number];
export const RATIO_LABEL: Record<ShootRatio, string> = { '4:5': 'Feed & store 4:5', '9:16': 'Stories, Reels & TikTok 9:16', '1:1': 'Square 1:1' };

/** How much of the person a lifestyle photo shows (the camera course's shot sizes): medium is waist up (the default), full is head to toe, wide is a small figure in a big place, close is the print filling the frame. */
export const SHOOT_FRAMINGS = ['medium', 'full', 'wide', 'close'] as const;
export type ShootFraming = (typeof SHOOT_FRAMINGS)[number];
export const FRAMING_LABEL: Record<ShootFraming, string> = { medium: 'Medium', full: 'Full length', wide: 'Wide', close: 'Close-up' };

export interface GenerateShootsRequest {
  mockupIds: string[];
  shots: string[];
  modelId: string | null;
  locationId: string | null;
  /** A saved studio backdrop for the studio photos on a model; without one they use the fixed grey backdrops. */
  studioId?: string | null;
  /** Several saved studio backdrops: each studio photo on a model is made once on every one of them (this wins over `studioId`). */
  studioIds?: string[];
  styleId: string | null;
  notes: string;
  count: number;
  /** Sunglasses worn in the front photos on a model: a file under data/files/accessories/ and what it is. */
  accessory?: string;
  accessoryText?: string;
  /** What the model wears below the garment, to suit the colours (otherwise a plain pair from a short list). */
  bottoms?: string;
  /** Lifestyle photos only; defaults to 4:5. */
  ratio?: ShootRatio;
  /** Lifestyle photos only; defaults to medium. */
  framing?: ShootFraming;
}

/** A print whose centre lies outside the body width is on a sleeve (same rule as the editor's Copy sleeves). */
export const isSleeveLayer = (l: { x: number }) => Math.abs(l.x - CANVAS / 2) > BODY_PX * 0.45;

/** Print close-ups: of the chest print, of the back print, and of a sleeve strip. */
export const isCloseUp = (key: string) => key.startsWith('ecom-detail');
/** The side a sleeve close-up is taken of: the front when it has sleeve prints, else the back. */
export const sleeveSide = (views: Partial<Record<View, { x: number }[]>> | undefined): View | null =>
  (['front', 'back'] as View[]).find(v => views?.[v]?.some(isSleeveLayer)) ?? null;

/**
 * The shots a mockup really gets from the ones ticked: a front shot of a mockup that only has a back print becomes the matching back shot (and the other way round),
 * so ticking "Studio front on model" for a mix of front and back mockups shoots each one on the side that has the print. Shots the mockup cannot do at all are dropped.
 * The sleeve close-up goes to the side with sleeve prints (`views`, the mockup's layers) and is dropped for a mockup without any.
 */
export function shotsFor(shots: ShotTemplate[], renders: Partial<Record<View, string>>, views?: Partial<Record<View, { x: number }[]>>): ShotTemplate[] {
  const PAIRS: Record<string, string> = { 'ecom-detail': 'ecom-detail-back', 'ecom-detail-back': 'ecom-detail', 'ecom-flatlay': 'ecom-flatlay-back', 'ecom-flatlay-back': 'ecom-flatlay' };
  const swap = (key: string) => PAIRS[key] ?? (/-front$/.test(key) ? key.replace(/-front$/, '-back') : /-back$/.test(key) ? key.replace(/-back$/, '-front') : key);
  const out = shots.map(t => {
    if (t.key === 'ecom-detail-sleeve') { const v = sleeveSide(views); return v && renders[v] ? { ...t, view: v } : null; }
    if (renders[t.view]) return t;
    // the ghost has no model and no back version: a mockup with only a back print gets it of its back
    return SHOT_TEMPLATES.find(x => x.key === swap(t.key) && x.key !== t.key && renders[x.view]) ?? (!t.usesModel && t.view === 'front' && renders.back ? { ...t, view: 'back' as View } : null);
  }).filter((t): t is ShotTemplate => !!t);
  return out.filter((t, i) => out.findIndex(x => x.key === t.key) === i);
}

export const SHOT_TEMPLATES: ShotTemplate[] = [
  { key: 'ecom-front', kind: 'ecom', label: 'Studio · front on model', view: 'front', usesModel: true, usesLocation: false, usesStudio: true },
  { key: 'ecom-back', kind: 'ecom', label: 'Studio · back on model', view: 'back', usesModel: true, usesLocation: false, usesStudio: true },
  { key: 'ecom-flatlay', kind: 'ecom', label: 'Flat lay · front', view: 'front', usesModel: false, usesLocation: false, usesStudio: false },
  { key: 'ecom-flatlay-back', kind: 'ecom', label: 'Flat lay · back', view: 'back', usesModel: false, usesLocation: false, usesStudio: false },
  { key: 'ecom-ghost', kind: 'ecom', label: 'Ghost mannequin', view: 'front', usesModel: false, usesLocation: false, usesStudio: false },
  { key: 'ecom-detail', kind: 'ecom', label: 'Print close-up · front', view: 'front', usesModel: false, usesLocation: false, usesStudio: false },
  { key: 'ecom-detail-back', kind: 'ecom', label: 'Print close-up · back', view: 'back', usesModel: false, usesLocation: false, usesStudio: false },
  { key: 'ecom-detail-sleeve', kind: 'ecom', label: 'Print close-up · sleeve', view: 'front', usesModel: false, usesLocation: false, usesStudio: false },
  { key: 'life-front', kind: 'lifestyle', label: 'Lifestyle · front', view: 'front', usesModel: true, usesLocation: true, usesStudio: false },
  { key: 'life-back', kind: 'lifestyle', label: 'Lifestyle · back', view: 'back', usesModel: true, usesLocation: true, usesStudio: false },
  { key: 'life-candid', kind: 'lifestyle', label: 'Lifestyle · candid walk', view: 'front', usesModel: true, usesLocation: true, usesStudio: false },
];

/** Pixel width of the garment body in the 1024px product photos; layer px = widthCm * BODY_PX / bodyWidth. */
export const BODY_PX = 554;
export const CANVAS = 1024;
/** A small version (webp, at most `w` px) of a /files or product photo URL, made on demand by the server. The full renders are 1-2 MB, too heavy for grids on a phone. */
export const smallUrl = <T extends string | null | undefined>(url: T, w = 480): T => (url ? (`${url}${url.includes('?') ? '&' : '?'}w=${w}` as T) : url);

export const PLACEMENT_DEFAULTS: Record<Placement, { view: View; widthCm: number; x: number }> = {
  front: { view: 'front', widthCm: 25, x: 512 },
  back: { view: 'back', widthCm: 30, x: 512 },
  sleeve: { view: 'front', widthCm: 7, x: 160 },
};

/** Where the top edge of a print starts (1024px photo space), measured from each garment's neckline/hood. */
export const PRINT_TOP: Record<Product['type'], Record<Placement, number>> = {
  crewneck: { front: 235, back: 215, sleeve: 330 },
  hoodie: { front: 320, back: 365, sleeve: 360 },
  't-shirt': { front: 215, back: 200, sleeve: 300 },
  'long-sleeves': { front: 215, back: 205, sleeve: 320 },
};

/** Prints moved to another garment type keep their distance from where prints start on it (necklines and hoods sit at different heights). `placementOf` tells a sleeve print from the rest. */
export function refitViews(views: Record<View, Layer[]>, from: Product['type'], to: Product['type'], placementOf: (designId: string) => Placement | undefined): Record<View, Layer[]> {
  if (from === to) return views;
  const shift = (view: View) => (l: Layer): Layer => {
    const p: Placement = placementOf(l.designId) === 'sleeve' ? 'sleeve' : view;
    return { ...l, y: Math.round(l.y + PRINT_TOP[to][p] - PRINT_TOP[from][p]) };
  };
  return { front: views.front.map(shift('front')), back: views.back.map(shift('back')) };
}

export const layerSize = (widthCm: number, bodyWidth: number, aspect: number) => {
  const w = (widthCm * BODY_PX) / bodyWidth;
  return { w, h: w * aspect };
};
