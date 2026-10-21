// Which reference photos a shoot sends to Codex. Its image tool takes at most 5 ("image_gen accepts at most 5 reference images"; the job then ends
// with no picture), while a shoot can have 7: the mockup render, a print file for each design on that side, the model's photo and one more of her,
// and the location. A garment with a front and a sleeve print, a model with her extra photo and a location photo is already 6.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** The most reference images Codex's image tool accepts in one request. */
export const MAX_REFS = 5;

export interface RefCounts {
  /** Print files on the side being shot. */
  prints: number;
  model: boolean;
  /** The extra photo of the model (face, full body or back). */
  modelExtra: boolean;
  location: boolean;
  /** A photo of the sunglasses the model wears. */
  accessory?: boolean;
}

export interface RefPlan {
  /** Send all the print files as one sheet (one slot) instead of one image each. */
  sheet: boolean;
  modelExtra: boolean;
  /** How many images this makes. */
  total: number;
}

/**
 * Fits a shoot into `max` images, keeping what matters most: the mockup render, the prints, the model and the location. When it is too many it gives up,
 * in this order: separate print files (they become one sheet, nothing is lost), then the model's extra photo. Four images always remain, so this fits 5.
 * (A style is words only, so its photo is never sent.)
 */
export function planRefs(c: RefCounts, max = MAX_REFS): RefPlan {
  const plan = { sheet: false, modelExtra: c.modelExtra };
  const total = () => 1 + (plan.sheet ? 1 : c.prints) + Number(c.model) + Number(plan.modelExtra) + Number(c.location) + Number(!!c.accessory);
  if (total() > max && c.prints > 1) plan.sheet = true;
  if (total() > max) plan.modelExtra = false;
  return { ...plan, total: total() };
}

const SHEET_GREY = '#8a8a8a';

/** Several print files as one picture, side by side on plain grey (two to a row), so they use a single reference slot. The files are transparent PNGs, trimmed to their art. */
export async function printSheet(files: string[], out: string, cell = 900, gap = 40): Promise<string> {
  const cols = Math.min(2, files.length), rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(files.map(async f => {
    const { data, info } = await sharp(f, { limitInputPixels: 80_000_000 }).resize(cell, cell, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
  }));
  await fs.mkdir(path.dirname(out), { recursive: true });
  await sharp({ create: { width: cols * (cell + gap) + gap, height: rows * (cell + gap) + gap, channels: 3, background: SHEET_GREY } })
    .composite(tiles.map((t, i) => ({
      input: t.data,
      left: gap + (i % cols) * (cell + gap) + Math.round((cell - t.w) / 2),
      top: gap + Math.floor(i / cols) * (cell + gap) + Math.round((cell - t.h) / 2),
    })))
    .removeAlpha().png().toFile(out);
  return out;
}
