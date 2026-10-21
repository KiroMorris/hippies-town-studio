// Server-side mockup rendering with sharp. Mirrors the client canvas preview (src/components/MockupCanvas.tsx).
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CANVAS, layerSize, type Layer, type View } from '../shared/types.ts';
import { productAsset } from './catalog.ts';
import { abs } from './files.ts';
import { designRow } from './models.ts';

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

async function renderLayer(layer: Layer, bodyWidth: number, scale: number) {
  const design = designRow(layer.designId);
  if (!design) return null;
  const src = abs(String(design.file));
  const { w, h } = layerSize(layer.widthCm, bodyWidth, Number(design.height) / Number(design.width));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  let img = sharp(src).ensureAlpha().resize(width, height, { fit: 'fill' });
  if (layer.flip) img = img.flop();
  if (layer.opacity < 100) {
    img = sharp(await img.png().toBuffer()).composite([{
      input: Buffer.from([255, 255, 255, Math.round((255 * layer.opacity) / 100)]),
      raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in',
    }]);
  }
  if (layer.rotation) img = sharp(await img.png().toBuffer()).rotate(layer.rotation, { background: CLEAR });
  const buf = await img.png().toBuffer();
  const meta = await sharp(buf).metadata();
  return { input: buf, left: Math.round(layer.x * scale - meta.width! / 2), top: Math.round(layer.y * scale - meta.height! / 2) };
}

/** Render one view of a mockup to PNG at the product photo's native resolution. */
export async function renderView(productId: string, view: View, layers: Layer[], bodyWidth: number, outFile: string) {
  const photo = await productAsset(productId, view, 'image');
  const mask = await productAsset(productId, view, 'mask');
  const meta = await sharp(photo).metadata();
  const W = meta.width!, H = meta.height!, scale = W / CANVAS;

  // Layers are composited on a padded canvas so artwork may hang off the edges, then cropped back.
  const pad = W;
  const parts = (await Promise.all(layers.map(l => renderLayer(l, bodyWidth, scale)))).filter(Boolean) as { input: Buffer; left: number; top: number }[];
  const padded = await sharp({ create: { width: W + 2 * pad, height: H + 2 * pad, channels: 4, background: CLEAR } })
    .composite(parts.map(p => ({ ...p, left: p.left + pad, top: p.top + pad })))
    .png().toBuffer();
  const maskBuf = await sharp(mask).resize(W, H).ensureAlpha().png().toBuffer();
  const print = await sharp(padded).extract({ left: pad, top: pad, width: W, height: H })
    .composite([{ input: maskBuf, blend: 'dest-in' }]).raw().toBuffer();
  await applyFabricShading(photo, print, W, H);

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await sharp(photo).ensureAlpha()
    .composite([{ input: print, raw: { width: W, height: H, channels: 4 } }])
    .flatten({ background: '#ffffff' }).png().toFile(outFile);
}

const SHADING_STRENGTH = 0.85;

/**
 * Make the print follow the fabric: multiply it by the photo's local light/shadow
 * (luminance divided by its heavily blurred self), so folds darken it and highlights lift it
 * regardless of the garment's color. Edits the RGBA buffer in place.
 */
async function applyFabricShading(photo: string, rgba: Buffer, W: number, H: number) {
  const lum = await sharp(photo).resize(W, H).greyscale().raw().toBuffer();
  const base = await sharp(photo).resize(W, H).greyscale().blur(24).raw().toBuffer();
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    if (!rgba[p + 3]) continue;
    const ratio = Math.min(1.35, Math.max(0.45, (lum[i] + 4) / (base[i] + 4)));
    const f = 1 + (ratio - 1) * SHADING_STRENGTH;
    rgba[p] = Math.min(255, rgba[p] * f);
    rgba[p + 1] = Math.min(255, rgba[p + 1] * f);
    rgba[p + 2] = Math.min(255, rgba[p + 2] * f);
  }
}
