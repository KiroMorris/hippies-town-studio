import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import sharp from 'sharp';
import { config } from './config.ts';

/**
 * On-demand small versions (`?w=480`) of the big PNG renders and garment photos, cached as webp in data/cache/.
 * A phone grid then loads ~20 KB per card instead of 1-2 MB. Anything that goes wrong falls back to the original file.
 */
const SIZES = [240, 480, 720, 1080];
const CACHE = path.join(config.paths.data, 'cache');
const making = new Map<string, Promise<void>>();

/** The size bucket asked for in `?w=` (smallest allowed size that is at least that wide), or null to serve the original. */
export const widthOf = (q: unknown) => { const w = Number(q); return Number.isFinite(w) && w > 0 ? SIZES.find(s => s >= w) ?? null : null; };

/** A webp of `src` at most `w` px on its long side, made once and cached by the source's path, size and modification time. */
export async function resized(src: string, w: number) {
  const st = await fs.stat(src);
  const out = path.join(CACHE, `${createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}|${w}`).digest('hex')}.webp`);
  if (await fs.stat(out).then(() => false, () => true)) {
    if (!making.has(out)) making.set(out, (async () => {
      await fs.mkdir(CACHE, { recursive: true });
      const tmp = `${out}.${process.pid}.tmp`;
      await sharp(src).resize(w, w, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
      await fs.rename(tmp, out);
    })().finally(() => making.delete(out)));
    await making.get(out);
  }
  return out;
}

/** `/files/...?w=480`: serves the resized webp for an image under `root`; everything else falls through to the normal static handler. */
export const smallFiles = (dir: string) => {
  const root = path.resolve(dir);
  return async (req: Request, res: Response, next: NextFunction) => {
    const w = widthOf(req.query.w);
    if (!w || (req.method !== 'GET' && req.method !== 'HEAD') || !/\.(png|jpe?g|webp)$/i.test(req.path)) return next();
    let small: string;
    try {
      const file = path.resolve(root, `.${decodeURIComponent(req.path)}`);
      if (!file.startsWith(root + path.sep) || !(await fs.stat(file)).isFile()) return next();
      small = await resized(file, w);
    } catch { return next(); }
    res.set('Cache-Control', 'public, max-age=3600').sendFile(small);
  };
};
