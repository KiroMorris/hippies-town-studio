// Rulers along the top and left of the canvas and the guide lines dragged out of them, like Photoshop: drag from a ruler to make a guide,
// drag a guide to move it, drag it back onto a ruler (or double-click it) to remove it. Designs snap to guides while you move them.
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { BODY_PX, CANVAS } from '../../shared/types.ts';
import { cmAcross, cmDown, fmtCm, type Guides } from './layout.ts';

/** Where the canvas sits inside its wrapper, in CSS px. */
export interface CanvasRect { left: number; top: number; width: number; height: number }

const RULER = 20;
type Axis = 'v' | 'h'; // v: a vertical line (its position is an x), h: a horizontal one (a y)
interface Drag { axis: Axis; index: number | null; pos: number; inside: boolean } // index: the guide being moved, null for a new one

/** The ruler's scale in cm of real garment: across from the centre line (x), down from the top of the photo (y). */
function Ticks({ axis, length, k, ppc }: { axis: 'x' | 'y'; length: number; k: number; ppc: number }) {
  const cm = ppc * k; // CSS px per cm
  const origin = axis === 'x' ? (CANVAS / 2) * k : 0;
  const every = cm >= 4 ? 1 : 5; // very small previews: only the longer ticks
  let d = '';
  const labels: ReactElement[] = [];
  for (let n = Math.ceil(-origin / cm); n <= Math.floor((length - origin) / cm); n++) {
    if (n % every) continue;
    const at = origin + n * cm, len = n % 10 === 0 ? RULER - 5 : n % 5 === 0 ? 9 : 5;
    d += axis === 'x' ? `M${at.toFixed(1)} ${RULER}v${-len}` : `M${RULER} ${at.toFixed(1)}h${-len}`;
    if (n % 10 === 0) labels.push(<text key={n} x={axis === 'x' ? at + 2 : 2} y={axis === 'x' ? 8 : at + 9}>{n}</text>);
  }
  return (
    <svg width={axis === 'x' ? length : RULER} height={axis === 'x' ? RULER : length} aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1" fill="none" /><g fill="currentColor" fontSize="9">{labels}</g>
    </svg>
  );
}

export function CanvasGuides({ rect, guides, onGuides, bodyWidth }: { rect: CanvasRect; guides: Guides; onGuides: (g: Guides) => void; bodyWidth: number }) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const k = rect.width / CANVAS || 1; // CSS px per canvas unit

  /** Where the pointer is on this axis, in canvas units: snapped to the centre line when close, and whether it is over the canvas at all. */
  const place = (e: ReactPointerEvent, axis: Axis) => {
    const r = layer.current!.getBoundingClientRect();
    const raw = axis === 'v' ? ((e.clientX - r.left) * CANVAS) / r.width : ((e.clientY - r.top) * CANVAS) / r.height;
    let pos = Math.round(Math.min(CANVAS, Math.max(0, raw)) * 10) / 10;
    if (axis === 'v' && Math.abs(raw - CANVAS / 2) * k < 6) pos = CANVAS / 2;
    return { pos, inside: raw >= 0 && raw <= CANVAS };
  };
  const start = (axis: Axis, index: number | null) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ axis, index, ...place(e, axis) });
  };
  const move = (e: ReactPointerEvent) => { if (drag) setDrag({ ...drag, ...place(e, drag.axis) }); };
  const set = (axis: Axis, list: number[]) => onGuides(axis === 'v' ? { ...guides, v: list } : { ...guides, h: list });
  const end = () => {
    if (!drag) return;
    const { axis, index, pos, inside } = drag, list = axis === 'v' ? guides.v : guides.h;
    setDrag(null);
    if (index === null) { if (inside) set(axis, [...list, pos]); }
    else set(axis, inside ? list.map((g, i) => (i === index ? pos : g)) : list.filter((_, i) => i !== index)); // dropped on a ruler: gone
  };
  const remove = (axis: Axis, index: number) => set(axis, (axis === 'v' ? guides.v : guides.h).filter((_, i) => i !== index));

  const ruler = { onPointerMove: move, onPointerUp: end, onPointerCancel: () => setDrag(null) };
  const label = (g: Drag) => (g.axis === 'v' ? fmtCm(cmAcross(g.pos, bodyWidth)) : fmtCm(cmDown(g.pos, bodyWidth)));
  return (
    <>
      <div className="ruler ruler-x" style={{ left: rect.left, top: rect.top - RULER, width: rect.width, height: RULER }} title="Drag down onto the garment to make a guide line" onPointerDown={start('h', null)} {...ruler}>
        <Ticks axis="x" length={rect.width} k={k} ppc={BODY_PX / bodyWidth} />
      </div>
      <div className="ruler ruler-y" style={{ left: rect.left - RULER, top: rect.top, width: RULER, height: rect.height }} title="Drag right onto the garment to make a guide line" onPointerDown={start('v', null)} {...ruler}>
        <Ticks axis="y" length={rect.height} k={k} ppc={BODY_PX / bodyWidth} />
      </div>
      <div ref={layer} className="guide-layer" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
        {(['v', 'h'] as const).flatMap(axis => (axis === 'v' ? guides.v : guides.h).map((g, i) => {
          const moving = drag?.axis === axis && drag.index === i, pos = moving ? drag!.pos : g;
          return (
            <div key={`${axis}${i}`} className={`guide ${axis}${moving && !drag!.inside ? ' out' : ''}`} style={axis === 'v' ? { left: pos * k - 4 } : { top: pos * k - 4 }}
              role="separator" aria-orientation={axis === 'v' ? 'vertical' : 'horizontal'} aria-label={`Guide at ${fmtCm(axis === 'v' ? cmAcross(pos, bodyWidth) : cmDown(pos, bodyWidth))}. Drag to move, double-click to remove.`}
              title="Drag to move. Double-click, or drag it back onto the ruler, to remove it."
              onPointerDown={start(axis, i)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)} onDoubleClick={() => remove(axis, i)} />
          );
        }))}
        {drag && drag.index === null && drag.inside && <div className={`guide ${drag.axis} new`} style={drag.axis === 'v' ? { left: drag.pos * k - 4 } : { top: drag.pos * k - 4 }} />}
        {drag && (drag.inside || drag.index !== null) && (
          <div className="guide-tip" style={drag.inside ? (drag.axis === 'v' ? { left: drag.pos * k + 8, top: 8 } : { top: drag.pos * k + 8, left: 8 }) : { left: 8, top: 8 }}>
            {drag.inside ? label(drag) : 'Release to remove'}
          </div>
        )}
      </div>
    </>
  );
}
