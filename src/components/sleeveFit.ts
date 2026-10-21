// Moving a sleeve print between the front and the back photo of a garment. The sleeves hang a little differently in each photo
// (a few px up to ~30px sideways, and up to ~12 degrees on some garments), so a plain copy can overhang the sleeve and get cut off by the mask.
import { BODY_PX, CANVAS, type Layer } from '../../shared/types.ts';

/** The outermost garment pixel on each row of a product photo (1024px photo space); -1 where the row is empty. */
export interface Silhouette { left: Int16Array; right: Int16Array }

/** A print whose centre lies outside the width of the body sits on a sleeve. */
export const isSleevePrint = (l: Pick<Layer, 'x'>) => Math.abs(l.x - CANVAS / 2) > BODY_PX * 0.45;

/** Reads the outline from the RGBA pixels of a product mask, drawn at CANVAS × CANVAS (the garment is the opaque part). */
export function readSilhouette(px: ArrayLike<number>): Silhouette {
  const left = new Int16Array(CANVAS).fill(-1), right = new Int16Array(CANVAS).fill(-1);
  for (let y = 0; y < CANVAS; y++) {
    const row = y * CANVAS * 4 + 3;
    let x = 0;
    while (x < CANVAS && px[row + x * 4] <= 128) x++;
    if (x === CANVAS) continue;
    left[y] = x;
    x = CANVAS - 1;
    while (px[row + x * 4] <= 128) x--;
    right[y] = x;
  }
  return { left, right };
}

/** Browser only: the outline of a loaded mask image, or null when the browser will not let the pixels be read. */
export function silhouetteOf(img: CanvasImageSource): Silhouette | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = CANVAS;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, CANVAS, CANVAS);
    return readSilhouette(g.getImageData(0, 0, CANVAS, CANVAS).data);
  } catch { return null; }
}

interface Line { a: number; b: number } // x = a + b * y

/** One side's outer edge over some rows, as a straight line. Rows that stray from it (a hem, a fold) are dropped and the line is fitted again. */
function edgeLine(s: Silhouette, side: 'left' | 'right', y0: number, y1: number): Line | null {
  const col = side === 'left' ? s.left : s.right;
  let pts: [number, number][] = [];
  for (let y = Math.max(0, Math.ceil(y0)); y <= Math.min(CANVAS - 1, Math.floor(y1)); y += 2) if (col[y] >= 0) pts.push([y, col[y]]);
  const fit = (): Line | null => {
    if (pts.length < 10) return null;
    const n = pts.length, my = pts.reduce((t, p) => t + p[0], 0) / n, mx = pts.reduce((t, p) => t + p[1], 0) / n;
    let sxy = 0, syy = 0;
    for (const [y, x] of pts) { sxy += (y - my) * (x - mx); syy += (y - my) ** 2; }
    if (!syy) return null;
    const b = sxy / syy;
    return { a: mx - b * my, b };
  };
  const first = fit();
  if (!first) return null;
  pts = pts.filter(([y, x]) => Math.abs(x - (first.a + first.b * y)) <= 6);
  return fit();
}

const wrap = (deg: number) => (deg > 180 ? deg - 360 : deg < -180 ? deg + 360 : deg);

/**
 * The same sleeve print on the other photo: it keeps its distance from the sleeve's outer edge and turns with the sleeve's slope.
 * `size` is the print's size in photo pixels (`layerSize`). The print comes back unchanged (a plain copy) when either outline cannot be read well.
 */
export function followSleeve(l: Layer, size: { w: number; h: number }, from: Silhouette, to: Silhouette): Layer {
  const side = l.x < CANVAS / 2 ? 'left' : 'right';
  const r = (l.rotation * Math.PI) / 180;
  const reach = (Math.abs(size.h * Math.cos(r)) + Math.abs(size.w * Math.sin(r))) / 2; // how far the print extends above and below its centre
  const a = edgeLine(from, side, l.y - reach, l.y + reach), b = edgeLine(to, side, l.y - reach, l.y + reach);
  if (!a || !b) return l;
  const dx = b.a + b.b * l.y - (a.a + a.b * l.y);
  const turn = -((Math.atan(b.b) - Math.atan(a.b)) * 180) / Math.PI; // a print on a sleeve that leans out at the bottom is turned clockwise by the same angle
  if (Math.abs(dx) > 80 || Math.abs(turn) > 25) return l;
  return { ...l, x: Math.round(l.x + dx), rotation: wrap(Math.round((l.rotation + turn) * 10) / 10) };
}
