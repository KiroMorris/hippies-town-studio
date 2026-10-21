import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Product, View } from '../shared/types.ts';
import { config } from './config.ts';

interface CatalogEntry { id: string; style: string; color: string; images: Record<View, string>; masks: Record<View, string> }

const typeOf = (id: string): Product['type'] =>
  id.includes('hoodie') ? 'hoodie' : id.includes('crewneck') ? 'crewneck' : id.includes('long-sleeves') ? 'long-sleeves' : 't-shirt';

const entries: CatalogEntry[] = JSON.parse(fs.readFileSync(config.paths.catalog, 'utf8'));

export const products: Product[] = entries.map(e => ({
  id: e.id,
  style: e.style.replace(/\bT Shirt\b/, 'T-shirt'),
  color: e.color,
  type: typeOf(e.id),
  defaultBodyWidth: e.id.startsWith('custom-regular') ? 52 : 65,
  // The client loads product images through the API so canvases stay same-origin.
  images: { front: `/api/products/${e.id}/front/image`, back: `/api/products/${e.id}/back/image` },
  masks: { front: `/api/products/${e.id}/front/mask`, back: `/api/products/${e.id}/back/mask` },
}));

export const getProduct = (id: string) => products.find(p => p.id === id);

const cacheDir = path.join(config.paths.data, 'blanks');

/**
 * Local path of a product photo or mask: the original in work/media-source when present,
 * otherwise downloaded once from Cloudinary into data/blanks.
 */
export async function productAsset(id: string, view: View, kind: 'image' | 'mask'): Promise<string> {
  const entry = entries.find(e => e.id === id);
  if (!entry) throw new Error(`Unknown product ${id}`);
  const name = `${id}__${view}${kind === 'mask' ? '-mask' : ''}.png`;
  const original = path.join(config.paths.productSources, name);
  if (fs.existsSync(original)) return original;
  const cached = path.join(cacheDir, name);
  if (fs.existsSync(cached)) return cached;
  const url = (kind === 'mask' ? entry.masks : entry.images)[view];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${name} (${res.status})`);
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.writeFile(cached, Buffer.from(await res.arrayBuffer()));
  return cached;
}
