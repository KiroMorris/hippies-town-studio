// Linked sets: the front, back and sleeve prints of one collection. They go on a garment together ("Make mockups with the whole set").
import { useMemo, useState } from 'react';
import type { Design, LinkDesignsRequest, Placement } from '../../shared/types.ts';
import { api, useAction, useDesigns } from '../api.ts';
import { fieldSearch } from './fields.ts';
import { Modal, plural, useRun } from './ui.tsx';

export const SLOTS: Placement[] = ['front', 'back', 'sleeve'];
const LABEL: Record<Placement, string> = { front: 'Front', back: 'Back', sleeve: 'Sleeve' };

/** The prints of a design's set as three slots: open one, unlink it, or fill an empty slot (from the library, or have Codex make it). */
export function SetSlots({ design, mates, making, onOpen, onAdd, onUnlink, onMockups }: {
  design: Design; mates: Design[]; making: Placement[];
  onOpen: (id: string) => void; onAdd: (p: Placement) => void; onUnlink: (d: Design) => void; onMockups: () => void;
}) {
  const linked = mates.length > 1;
  const members = linked ? mates : [design];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="label">{linked ? `Linked set · ${SLOTS.filter(p => members.some(m => m.placement === p)).join(' + ')}` : 'Link front, back and sleeve'}</span>
      {!linked && <p className="hint">Link this design with its back and sleeve prints. A linked set goes on one garment together.</p>}
      <div className="slots">
        {SLOTS.map(p => {
          const m = members.find(x => x.placement === p);
          return (
            <div key={p} className={`slot${m?.id === design.id ? ' on' : ''}`}>
              {m ? (
                <>
                  <button className="slot-pic" onClick={() => onOpen(m.id)} aria-label={m.id === design.id ? `The ${p} print: this design` : `Open the ${p} print: ${m.title}`} aria-current={m.id === design.id} title={m.title}>
                    <img src={m.thumbUrl} alt="" loading="lazy" decoding="async" />
                  </button>
                  {linked && <button className="x" onClick={() => onUnlink(m)} aria-label={`Unlink the ${p} print`} title="Take it out of this set">✕</button>}
                </>
              ) : making.includes(p) ? (
                <div className="slot-pic making" role="status"><span className="pulse" aria-hidden="true" /><span>Codex is making it</span></div>
              ) : (
                <button className="slot-pic add" onClick={() => onAdd(p)} aria-label={`Add a ${p} print to this set`} title={`Add a ${p} print`}><b aria-hidden="true">+</b></button>
              )}
              <span className="slot-name">{LABEL[p]}</span>
            </div>
          );
        })}
      </div>
      <MakeMissing key={design.id} design={design} free={SLOTS.filter(p => !members.some(m => m.placement === p) && !making.includes(p))} />
      {linked && <button className="btn" onClick={onMockups}>Make mockups with the whole set</button>}
    </div>
  );
}

/** Generate the missing prints of the set with Codex, picked like the print placements on Generate: each is designed to match this one and joins the set when it is ready. */
function MakeMissing({ design, free }: { design: Design; free: Placement[] }) {
  const run = useRun();
  const [want, setWant] = useState<Placement[]>(free);
  const picked = want.filter(p => free.includes(p));
  const make = useAction(() => api.post<{ jobIds: string[] }>(`/designs/${design.id}/match`, { placements: picked }), [['designs']]);
  if (!free.length) return null;
  return (
    <div className="field">
      <span>Generate the matching prints <span className="hint">— Codex designs them to match this one, about 2 minutes each</span></span>
      <div className="seg" role="group" aria-label="Prints to generate">{free.map(p => (
        <button key={p} className={picked.includes(p) ? 'on' : ''} aria-pressed={picked.includes(p)} onClick={() => setWant(w => (w.includes(p) ? w.filter(x => x !== p) : [...w, p]))}>
          {p === 'sleeve' ? 'Sleeve (long strip)' : LABEL[p]}
        </button>
      ))}</div>
      <button className="btn" disabled={!picked.length || make.isPending} title={picked.length ? undefined : 'Pick at least one print'}
        onClick={() => run(async () => { await make.mutateAsync(); }, `${plural(picked.length, 'print')} queued. They join the set as they finish.`)}>
        {make.isPending ? 'Queuing…' : `Generate ${picked.map(p => LABEL[p].toLowerCase()).join(' + ') || 'prints'}`}
      </button>
    </div>
  );
}

/** Fill one slot of a set: link a design from the library (it becomes that print), or have Codex make the missing prints to match. */
export function PickPrintModal({ design, mates, placement, free, onClose }: { design: Design; mates: Design[]; placement: Placement; free: Placement[]; onClose: () => void }) {
  const run = useRun();
  const { data: library = [], isPending } = useDesigns({});
  const [every, setEvery] = useState(false);
  const [q, setQ] = useState('');
  const [want, setWant] = useState<Placement[]>([placement]);
  const members = mates.length > 1 ? mates : [design];
  const others = useMemo(() => library.filter(d => !members.some(m => m.id === d.id)), [library, members]);
  const exact = others.filter(d => d.placement === placement);
  const wide = every || !exact.length; // nothing is marked as this print yet: show everything (an upload is marked front until told otherwise)
  const shown = (wide ? [...exact, ...others.filter(d => d.placement !== placement)] : exact).filter(d => !q.trim() || d.title.toLowerCase().includes(q.trim().toLowerCase()));

  const link = useAction((chosen: Design) => api.post<Design[]>('/designs/link', {
    members: [...members.map(m => ({ id: m.id, placement: m.placement })), { id: chosen.id, placement }], into: design.setId,
  } satisfies LinkDesignsRequest), [['designs']]);
  const make = useAction(() => api.post<{ jobIds: string[] }>(`/designs/${design.id}/match`, { placements: want }), [['designs']]);

  return (
    <Modal title={`Add the ${placement} print`} onClose={onClose} wide>
      <div className="stack">
        <div className="make-box">
          <div>
            <strong>Let Codex design it</strong>
            <p className="hint">Codex makes the print to match “{design.title}”, so the set reads as one collection. About 2 minutes each; it joins this set when it is ready.</p>
          </div>
          {free.length > 1 && (
            <div className="row" role="group" aria-label="Prints to make">
              {free.map(p => (
                <label key={p} className="check"><input type="checkbox" checked={want.includes(p)} onChange={e => setWant(w => (e.target.checked ? [...w, p] : w.filter(x => x !== p)))} /><span>{LABEL[p]}</span></label>
              ))}
            </div>
          )}
          <div className="row">
            <button className="btn lime" disabled={!want.length || make.isPending} title={want.length ? undefined : 'Tick at least one print'}
              onClick={() => run(async () => { await make.mutateAsync(); onClose(); }, `${plural(want.length, 'print')} queued. They join the set as they finish.`)}>
              {make.isPending ? 'Queuing…' : want.length === 1 ? `Make the ${want[0]} print` : `Make ${want.length} prints`}
            </button>
          </div>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <span className="label">Or link one you already have</span>
          <div className="row">
            <div className="seg" role="group" aria-label="Which designs">
              <button className={!wide ? 'on' : ''} aria-pressed={!wide} disabled={!exact.length} onClick={() => setEvery(false)}>{LABEL[placement]} prints · {exact.length}</button>
              <button className={wide ? 'on' : ''} aria-pressed={wide} onClick={() => setEvery(true)}>All designs · {others.length}</button>
            </div>
            <input className="input" style={{ flex: 1, minWidth: 140 }} {...fieldSearch} placeholder="Search" aria-label="Search designs" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <p className="hint">Picking a design makes it this set’s {placement} print, whatever it was marked as before.</p>
          {isPending ? <p className="hint">Loading your designs…</p> : !shown.length ? <p className="hint">{q.trim() ? 'Nothing matches that search.' : 'No other designs to link yet.'}</p> : (
            <div className="pick-grid">
              {shown.map(d => (
                <button key={d.id} className="pick" disabled={link.isPending} aria-label={`Link ${d.title} as the ${placement} print`} title={d.title}
                  onClick={() => run(async () => { await link.mutateAsync(d); onClose(); }, `Linked as the ${placement} print`)}>
                  <span className="pick-pic"><img src={d.thumbUrl} alt="" loading="lazy" decoding="async" /></span>
                  <span className="pick-name">{d.title}</span>
                  <span className="pick-tags">
                    {d.placement !== placement && <span className="badge">{d.placement}</span>}
                    {d.setId && <span className="badge" title="It is in another set. Linking moves it here.">in a set</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** A placement for each design: its own when no two agree, otherwise the first keeps its own and the others take what is left. */
function suggest(designs: Design[]): Record<string, Placement> {
  const out: Record<string, Placement> = {}, free = [...SLOTS];
  for (const d of designs) if (free.includes(d.placement)) { out[d.id] = d.placement; free.splice(free.indexOf(d.placement), 1); }
  for (const d of designs) out[d.id] ??= free.shift() ?? d.placement;
  return out;
}

/** Link the selected designs (two or three) as one set, choosing which print each one is. */
export function LinkSelectedModal({ designs, onClose, onDone }: { designs: Design[]; onClose: () => void; onDone: () => void }) {
  const run = useRun();
  const [as, setAs] = useState(() => suggest(designs));
  const clash = SLOTS.find(p => designs.filter(d => as[d.id] === p).length > 1);
  const link = useAction((body: LinkDesignsRequest) => api.post<Design[]>('/designs/link', body), [['designs']]);
  const submit = () => run(async () => { await link.mutateAsync({ members: designs.map(d => ({ id: d.id, placement: as[d.id] })) }); onDone(); }, `Linked ${plural(designs.length, 'design')} as a set`);

  return (
    <Modal title={`Link ${plural(designs.length, 'design')} as a set`} onClose={onClose}>
      <div className="stack">
        <p className="hint">A set is the front, back and sleeve print of one collection. Choose which print each design is. Linked designs go on a garment together.</p>
        {designs.map(d => (
          <div key={d.id} className="link-row">
            <img src={d.thumbUrl} alt="" width={56} height={56} />
            <div className="link-name">
              <b title={d.title}>{d.title}</b>
              {d.setId && <span className="hint">In another set. Linking moves it here.</span>}
            </div>
            <div className="seg" role="group" aria-label={`Print for ${d.title}`}>
              {SLOTS.map(p => <button key={p} className={as[d.id] === p ? 'on' : ''} aria-pressed={as[d.id] === p} onClick={() => setAs(a => ({ ...a, [d.id]: p }))}>{LABEL[p]}</button>)}
            </div>
          </div>
        ))}
        {clash && <p className="hint bad" role="alert">Two designs are both set to {clash}. Give each one a different print.</p>}
        <div className="row">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!!clash || link.isPending} title={clash ? 'Give each design a different print first' : undefined} onClick={submit}>{link.isPending ? 'Linking…' : `Link ${plural(designs.length, 'design')}`}</button>
        </div>
      </div>
    </Modal>
  );
}
