// Geometry for the mockup editor: where a design sits on the garment (a turned rectangle), snapping a drag to guides and to other designs,
// aligning several designs, and the drag-a-box selection. Everything is in the 1024px photo space of the canvas.
import { BODY_PX, CANVAS, type Layer } from '../../shared/types.ts';

export interface Box { l: number; t: number; r: number; b: number }
export type Pt = [number, number];
type Pose = Pick<Layer, 'x' | 'y' | 'rotation'>;

/** Guide lines dragged out of the rulers: the x of each vertical one and the y of each horizontal one. */
export interface Guides { v: number[]; h: number[] }
export const NO_GUIDES: Guides = { v: [], h: [] };

/** The corners of a design: its w × h rectangle turned about its centre (mirroring does not change them). */
export function corners(p: Pose, w: number, h: number): Pt[] {
  const a = (p.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Pt[]).map(([x, y]) => [p.x + x * c - y * s, p.y + x * s + y * c] as Pt);
}
/** The smallest upright box around the turned rectangle. */
export function boxOf(p: Pose, w: number, h: number): Box {
  const cs = corners(p, w, h), xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
  return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
}
export const unionBox = (boxes: Box[]): Box => ({ l: Math.min(...boxes.map(b => b.l)), t: Math.min(...boxes.map(b => b.t)), r: Math.max(...boxes.map(b => b.r)), b: Math.max(...boxes.map(b => b.b)) });
export const shiftBox = (b: Box, dx: number, dy: number): Box => ({ l: b.l + dx, t: b.t + dy, r: b.r + dx, b: b.b + dy });
export const rectCorners = (r: Box): Pt[] => [[r.l, r.t], [r.r, r.t], [r.r, r.b], [r.l, r.b]];

// ---------- snapping ----------
/** A line a drag can snap to. `guide` ones are the user's guides (and the centre line); the others are the edges and middles of other designs. */
export interface Target { at: number; guide: boolean }
export interface Targets { v: Target[]; h: Target[] }
export interface Snap { dx: number; dy: number; v: Target | null; h: Target | null }

export function snapTargets(guides: Guides, centerLine: boolean, others: Box[]): Targets {
  const v: Target[] = guides.v.map(at => ({ at, guide: true })), h: Target[] = guides.h.map(at => ({ at, guide: true }));
  if (centerLine) v.push({ at: CANVAS / 2, guide: true });
  for (const b of others) {
    v.push({ at: b.l, guide: false }, { at: (b.l + b.r) / 2, guide: false }, { at: b.r, guide: false });
    h.push({ at: b.t, guide: false }, { at: (b.t + b.b) / 2, guide: false }, { at: b.b, guide: false });
  }
  return { v, h };
}

/** How far to nudge a box dragged to `box` so its left / middle / right (and top / middle / bottom) land on a target within `thr`. The closest wins; a guide beats a design when they tie. */
export function snapBox(box: Box, targets: Targets, thr: number): Snap {
  const pick = (own: number[], to: Target[]) => {
    let best: { d: number; to: Target } | null = null;
    for (const c of own) for (const t of to) {
      const d = t.at - c, ad = Math.abs(d);
      if (ad > thr) continue;
      if (!best || ad < Math.abs(best.d) - 1e-9 || (Math.abs(ad - Math.abs(best.d)) <= 1e-9 && t.guide && !best.to.guide)) best = { d, to: t };
    }
    return best;
  };
  const x = pick([box.l, (box.l + box.r) / 2, box.r], targets.v), y = pick([box.t, (box.t + box.b) / 2, box.b], targets.h);
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, v: x?.to ?? null, h: y?.to ?? null };
}

// ---------- aligning several designs ----------
export type AlignKind = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export interface Item { id: string; box: Box }

/** How far each design moves to line up with the edges (or the middle) of the whole selection. */
export function alignShifts(items: Item[], kind: AlignKind): Record<string, Pt> {
  const u = unionBox(items.map(i => i.box)), out: Record<string, Pt> = {};
  for (const { id, box } of items) {
    out[id] = kind === 'left' ? [u.l - box.l, 0] : kind === 'right' ? [u.r - box.r, 0] : kind === 'center' ? [(u.l + u.r) / 2 - (box.l + box.r) / 2, 0]
      : kind === 'top' ? [0, u.t - box.t] : kind === 'bottom' ? [0, u.b - box.b] : [0, (u.t + u.b) / 2 - (box.t + box.b) / 2];
  }
  return out;
}
/** Spreads three or more designs so the gaps between them are equal. The two outermost stay where they are. */
export function distributeShifts(items: Item[], axis: 'x' | 'y'): Record<string, Pt> {
  const lo = (b: Box) => (axis === 'x' ? b.l : b.t), hi = (b: Box) => (axis === 'x' ? b.r : b.b);
  const sorted = [...items].sort((a, b) => lo(a.box) + hi(a.box) - (lo(b.box) + hi(b.box)));
  const out: Record<string, Pt> = Object.fromEntries(items.map(i => [i.id, [0, 0] as Pt]));
  if (sorted.length < 3) return out;
  const first = lo(sorted[0].box), last = hi(sorted[sorted.length - 1].box);
  const gap = (last - first - sorted.reduce((t, i) => t + hi(i.box) - lo(i.box), 0)) / (sorted.length - 1);
  let at = first;
  for (const { id, box } of sorted) {
    const d = at - lo(box);
    out[id] = axis === 'x' ? [d, 0] : [0, d];
    at += hi(box) - lo(box) + gap;
  }
  return out;
}

// ---------- selecting with a dragged box ----------
/** Do two convex shapes overlap? (Separating axis test, so a turned design is only hit where it really is.) */
export function polysOverlap(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = p[1] - q[1], ay = q[0] - p[0]; // the edge's normal
      const range = (s: Pt[]) => { const d = s.map(([x, y]) => x * ax + y * ay); return [Math.min(...d), Math.max(...d)]; };
      const [a0, a1] = range(a), [b0, b1] = range(b);
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

// ---------- rulers and guides ----------
export const cmPerPx = (bodyWidth: number) => bodyWidth / BODY_PX;
/** Rulers read in cm of real garment: across from the centre line, down from the top of the photo. */
export const cmAcross = (x: number, bodyWidth: number) => (x - CANVAS / 2) * cmPerPx(bodyWidth);
export const cmDown = (y: number, bodyWidth: number) => y * cmPerPx(bodyWidth);
export const fmtCm = (n: number) => { const r = Math.round(n * 10) / 10; return `${r === 0 ? 0 : r} cm`; };

/** Saved guides, keeping only real positions on the canvas (the file is the browser's, so it is checked). */
export function cleanGuides(raw: unknown): Guides {
  const list = (v: unknown) => (Array.isArray(v) ? v : []).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= CANVAS).slice(0, 30);
  const r = (raw ?? {}) as Record<string, unknown>;
  return { v: list(r.v), h: list(r.h) };
}
