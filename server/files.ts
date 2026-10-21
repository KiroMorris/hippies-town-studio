import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.ts';

/** Paths stored in the DB are relative to data/files; served at /files/<rel>. */
export const abs = (rel: string) => path.join(config.paths.files, rel);
export const fileUrl = (rel: string | null | undefined) => (rel ? `/files/${rel}` : null);

export interface StoredImage { file: string; thumb: string; width: number; height: number; transparent: boolean }

/**
 * Store an image under data/files/<kind>/<id>.png with a 480px webp thumbnail.
 * `trim` crops away fully transparent padding (used for print designs).
 */
export async function storeImage(kind: string, id: string, input: string | Buffer, opts: { trim?: boolean } = {}): Promise<StoredImage> {
  const file = `${kind}/${id}.png`;
  const thumb = `thumbs/${id}.webp`;
  await fs.mkdir(path.dirname(abs(file)), { recursive: true });
  await fs.mkdir(path.dirname(abs(thumb)), { recursive: true });

  let img = sharp(input, { limitInputPixels: 80_000_000 }).rotate();
  const meta = await img.metadata();
  const hasAlpha = !!meta.hasAlpha;
  const transparent = hasAlpha && !(await sharp(input).stats()).isOpaque;
  if (opts.trim && transparent) {
    const buf = await img.png().toBuffer();
    img = sharp(buf).trim({ threshold: 1 });
  }
  const info = await img.png().toFile(abs(file));
  await sharp(abs(file)).resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(abs(thumb));
  return { file, thumb, width: info.width, height: info.height, transparent };
}

export async function removeFiles(...rels: (string | null | undefined)[]) {
  await Promise.all(rels.filter(Boolean).map(r => fs.rm(abs(r!), { force: true })));
}

export async function isImage(file: string) {
  try { await sharp(file).metadata(); return true; } catch { return false; }
}

export interface ImageInspection { width: number; height: number; transparent: boolean; cornersTransparent: boolean; contentRatio: number }

/** Quality-gate stats: size, whether it has real transparency (all four corners clear) and the share of visible pixels. */
export async function inspectImage(file: string): Promise<ImageInspection> {
  const meta = await sharp(file, { limitInputPixels: 80_000_000 }).metadata();
  const { data, info } = await sharp(file, { limitInputPixels: 80_000_000 }).ensureAlpha().resize(256, 256, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info, a = (x: number, y: number) => data[(y * w + x) * 4 + 3];
  let visible = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) visible++;
  const cornersTransparent = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].every(([x, y]) => a(x, y) < 16);
  return { width: meta.width ?? w, height: meta.height ?? h, transparent: !!meta.hasAlpha && visible < w * h, cornersTransparent, contentRatio: visible / (w * h) };
}

/** The picture shape a photo is closest to, so an edit can keep it. */
export async function ratioOf(file: string): Promise<'4:5' | '9:16' | '1:1'> {
  const { width = 1, height = 1 } = await sharp(file).metadata();
  const r = width / height;
  return ([['4:5', 4 / 5], ['9:16', 9 / 16], ['1:1', 1]] as const).reduce((best, c) => (Math.abs(c[1] - r) < Math.abs(best[1] - r) ? c : best))[0];
}

/** Center-crop to a picture shape: 4:5 is the store's product-photo ratio (Shopify images are 1611x2000), 9:16 is Stories and Reels, 1:1 a square post. */
export async function cropToRatio(file: string, ratio: '4:5' | '9:16' | '1:1' = '4:5') {
  const { width = 0, height = 0 } = await sharp(file).metadata();
  const [rw, rh] = ratio.split(':').map(Number), r = rw / rh;
  const [w, h] = width / height > r ? [Math.round(height * r), height] : [width, Math.round(width / r)];
  if (w === width && h === height) return file;
  const out = file.replace(/\.(\w+)$/, `-${rw}x${rh}.png`);
  await sharp(file).extract({ left: Math.round((width - w) / 2), top: Math.round((height - h) / 2), width: w, height: h }).png().toFile(out);
  return out;
}
