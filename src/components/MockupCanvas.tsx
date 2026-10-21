// Interactive mockup preview. Rendering math mirrors server/render.ts (minus fabric shading, which the saved render adds).
import { useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS, layerSize, type Layer } from '../../shared/types.ts';
import { CanvasGuides, type CanvasRect } from './CanvasGuides.tsx';
import { useLayerGestures } from './gestures.ts';
import { boxOf, corners, polysOverlap, rectCorners, shiftBox, snapBox, snapTargets, unionBox, type Box, type Guides } from './layout.ts';

const cache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string) {
  if (!cache.has(src)) cache.set(src, new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => { cache.delete(src); reject(new Error(`Could not load ${src}`)); };
    im.src = src;
  }));
  return cache.get(src)!;
}

type Pt = { x: number; y: number };
type Drag =
  | { type: 'resize' | 'rotate'; id: string; start: Pt; layer: Layer; dist: number; angle: number }
  // Several designs move together. `narrow`: a plain click on one of them (no drag) selects just that one on release.
  | { type: 'move'; start: Pt; ids: string[]; from: Record<string, Pt>; box: Box; narrow: string | null }
  | { type: 'marquee'; start: Pt; add: boolean; base: string[] };
const HANDLE = 18, ROT_OFFSET = 38;
const NO_SNAP = { v: null as number | null, h: null as number | null };
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export function MockupCanvas({ photo, mask, layers, designUrls, designAspect, bodyWidth, selected, onSelect, onChange, onMove, onDropDesign, centerLine, guides, onGuides, snap }: {
  photo: string; mask: string; layers: Layer[]; designUrls: Record<string, string>; designAspect: Record<string, number>;
  bodyWidth: number; selected: string[]; onSelect: (ids: string[]) => void;
  onChange: (id: string, patch: Partial<Layer>) => void;
  /** Moves several designs at once (a drag, the arrow keys): their new centres. */
  onMove: (to: Record<string, Pt>) => void;
  onDropDesign: (designId: string, x: number, y: number) => void;
  centerLine: boolean; guides: Guides; onGuides: (g: Guides) => void; snap: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [imgs, setImgs] = useState<{ photo?: HTMLImageElement; mask?: HTMLImageElement; designs: Record<string, HTMLImageElement> }>({ designs: {} });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropping, setDropping] = useState(false);
  const [snapLines, setSnapLines] = useState(NO_SNAP); // the lines a drag is snapped to right now
  const [marquee, setMarquee] = useState<Box | null>(null); // the box being dragged to select several

  // Canvas units per CSS pixel. On a phone the preview is shown at about a third of its 1024px size, so the 18-unit handles would be
  // under 6px wide: below ~430px of display width they are sized in screen pixels instead (desktop keeps the original sizes).
  // The canvas's place in its wrapper is kept too: the rulers and guides are laid over it.
  const [cs, setCs] = useState(0);
  const [rect, setRect] = useState<CanvasRect>({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      setCs(el.clientWidth ? CANVAS / el.clientWidth : 0);
      setRect(r => (r.left === el.offsetLeft && r.top === el.offsetTop && r.width === el.clientWidth && r.height === el.clientHeight ? r : { left: el.offsetLeft, top: el.offsetTop, width: el.clientWidth, height: el.clientHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement); // centred in it: its width moves the canvas without resizing it
    return () => ro.disconnect();
  }, []);
  const small = cs > 2.4, px = (n: number) => n * (cs || 1);
  const handle = small ? px(16) : HANDLE, rotOff = small ? px(30) : ROT_OFFSET, knob = small ? px(9) : 11, line = small ? px(1.5) : 2;

  useEffect(() => {
    let live = true;
    Promise.all([loadImage(photo), loadImage(mask)]).then(([p, m]) => live && setImgs(s => ({ ...s, photo: p, mask: m })));
    return () => { live = false; };
  }, [photo, mask]);

  useEffect(() => {
    let live = true;
    const missing = Object.entries(designUrls).filter(([id]) => !imgs.designs[id]);
    if (missing.length) Promise.all(missing.map(([id, url]) => loadImage(url).then(im => [id, im] as const)))
      .then(list => live && setImgs(s => ({ ...s, designs: { ...s.designs, ...Object.fromEntries(list) } })));
    return () => { live = false; };
  }, [designUrls, imgs.designs]);

  const size = (l: Layer) => layerSize(l.widthCm, bodyWidth, designAspect[l.designId] ?? 1);
  const one = selected.length === 1 ? layers.find(l => l.id === selected[0]) : undefined; // handles are for a single design

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    if (!imgs.photo || !imgs.mask) return;
    ctx.drawImage(imgs.photo, 0, 0, CANVAS, CANVAS);
    const overlay = document.createElement('canvas');
    overlay.width = overlay.height = CANVAS;
    const oc = overlay.getContext('2d')!;
    for (const l of layers) {
      const im = imgs.designs[l.designId];
      if (!im) continue;
      const { w, h } = size(l);
      oc.save(); oc.translate(l.x, l.y); oc.rotate((l.rotation * Math.PI) / 180); oc.scale(l.flip ? -1 : 1, 1);
      oc.globalAlpha = l.opacity / 100; oc.drawImage(im, -w / 2, -h / 2, w, h); oc.restore();
    }
    oc.globalCompositeOperation = 'destination-in';
    oc.drawImage(imgs.mask, 0, 0, CANVAS, CANVAS);
    ctx.drawImage(overlay, 0, 0);
    if (centerLine) {
      ctx.save(); ctx.strokeStyle = '#7c8a82'; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.moveTo(512, 120); ctx.lineTo(512, 900); ctx.stroke(); ctx.restore();
    }
    const sel = layers.filter(l => selected.includes(l.id));
    for (const s of sel) {
      const { w, h } = size(s);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate((s.rotation * Math.PI) / 180);
      ctx.strokeStyle = '#659b17'; ctx.lineWidth = line; ctx.strokeRect(-w / 2, -h / 2, w, h);
      if (s === one) {
        ctx.fillStyle = '#e3b95c'; ctx.fillRect(w / 2 - handle / 2, h / 2 - handle / 2, handle, handle); ctx.strokeRect(w / 2 - handle / 2, h / 2 - handle / 2, handle, handle);
        ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 - rotOff); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -h / 2 - rotOff, knob, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    if (sel.length > 1) { // one dashed box around the whole selection: that is what aligning goes by
      const u = unionBox(sel.map(l => { const { w, h } = size(l); return boxOf(l, w, h); }));
      ctx.save(); ctx.strokeStyle = '#659b17'; ctx.lineWidth = line * 0.75; ctx.setLineDash([px(6), px(4)]); ctx.strokeRect(u.l, u.t, u.r - u.l, u.b - u.t); ctx.restore();
    }
    if (snapLines.v !== null || snapLines.h !== null) {
      ctx.save(); ctx.strokeStyle = '#ff2d95'; ctx.lineWidth = line * 0.6; ctx.beginPath();
      if (snapLines.v !== null) { ctx.moveTo(snapLines.v, 0); ctx.lineTo(snapLines.v, CANVAS); }
      if (snapLines.h !== null) { ctx.moveTo(0, snapLines.h); ctx.lineTo(CANVAS, snapLines.h); }
      ctx.stroke(); ctx.restore();
    }
    if (marquee) {
      ctx.save(); ctx.fillStyle = '#659b1722'; ctx.strokeStyle = '#659b17'; ctx.lineWidth = line * 0.75;
      ctx.fillRect(marquee.l, marquee.t, marquee.r - marquee.l, marquee.b - marquee.t); ctx.strokeRect(marquee.l, marquee.t, marquee.r - marquee.l, marquee.b - marquee.t); ctx.restore();
    }
  }, [imgs, layers, selected, centerLine, bodyWidth, designAspect, cs, snapLines, marquee]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * CANVAS) / r.width, y: ((e.clientY - r.top) * CANVAS) / r.height };
  };
  const local = (p: Pt, l: Layer) => {
    const a = (-l.rotation * Math.PI) / 180, dx = p.x - l.x, dy = p.y - l.y;
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
  };

  const moved = useRef(false); // has this press turned into a drag yet?
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary) return; // a second finger belongs to the two-finger gesture below
    const p = point(e);
    const capture = () => { try { ref.current!.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ } };
    moved.current = false;
    if (one) {
      const q = local(p, one), { w, h } = size(one);
      // A finger (touch or pen) gets a ~22px grab radius; the resize zone never takes more than half of a small design so it can still be dragged.
      const mouse = e.pointerType === 'mouse';
      const rotR = Math.max(22, knob * 1.4, mouse ? 0 : px(24)), sizeR = Math.max(20, handle * 0.75, mouse ? 0 : Math.min(px(22), Math.min(w, h) * 0.5));
      const begin = (type: 'resize' | 'rotate') => {
        setDrag({ type, id: one.id, start: p, layer: { ...one }, dist: Math.max(1, Math.hypot(p.x - one.x, p.y - one.y)), angle: Math.atan2(p.y - one.y, p.x - one.x) });
        capture();
      };
      if (Math.hypot(q.x, q.y + h / 2 + rotOff) < rotR) return begin('rotate');
      if (Math.abs(q.x - w / 2) < sizeR && Math.abs(q.y - h / 2) < sizeR) return begin('resize');
    }
    const hit = [...layers].reverse().find(l => { const q = local(p, l), { w, h } = size(l); return Math.abs(q.x) <= w / 2 && Math.abs(q.y) <= h / 2; });
    const multi = e.shiftKey || e.metaKey || e.ctrlKey; // add to or take from the selection
    if (hit) {
      let ids = selected, narrow: string | null = null;
      if (multi) { ids = selected.includes(hit.id) ? selected.filter(i => i !== hit.id) : [...selected, hit.id]; onSelect(ids); }
      else if (!selected.includes(hit.id)) { ids = [hit.id]; onSelect(ids); }
      else if (selected.length > 1) narrow = hit.id; // keep them all for a drag; a click without one narrows to this design
      if (ids.includes(hit.id)) {
        const group = layers.filter(l => ids.includes(l.id));
        setDrag({ type: 'move', start: p, ids: group.map(l => l.id), from: Object.fromEntries(group.map(l => [l.id, { x: l.x, y: l.y }])), box: unionBox(group.map(l => { const s = size(l); return boxOf(l, s.w, s.h); })), narrow });
        capture();
      }
    } else { // empty garment: a click deselects, a drag draws a box around the designs to select (Shift adds to the selection)
      if (!multi && selected.length) onSelect([]);
      setDrag({ type: 'marquee', start: p, add: multi, base: multi ? selected : [] });
      capture();
    }
    ref.current!.focus();
  };

  // Pointermove is coalesced to one update per animation frame; the latest props are read through refs.
  const pending = useRef<{ x: number; y: number; shift: number; alt: boolean } | null>(null);
  const raf = useRef(0);
  const latest = useRef({ drag, onChange, onMove, onSelect, layers, guides, centerLine, snap, cs, bodyWidth, designAspect, selected });
  latest.current = { drag, onChange, onMove, onSelect, layers, guides, centerLine, snap, cs, bodyWidth, designAspect, selected };
  const flush = useCallback(() => {
    raf.current = 0;
    const ev = pending.current, c = latest.current, d = c.drag;
    pending.current = null;
    if (!ev || !d) return;
    const p = ev, sizeOf = (l: Layer) => layerSize(l.widthCm, c.bodyWidth, c.designAspect[l.designId] ?? 1);
    if (d.type === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (!moved.current) { if (Math.hypot(dx, dy) < 3 * (c.cs || 1)) return; moved.current = true; } // the wobble of a click is not a drag
      let lines = NO_SNAP;
      if (c.snap && !ev.alt) { // snap the whole group's edges and middle to the guides, the centre line and the other designs (Alt held: free)
        const others = c.layers.filter(l => !d.ids.includes(l.id)).map(l => { const s = sizeOf(l); return boxOf(l, s.w, s.h); });
        const s = snapBox(shiftBox(d.box, dx, dy), snapTargets(c.guides, c.centerLine, others), 6 * (c.cs || 1));
        dx += s.dx; dy += s.dy;
        if (s.v || s.h) lines = { v: s.v?.at ?? null, h: s.h?.at ?? null };
      }
      setSnapLines(prev => (prev.v === lines.v && prev.h === lines.h ? prev : lines));
      c.onMove(Object.fromEntries(d.ids.map(id => [id, { x: Math.round(d.from[id].x + dx), y: Math.round(d.from[id].y + dy) }])));
    } else if (d.type === 'marquee') {
      if (!moved.current) { if (Math.hypot(p.x - d.start.x, p.y - d.start.y) < 4 * (c.cs || 1)) return; moved.current = true; } // a click that wobbles does not select what is next to it
      const r: Box = { l: Math.min(d.start.x, p.x), t: Math.min(d.start.y, p.y), r: Math.max(d.start.x, p.x), b: Math.max(d.start.y, p.y) };
      setMarquee(r);
      const box = rectCorners(r);
      const hits = c.layers.filter(l => { const s = sizeOf(l); return polysOverlap(box, corners(l, s.w, s.h)); }).map(l => l.id);
      const ids = d.add ? [...c.layers.filter(l => d.base.includes(l.id) || hits.includes(l.id)).map(l => l.id)] : hits;
      if (!sameIds(ids, c.selected)) c.onSelect(ids);
    } else {
      const l = d.layer;
      if (d.type === 'resize') c.onChange(d.id, { widthCm: Math.min(60, Math.max(1, +(l.widthCm * Math.hypot(p.x - l.x, p.y - l.y) / d.dist).toFixed(1))) });
      else {
        let r = l.rotation + ((Math.atan2(p.y - l.y, p.x - l.x) - d.angle) * 180) / Math.PI;
        r = (((r + 180) % 360) + 360) % 360 - 180;
        if (ev.shift) r = Math.round(r / 15) * 15;
        c.onChange(d.id, { rotation: Math.round(r) });
      }
    }
  }, []);
  const endDrag = () => {
    if (raf.current) { cancelAnimationFrame(raf.current); flush(); }
    const d = latest.current.drag;
    if (d?.type === 'move' && !moved.current && d.narrow) onSelect([d.narrow]);
    pending.current = null; setDrag(null); setSnapLines(NO_SNAP); setMarquee(null);
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  // Phones: two fingers pinch (size), twist (rotation) and drag (position) the selected design. One finger keeps using the handlers here.
  useLayerGestures(ref, {
    get: id => layers.find(l => l.id === (id ?? (selected.length === 1 ? selected[0] : undefined))), apply: onChange, select: id => onSelect(id ? [id] : []),
    cancel: () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; pending.current = null; setDrag(null); setSnapLines(NO_SNAP); setMarquee(null); },
  });

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag || !e.isPrimary) return;
    pending.current = { ...point(e), shift: e.shiftKey ? 1 : 0, alt: e.altKey };
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const sel = layers.filter(l => selected.includes(l.id));
    if (!sel.length || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0, dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
    onMove(Object.fromEntries(sel.map(l => [l.id, { x: l.x + dx, y: l.y + dy }])));
  };

  return (
    <div className="canvas-wrap">
      <canvas
        ref={ref} width={CANVAS} height={CANVAS} tabIndex={0} className={dropping ? 'drop-target' : ''}
        aria-label="Mockup editor. Drag designs from the left onto the garment. Drag to move, corner handle to resize, circle to rotate, arrow keys to nudge. Shift-click or drag a box to select several."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={e => e.isPrimary && endDrag()} onPointerCancel={e => e.isPrimary && endDrag()} onKeyDown={onKeyDown}
        onDragOver={e => { if (e.dataTransfer.types.includes('application/x-design')) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={() => setDropping(false)}
        onDrop={e => { const id = e.dataTransfer.getData('application/x-design'); setDropping(false); if (!id) return; e.preventDefault(); const p = point(e); onDropDesign(id, p.x, p.y); }}
      />
      {rect.width > 0 && <CanvasGuides rect={rect} guides={guides} onGuides={onGuides} bodyWidth={bodyWidth} />}
    </div>
  );
}
