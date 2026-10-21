// Touch gestures for phones. Pointer events only (no touch events), so iOS and Android behave the same, and a mouse never takes part:
// desktop keeps exactly the behaviour it has today.
import { useEffect, useRef, type RefObject } from 'react';
import { CANVAS, type Layer } from '../../shared/types.ts';

type Pt = { x: number; y: number };
const PHONE = '(max-width: 900px)';
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const grab = (el: Element, id: number) => { try { el.setPointerCapture(id); } catch { /* the pointer is already gone */ } };

/**
 * Photo viewer in a `Drawer` (give the returned ref to the `.viewer` element): pinch to zoom, drag to pan when zoomed, double-tap to zoom in and out,
 * and (when not zoomed) swipe left/right for the previous/next item. The browser keeps vertical scrolling (`touch-action: pan-y` in styles.css);
 * while zoomed the viewer switches to `touch-action: none` so one finger can pan.
 */
export function useViewerGestures(o: { onPrev?: () => void; onNext?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(o);
  cb.current = o;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pts = new Map<number, Pt>();
    let s = 1, tx = 0, ty = 0; // zoom and pan of the picture (translate, then scale about its centre)
    let g = { s0: 1, tx0: 0, ty0: 0, d0: 1, m0: { x: 0, y: 0 }, moved: false, swipe: false, t: 0 };
    let lastTap = { t: 0, x: 0, y: 0 };
    const img = () => el.querySelector<HTMLElement>('img');
    const paint = (anim = false) => {
      const im = img();
      if (!im) return;
      im.style.transition = anim ? 'transform 0.2s ease-out' : 'none';
      im.style.transform = s === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
      el.classList.toggle('zoomed', s > 1.01);
    };
    const reset = (anim = false) => { s = 1; tx = ty = 0; paint(anim); };
    const fit = () => { // keep the picture covering the viewer when zoomed in
      const im = img();
      if (!im) return;
      const lx = Math.max(0, (im.offsetWidth * s - el.clientWidth) / 2), ly = Math.max(0, (im.offsetHeight * s - el.clientHeight) / 2);
      tx = clamp(tx, -lx, lx); ty = clamp(ty, -ly, ly);
    };
    const centre = () => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const pair = () => { const [a, b] = [...pts.values()]; return [a, b] as const; };
    const rebase = (p?: Pt) => { const m = p ?? (pts.size ? [...pts.values()][0] : { x: 0, y: 0 }); g = { ...g, s0: s, tx0: tx, ty0: ty, m0: m }; };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !window.matchMedia(PHONE).matches || (e.target as Element).closest('button, a')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { g = { s0: s, tx0: tx, ty0: ty, d0: 1, m0: { x: e.clientX, y: e.clientY }, moved: false, swipe: false, t: Date.now() }; if (s > 1) grab(el, e.pointerId); }
      else if (pts.size === 2) { if (s === 1) { tx = ty = 0; paint(); } const [a, b] = pair(); g = { ...g, s0: s, tx0: tx, ty0: ty, d0: Math.max(10, dist(a, b)), m0: mid(a, b), moved: true, swipe: false }; for (const id of pts.keys()) grab(el, id); }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = centre();
      if (pts.size >= 2) { // pinch: the point between the fingers stays under them
        const [a, b] = pair(), m = mid(a, b);
        s = clamp(g.s0 * dist(a, b) / g.d0, 1, 6);
        tx = (m.x - c.x) - ((g.m0.x - c.x) - g.tx0) * (s / g.s0); ty = (m.y - c.y) - ((g.m0.y - c.y) - g.ty0) * (s / g.s0);
        fit(); paint(); return;
      }
      const p = pts.get(e.pointerId)!, dx = p.x - g.m0.x, dy = p.y - g.m0.y;
      if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
      if (s > 1) { tx = g.tx0 + dx; ty = g.ty0 + dy; fit(); paint(); return; }
      if (!g.swipe && Math.abs(dx) > 12 && Math.abs(dx) > 1.6 * Math.abs(dy)) { g.swipe = true; grab(el, e.pointerId); }
      if (g.swipe) { const has = dx > 0 ? cb.current.onPrev : cb.current.onNext; tx = dx * (has ? 0.9 : 0.25); paint(); }
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size > 0) { rebase(); return; } // one finger is still down after a pinch: carry on panning from where it is
      const cancelled = e.type === 'pointercancel';
      if (g.swipe) {
        const dx = tx, far = Math.abs(dx) > Math.max(56, el.clientWidth * 0.18);
        tx = 0; paint(true);
        if (!cancelled && far) (dx > 0 ? cb.current.onPrev : cb.current.onNext)?.();
        g.swipe = false; return;
      }
      if (s < 1.06) { reset(true); } else { fit(); paint(true); }
      if (cancelled || g.moved || Date.now() - g.t > 350) { lastTap.t = 0; return; }
      const now = Date.now(); // a quick tap: two in a row zoom in on that spot, or back out
      if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap.t = 0;
        if (s > 1) { reset(true); return; }
        const c = centre(); s = 2.5; tx = (e.clientX - c.x) * (1 - s); ty = (e.clientY - c.y) * (1 - s); fit(); paint(true);
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    };
    const loaded = () => reset(); // another picture (previous/next): back to fit
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('load', loaded, true);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('load', loaded, true);
      reset(); el.classList.remove('zoomed');
    };
  }, []);
  return ref;
}

/**
 * Mockup canvas: while a design is selected, two fingers resize (pinch), rotate (twist) and move it. One finger keeps using the canvas's own
 * pointer handlers (move, corner handle, rotate knob). The two-finger events never reach those handlers, and neither do the events of the
 * finger that is still down afterwards, so the design does not jump when you lift one finger. `cancel` ends the one-finger drag that the first
 * finger had already started.
 */
export function useLayerGestures(ref: RefObject<HTMLCanvasElement | null>, o: { get: (id?: string) => Layer | undefined; apply: (id: string, patch: Partial<Layer>) => void; cancel: () => void; select: (id: string | null) => void }) {
  const cb = useRef(o);
  cb.current = o;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pts = new Map<number, Pt>();
    let ses: { id: string; ids: [number, number]; l: Layer; d0: number; a0: number; m0: Pt } | null = null;
    let busy = false; // from the second finger until the last one lifts
    let first = ''; // the design that was selected when the first finger touched down (that touch may have deselected it)
    let pending: Partial<Layer> | null = null, raf = 0, timer = 0;
    const toCanvas = (p: Pt): Pt => { const r = el.getBoundingClientRect(); return { x: ((p.x - r.left) * CANVAS) / r.width, y: ((p.y - r.top) * CANVAS) / r.height }; };
    const angle = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
    const flush = () => {
      cancelAnimationFrame(raf); clearTimeout(timer); raf = timer = 0;
      if (ses && pending) cb.current.apply(ses.id, pending);
      pending = null;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (busy) { e.stopPropagation(); return; }
      if (pts.size === 1) first = cb.current.get()?.id ?? '';
      if (pts.size !== 2) return;
      const l = cb.current.get() ?? (first ? cb.current.get(first) : undefined); // a first finger on empty garment deselects: pinch the one that was selected
      if (!l) return;
      const ids = [...pts.keys()] as [number, number], A = toCanvas(pts.get(ids[0])!), B = toCanvas(pts.get(ids[1])!);
      const d0 = dist(A, B);
      if (d0 < 12) return; // fingers on top of each other: no usable distance or angle
      ses = { id: l.id, ids, l: { ...l }, d0, a0: angle(A, B), m0: mid(A, B) };
      busy = true;
      cb.current.cancel();
      cb.current.select(l.id);
      e.stopPropagation();
      for (const id of ids) grab(el, id);
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!busy) return;
      e.stopPropagation();
      if (!ses) return;
      const pa = pts.get(ses.ids[0]), pb = pts.get(ses.ids[1]);
      if (!pa || !pb) return;
      const A = toCanvas(pa), B = toCanvas(pb), m = mid(A, B), { l } = ses;
      let r = l.rotation + ((angle(A, B) - ses.a0) * 180) / Math.PI;
      r = (((r + 180) % 360) + 360) % 360 - 180;
      const near = Math.round(r / 90) * 90;
      if (Math.abs(r - near) < 2.5) r = near === 180 ? -180 : near; // upright and quarter turns click into place
      pending = { x: Math.round(l.x + m.x - ses.m0.x), y: Math.round(l.y + m.y - ses.m0.y), widthCm: clamp(+(l.widthCm * (dist(A, B) / ses.d0)).toFixed(1), 1, 60), rotation: Math.round(r) };
      if (!raf) { raf = requestAnimationFrame(flush); timer = window.setTimeout(flush, 40); } // the timer covers a page that is not being drawn
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (!busy) return;
      e.stopPropagation();
      if (ses && ses.ids.includes(e.pointerId)) { flush(); ses = null; }
      if (pts.size === 0) busy = false;
    };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf); clearTimeout(timer);
    };
  }, [ref]);
}
