// The Assist button: a palette of ready phrases (light, camera, skin, pose...) beside a prompt box. Click a phrase to add it, click again to take it out.
// Desktop: a popover under (or over) the button. Phones: a bottom sheet, and Back closes it. The lists live in assist/vocab.ts.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ASSIST, ASSIST_TITLE, type AssistField, type AssistGroup } from '../assist/vocab.ts';
import { has, slopIn, stripSlop, toggle, toggleLine } from '../assist/text.ts';
import { claude } from '../api.ts';
import { useMedia } from './a11y.ts';
import { fieldSearch } from './fields.ts';
import { useSheetHistory } from './sheets.ts';
import { useRun } from './ui.tsx';

export const WandIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20 14 10" /><path d="m15 3 1.2 2.8L19 7l-2.8 1.2L15 11l-1.2-2.8L11 7l2.8-1.2L15 3Z" /><path d="M19.5 14v4M17.5 16h4" />
  </svg>
);

export const SparkIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
  </svg>
);

/** What Improve does in each box, for its tooltip. */
const IMPROVE_TIP: Record<AssistField, string> = {
  shoot: 'Claude adds the light, camera, a small action and place details that make a photo look real',
  model: 'Claude turns it into a detailed, realistic description of a person',
  location: 'Claude turns it into a real place with an hour, a light source and near and far layers',
  studio: 'Claude writes the backdrop colour (with a hex code), its surface and the floor, and nothing else',
  style: 'Claude turns it into a camera, light and colour look',
  design: 'Claude gives each idea a clear subject, art style and colours for printing',
  refine: 'Claude turns it into precise changes and says what must stay the same',
};

interface PaletteProps { groups: AssistGroup[]; value: string; onChange: (v: string) => void; autoFocus: boolean; title: string; onDone?: () => void }

function Palette({ groups, value, onChange, autoFocus, title, onDone }: PaletteProps) {
  const [cat, setCat] = useState(groups[0].id);
  const [q, setQ] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const query = q.trim().toLowerCase();
  const group = groups.find(g => g.id === cat) ?? groups[0];
  const shown = useMemo(
    () => (query ? groups.flatMap(g => g.items.filter(p => p.toLowerCase().includes(query)).map(p => ({ p, g }))) : group.items.map(p => ({ p, g: group }))),
    [query, group, groups],
  );
  useEffect(() => { if (autoFocus) search.current?.focus({ preventScroll: true }); }, [autoFocus]);

  const click = (p: string, g: AssistGroup) => onChange(g.mode === 'line' ? toggleLine(value, p) : toggle(value, p));
  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('.assist-item') ?? [])];
  const stepItem = (e: ReactKeyboardEvent, dir: 1 | -1) => {
    const all = items(), at = all.indexOf(document.activeElement as HTMLElement);
    const next = all[at < 0 ? (dir > 0 ? 0 : all.length - 1) : at + dir];
    if (next) { e.preventDefault(); next.focus(); } else if (dir < 0) { e.preventDefault(); search.current?.focus(); }
  };
  const stepCat = (e: ReactKeyboardEvent, dir: 1 | -1) => {
    const i = groups.findIndex(g => g.id === group.id), next = groups[(i + dir + groups.length) % groups.length];
    e.preventDefault(); setQ(''); setCat(next.id);
    requestAnimationFrame(() => tabs.current?.querySelector<HTMLElement>(`[data-cat="${next.id}"]`)?.focus());
  };

  return (
    <div className="assist-pal">
      <div className="assist-head">
        <input ref={search} className="input" {...fieldSearch} value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()} phrases`} aria-label="Search phrases"
          onKeyDown={e => { if (e.key === 'ArrowDown') stepItem(e, 1); if (e.key === 'Enter') e.preventDefault(); }} />
        {onDone && <button type="button" className="btn primary sm" onClick={onDone}>Done</button>}
      </div>
      <div className="assist-body">
        <div ref={tabs} className="assist-cats" role="tablist" aria-label="Categories" aria-orientation="vertical" onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowRight') stepCat(e, 1); if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') stepCat(e, -1); }}>
          {groups.map(g => {
            const n = g.items.filter(p => has(value, p)).length, on = !query && g.id === group.id;
            return (
              <button key={g.id} type="button" role="tab" data-cat={g.id} aria-selected={on} tabIndex={on || (query && g.id === groups[0].id) ? 0 : -1} className={on ? 'on' : ''} onClick={() => { setQ(''); setCat(g.id); }}>
                <span>{g.label}</span>{n > 0 && <b className="assist-n" aria-label={`${n} added`}>{n}</b>}
              </button>
            );
          })}
        </div>
        <div className="assist-list" role="tabpanel" aria-label={query ? 'Search results' : group.label}>
          {!query && <p className="assist-tip">{group.tip}</p>}
          {shown.length === 0 ? <p className="assist-empty">Nothing matches “{q.trim()}”. Try another word.</p> : (
            <ul ref={list} onKeyDown={e => { if (e.key === 'ArrowDown') stepItem(e, 1); if (e.key === 'ArrowUp') stepItem(e, -1); }}>
              {shown.map(({ p, g }) => {
                const on = has(value, p);
                return (
                  <li key={`${g.id}:${p}`}>
                    <button type="button" className={`assist-item${on ? ' on' : ''}`} aria-pressed={on} onClick={() => click(p, g)}>
                      <span className="assist-check" aria-hidden="true">✓</span><span>{p}</span>{query && <em>{g.label}</em>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Phone version: a bottom sheet. Back (or the iOS edge swipe) closes it. */
function AssistSheet(props: PaletteProps & { onClose: () => void }) {
  useSheetHistory(props.onClose);
  return createPortal(
    <div className="assist-sheet-back" onMouseDown={e => e.target === e.currentTarget && props.onClose()}>
      <div className="assist-sheet" role="dialog" aria-label={`${props.title} phrases`}>
        <Palette {...props} onDone={props.onClose} />
      </div>
    </div>,
    document.body,
  );
}

/** `flush`: the box sits in a tight stack (8px gaps), so the button needs no pull-up. `onCommit` gets the text when the palette closes (for boxes that save on their own). */
export function Assist({ field, value, onChange, onCommit, disabled, flush }: { field: AssistField; value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; disabled?: boolean; flush?: boolean }) {
  const groups = ASSIST[field], title = ASSIST_TITLE[field];
  const phone = useMedia('(max-width: 900px)'), fine = useMedia('(pointer: fine)');
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ up: false, right: false });
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const slop = slopIn(value);
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ before: string; after: string; changed: string } | null>(null);

  /** Claude rewrites the box (about 10 to 20 seconds); the old text stays one click away. */
  const improve = async () => {
    const before = latest.current;
    if (!before.trim() || busy) return;
    setBusy(true);
    const out = await run(() => claude.improve(field, before));
    setBusy(false);
    if (!out) return;
    setDone({ before, after: out.text, changed: out.changed });
    onChange(out.text);
    onCommit?.(out.text);
  };
  const undo = () => { if (!done) return; onChange(done.before); onCommit?.(done.before); setDone(null); };

  const close = useCallback((refocus = false) => {
    setOpen(false);
    onCommit?.(latest.current);
    if (refocus) button.current?.focus({ preventScroll: true });
  }, [onCommit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } }; // capture: a drawer around this box must not close too
    const onDown = (e: PointerEvent) => { if (!phone && wrap.current && !wrap.current.contains(e.target as Node)) close(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown); };
  }, [open, phone, close]);

  const toggleOpen = () => {
    if (open) return close(true);
    const r = wrap.current?.getBoundingClientRect();
    if (r) setPlace({ up: innerHeight - r.bottom < 400 && r.top > innerHeight - r.bottom, right: r.left > innerWidth / 2 });
    setOpen(true);
  };

  return (
    <div className={`assist-bar${flush ? ' flush' : ''}`}>
      <div className="assist" ref={wrap}>
        <button ref={button} type="button" className="btn sm assist-btn" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={toggleOpen}
          title="Click ready-made phrases to add them: light, camera, skin, pose and more">
          <WandIcon /> Assist
        </button>
        {open && !phone && (
          <div className={`assist-pop${place.up ? ' up' : ''}${place.right ? ' right' : ''}`} role="dialog" aria-label={`${title} phrases`}>
            <Palette groups={groups} value={value} onChange={onChange} autoFocus={fine} title={title} />
          </div>
        )}
        {open && phone && <AssistSheet groups={groups} value={value} onChange={onChange} autoFocus={false} title={title} onClose={() => close()} />}
      </div>
      <button type="button" className="btn sm assist-btn" disabled={disabled || busy || !value.trim()} aria-busy={busy} onClick={improve}
        title={!value.trim() ? 'Write a few words first, then Claude can improve them' : IMPROVE_TIP[field]}>
        <SparkIcon /> {busy ? 'Improving…' : 'Improve'}
      </button>
      {done && done.after === value && (
        <div className="assist-note" role="status">
          <span>{done.changed}</span>
          <button type="button" onClick={undo}>Undo</button>
        </div>
      )}
      {slop.length > 0 && (
        <div className="assist-warn" role="status">
          <span>Can make it look fake:</span>
          {slop.map(s => <button key={s.id} type="button" title={s.tip} onClick={() => onChange(stripSlop(value, s.id))}>{s.label} ✕</button>)}
        </div>
      )}
    </div>
  );
}
