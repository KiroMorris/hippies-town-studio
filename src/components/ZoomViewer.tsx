// A closer look at one picture. Zoom with the wheel, a pinch, a double click or the buttons, drag to pan, and try it on a light, dark or
// checkered background to judge the edges of a transparent design. Arrows step through the list it came from.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useDialog } from './a11y.ts';
import { useSheetHistory } from './sheets.ts';

export const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

/** A stack of prints: "the whole set". */
export const SetIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
  </svg>
);

export const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </svg>
);

type Bg = 'checker' | 'light' | 'dark';
const BGS: [Bg, string][] = [['checker', 'Checker'], ['light', 'White'], ['dark', 'Black']];
let lastBg: Bg = 'checker'; // kept while the page is open, so a check on black stays black as you step through designs

interface Zoom { s: number; x: number; y: number } // scale (1 = fits the screen) and pan, from the centre of the stage
const FIT: Zoom = { s: 1, x: 0, y: 0 };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function ZoomViewer({ src, preview, width, height, title, meta, actions, onClose, onPrev, onNext }: {
  src: string; preview?: string; width: number; height: number; title: string; meta?: ReactNode; actions?: ReactNode;
  onClose: () => void; onPrev?: () => void; onNext?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useDialog(root, { onClose, onPrev, onNext });
  useSheetHistory(onClose);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [z, setZ] = useState<Zoom>(FIT);
  const [bg, setBg] = useState<Bg>(lastBg);
  const [sharp, setSharp] = useState(false);

  // The picture fits the stage (never blown up past its real size); zoom goes up to 4× its real pixels. Handlers read these through a ref, so they are never stale.
  const fit = box.w && box.h ? Math.min(box.w / width, box.h / height, 1) : 1;
  const imgW = width * fit, imgH = height * fit;
  const geo = useRef({ box, fit, imgW, imgH, maxS: 4 });
  geo.current = { box, fit, imgW, imgH, maxS: Math.max(4, 4 / fit) };
  const zRef = useRef(z);
  zRef.current = z;

  /** A zoom and pan the picture can have: it never leaves the stage, and sits in the middle on an axis where it is smaller than the stage. */
  const place = useCallback((s: number, x: number, y: number): Zoom => {
    const g = geo.current, sc = clamp(s, 1, g.maxS);
    const lx = Math.max(0, (g.imgW * sc - g.box.w) / 2), ly = Math.max(0, (g.imgH * sc - g.box.h) / 2);
    return { s: sc, x: clamp(x, -lx, lx), y: clamp(y, -ly, ly) };
  }, []);
  /** Zoom to `next(scale)` keeping the point (px, py), measured from the centre of the stage, where it is. */
  const zoomAt = useCallback((px: number, py: number, next: (s: number) => number) => setZ(cur => {
    const s = clamp(next(cur.s), 1, geo.current.maxS), k = s / cur.s;
    return place(s, px - (px - cur.x) * k, py - (py - cur.y) * k);
  }), [place]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setZ(z0 => place(z0.s, z0.x, z0.y)), [box, place]); // the window changed size: keep the picture on the stage

  // A new picture starts fitted, and shows the small version until the full one has loaded.
  useEffect(() => {
    setZ(FIT);
    if (!preview) { setSharp(true); return; }
    setSharp(false);
    let live = true;
    const im = new Image();
    im.onload = () => live && setSharp(true);
    im.src = src;
    return () => { live = false; };
  }, [src, preview]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, s => s * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.002))); // ctrl + wheel is a trackpad pinch
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef({ s: 1, x: 0, y: 0, d: 1, mx: 0, my: 0, moved: false });
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const centre = () => { const r = stage.current!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const rebase = () => { // a finger went down or up: carry on from the picture as it is now
    const list = [...pts.current.values()], g = gest.current;
    g.s = zRef.current.s; g.x = zRef.current.x; g.y = zRef.current.y;
    if (list.length >= 2) { g.d = Math.max(10, Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y)); g.mx = (list[0].x + list[1].x) / 2; g.my = (list[0].y + list[1].y) / 2; }
    else if (list.length === 1) { g.mx = list[0].x; g.my = list[0].y; }
  };
  const down = (e: ReactPointerEvent) => {
    stage.current!.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
    gest.current.moved = pts.current.size > 1;
  };
  const move = (e: ReactPointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gest.current, c = centre(), list = [...pts.current.values()];
    if (list.length >= 2) { // pinch: the point between the fingers stays under them
      const s = clamp(g.s * Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) / g.d, 1, geo.current.maxS), k = s / g.s;
      const mx = (list[0].x + list[1].x) / 2, my = (list[0].y + list[1].y) / 2;
      setZ(place(s, (mx - c.x) - ((g.mx - c.x) - g.x) * k, (my - c.y) - ((g.my - c.y) - g.y) * k));
      return;
    }
    const dx = e.clientX - g.mx, dy = e.clientY - g.my;
    if (!g.moved && Math.hypot(dx, dy) > 6) g.moved = true;
    if (g.s > 1) setZ(place(g.s, g.x + dx, g.y + dy));
  };
  const up = (e: ReactPointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    if (pts.current.size > 0) { rebase(); return; }
    if (e.type === 'pointercancel' || gest.current.moved) return;
    // A tap or click. Two quickly in a row zoom in on that spot (to at least the real pixels), or back out.
    const now = Date.now(), last = lastTap.current;
    if (now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 24) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      if (zRef.current.s > 1.05) setZ(FIT);
      else { const c = centre(); zoomAt(e.clientX - c.x, e.clientY - c.y, () => Math.max(2, 1 / geo.current.fit)); }
    } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
  };

  const zoomIn = () => zoomAt(0, 0, s => s * 1.5);
  const zoomOut = () => zoomAt(0, 0, s => s / 1.5);
  const actual = () => zoomAt(0, 0, () => 1 / geo.current.fit); // one picture pixel per screen pixel
  const key = (e: ReactKeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
    else if (e.key === '0') { e.preventDefault(); setZ(FIT); }
    else if (e.key === '1') { e.preventDefault(); actual(); }
  };
  const pick = (b: Bg) => { lastBg = b; setBg(b); };

  return (
    <div className="zoomer" ref={root} role="dialog" aria-modal="true" aria-label={`A closer look at ${title}`} onKeyDown={key}>
      <div className="zoomer-bar">
        <div className="zoomer-title"><b title={title}>{title}</b>{meta && <span className="zoomer-meta">{meta}</span>}</div>
        <div className="zoomer-tools">
          <div className="seg" role="group" aria-label="Background">
            {BGS.map(([b, label]) => <button key={b} className={bg === b ? 'on' : ''} aria-pressed={bg === b} onClick={() => pick(b)}>{label}</button>)}
          </div>
          <div className="zoomer-zoom" role="group" aria-label="Zoom">
            <button className="btn sm" onClick={zoomOut} disabled={z.s <= 1} aria-label="Zoom out" title="Zoom out (-)">−</button>
            <button className="btn sm" onClick={() => setZ(FIT)} title="Fit to the screen (0)">{Math.round(z.s * fit * 100)}%</button>
            <button className="btn sm" onClick={zoomIn} disabled={z.s >= geo.current.maxS - 0.01} aria-label="Zoom in" title="Zoom in (+)">+</button>
            <button className="btn sm" onClick={actual} title="Actual size: one picture pixel per screen pixel (1)">1:1</button>
          </div>
          {actions}
          <button className="btn sm" onClick={onClose} aria-label="Close" title="Close (Esc)">✕<span className="desk"> Close</span></button>
        </div>
      </div>
      <div ref={stage} className={`zoomer-stage bg-${bg}${z.s > 1.01 ? ' zoomed' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {box.w > 0 && (
          <img className="zoomer-img" src={sharp ? src : (preview ?? src)} alt="" draggable={false}
            style={{ width: imgW, height: imgH, marginLeft: -imgW / 2, marginTop: -imgH / 2, transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />
        )}
        {(onPrev || onNext) && z.s <= 1.01 && <>
          <button className="zoomer-nav prev" onPointerDown={e => e.stopPropagation()} onClick={onPrev} disabled={!onPrev} aria-label="Previous design" title="Previous (←)">‹</button>
          <button className="zoomer-nav next" onPointerDown={e => e.stopPropagation()} onClick={onNext} disabled={!onNext} aria-label="Next design" title="Next (→)">›</button>
        </>}
      </div>
    </div>
  );
}
