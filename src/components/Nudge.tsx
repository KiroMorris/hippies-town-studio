import { useEffect, useRef } from 'react';

const ARROWS = [['←', -1, 0, 'left'], ['↑', 0, -1, 'up'], ['↓', 0, 1, 'down'], ['→', 1, 0, 'right']] as const;

/**
 * Four arrow buttons that move the selected design a hair at a time. A finger is too coarse for the last few millimetres:
 * one tap moves 2 canvas units (about 2 mm on a normal garment), holding keeps going. Phones only (the caller gives it the `touch` class).
 * `onMove` gets the distance in canvas units and may read fresh state each call.
 */
export function Nudge({ onMove, className = '' }: { onMove: (dx: number, dy: number) => void; className?: string }) {
  const move = useRef(onMove);
  move.current = onMove;
  const timers = useRef<{ wait: number; tick: number }>({ wait: 0, tick: 0 });
  const stop = () => { clearTimeout(timers.current.wait); clearInterval(timers.current.tick); timers.current = { wait: 0, tick: 0 }; };
  useEffect(() => stop, []);
  const start = (dx: number, dy: number) => {
    stop();
    move.current(dx * 2, dy * 2);
    timers.current.wait = window.setTimeout(() => { timers.current.tick = window.setInterval(() => move.current(dx * 3, dy * 3), 60); }, 380);
  };
  return (
    <div className={`field ${className}`}>
      <span>Nudge <span className="hint">— hold to keep moving</span></span>
      <div className="nudge" role="group" aria-label="Nudge the design">
        {ARROWS.map(([glyph, dx, dy, name]) => (
          <button key={name} type="button" className="btn" aria-label={`Move ${name}`}
            onPointerDown={e => { if (e.pointerType === 'mouse' && e.button !== 0) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ } start(dx, dy); }}
            onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onContextMenu={e => e.preventDefault()}
            onClick={e => { if (e.detail === 0) move.current(dx * 2, dy * 2); /* keyboard / assistive tech: the press already moved it for pointers */ }}>{glyph}</button>
        ))}
      </div>
    </div>
  );
}
