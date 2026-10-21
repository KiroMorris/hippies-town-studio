import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Design, Placement } from '../../shared/types.ts';
import { api, uploadForm, useAction, useDesigns, useJobs, type DesignFilter } from '../api.ts';
import { usePreload, useSelectionKeys } from '../components/a11y.ts';
import { DesignCard, PendingCard } from '../components/DesignCard.tsx';
import { LinkSelectedModal, PickPrintModal, SLOTS, SetSlots } from '../components/LinkDesigns.tsx';
import { QuickMockups } from '../components/QuickMockups.tsx';
import { GridSkeleton, QueryError } from '../components/states.tsx';
import { Drawer, Empty, FileButton, fmtMs, plural, timeAgo, useConfirm, usePageDrop, useRun, useSelection, useToast } from '../components/ui.tsx';
import { Assist } from '../components/Assist.tsx';
import { fieldSearch, fieldText } from '../components/fields.ts';
import { useUrlParams, useUrlSearch } from '../components/urlState.ts';

const STATUS = [['', 'Active'], ['draft', 'Drafts'], ['approved', 'Approved'], ['archived', 'Archived']] as const;
const PLACEMENTS = [['', 'All'], ['front', 'Front'], ['back', 'Back'], ['sleeve', 'Sleeve']] as const;
const PLACEMENT_ORDER: string[] = ['front', 'back', 'sleeve'];

export function DesignsPage() {
  // Filters and search live in the address, so a refresh, Back and Forward keep them.
  const [params, setParams] = useUrlParams();
  const [q, setQ, qNow] = useUrlSearch();
  const filter = useMemo<DesignFilter>(() => ({ status: params.get('status') || undefined, placement: params.get('placement') || undefined, favorite: params.get('fav') === '1' || undefined, q: qNow || undefined }), [params, qNow]);
  const pick = (key: 'status' | 'placement', v: string) => setParams({ [key]: v || null });
  const filtered = !!(filter.status || filter.placement || filter.favorite || filter.q);
  const clearFilters = () => { setQ(''); setParams({ status: null, placement: null, fav: null, q: null }); };
  const { data: designs = [], isPending: isLoading, isError, error, refetch } = useDesigns(filter);
  const { data: active = [] } = useJobs('active');
  const pending = active.filter(j => j.type === 'design' || j.type === 'refine');
  const sel = useSelection();
  const ids = useMemo(() => designs.map(d => d.id), [designs]);
  useSelectionKeys(sel, ids); // Esc clears, Cmd/Ctrl+A selects every card shown
  const ask = useConfirm();
  const [open, setOpen] = useState<string | null>(null);
  const [mockupFor, setMockupFor] = useState<string[] | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pickFor, setPickFor] = useState<Placement | null>(null); // the empty slot of the open design's set being filled
  const run = useRun();
  const toast = useToast();
  const nav = useNavigate();
  const location = useLocation();
  useEffect(() => { const flash = (location.state as { flash?: string } | null)?.flash; if (flash) toast(flash); }, [location.state, toast]);
  const openParam = params.get('open'); // a link from elsewhere (Queue, "parent design") opens a design; the address is cleaned up afterwards
  useEffect(() => { if (openParam) { setOpen(openParam); setParams({ open: null }, true); } }, [openParam, setParams]);

  const uploadPlacement = (filter.placement || 'front') as Placement;
  const upload = useAction((files: File[]) => api.post<Design[]>('/designs/upload', uploadForm(files, { placement: uploadPlacement })), [['designs']]);
  const bulk = useAction((body: { ids: string[]; action: string }) => api.post('/designs/bulk', body), [['designs']]);
  const patch = useAction(({ id, ...body }: { id: string } & Partial<Design>) => api.patch<Design>(`/designs/${id}`, body), [['designs']]);

  const onFiles = (files: File[]) => run(() => upload.mutateAsync(files), `Added ${plural(files.length, 'design')} as ${uploadPlacement} prints`);
  const overlay = usePageDrop(onFiles, 'Drop to add designs', `They'll be added as ${uploadPlacement} prints. Transparent PNGs work best.`);
  const doBulk = (action: string, msg: string) => run(async () => { await bulk.mutateAsync({ ids: sel.list, action }); sel.clear(); }, msg);
  const shown = useMemo(() => designs.find(d => d.id === open), [designs, open]);
  // A design the filters hide (a linked print, a parent) is fetched on its own, so the drawer can still open it.
  const { data: fetched } = useQuery({ queryKey: ['designs', 'one', open], queryFn: () => api.get<Design>(`/designs/${open}`), enabled: !!open && !shown });
  const [peek, setPeek] = useState<Design | null>(null); // a linked print opened from the set row: shown at once while its own data loads
  const current = shown ?? fetched ?? (peek?.id === open ? peek : undefined);
  // The linked set of the open design (front/back/sleeve), even when the filters hide its other members.
  const { data: setMates = [] } = useDesigns(current?.setId ? { set: current.setId, status: 'all' } : { batch: '__none__' });
  // Prints of this design's set that Codex is making right now (a set being generated, or "make the matching back").
  const making = useMemo(() => (current ? active.filter(j => j.type === 'design' && (j.input.joinId === current.id || (!!current.setId && j.input.setId === current.setId))).map(j => j.input.placement as Placement) : []), [active, current]);
  const byId = useMemo(() => new Map(designs.map(d => [d.id, d])), [designs]);
  const mates = useMemo(() => [...setMates].sort((a, b) => PLACEMENT_ORDER.indexOf(a.placement) - PLACEMENT_ORDER.indexOf(b.placement)), [setMates]);
  // Previous/next in the order the cards are shown (the viewer is one of this list).
  const at = current ? ids.indexOf(current.id) : -1;
  const prev = at > 0 ? designs[at - 1] : undefined, next = at >= 0 && at < designs.length - 1 ? designs[at + 1] : undefined;
  const go = (d: Design) => setOpen(d.id);
  usePreload([prev?.url, next?.url]);

  return (
    <>
      {overlay}
      <div className="page-head">
        <div><div className="eyebrow">Step 1 · <span className="kiro">made by Kiro</span></div><h1>Designs</h1><p>Your print library. Select designs to make mockups.<span className="desk"> Drop images anywhere on this page to add more.</span></p></div>
        <div className="row">
          <FileButton multiple title="Add PNG, JPG or WebP files to the library" onFiles={onFiles}>Upload</FileButton>
          <Link className="btn lime" to="/generate">Generate with Codex</Link>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Status">{STATUS.map(([v, l]) => <button key={v} className={(filter.status ?? '') === v ? 'on' : ''} aria-pressed={(filter.status ?? '') === v} onClick={() => pick('status', v)}>{l}</button>)}</div>
        <div className="seg" role="group" aria-label="Placement">{PLACEMENTS.map(([v, l]) => <button key={v} className={(filter.placement ?? '') === v ? 'on' : ''} aria-pressed={(filter.placement ?? '') === v} onClick={() => pick('placement', v)}>{l}</button>)}</div>
        <button className={`chip${filter.favorite ? ' on' : ''}`} aria-pressed={!!filter.favorite} onClick={() => setParams({ fav: !filter.favorite })}>★ Favorites</button>
        <div className="search-row">
          <input className="input search" {...fieldSearch} data-search placeholder="Search titles & prompts" aria-label="Search designs" title="Search (press / to jump here)" value={q} onChange={e => setQ(e.target.value)} />
          <span className="spacer" />
          {designs.length > 0 && <button className="btn ghost sm" title="Select every design shown (Cmd/Ctrl+A)" onClick={() => (sel.size === designs.length ? sel.clear() : sel.set(ids))}>{sel.size === designs.length ? 'Unselect all' : `Select all ${designs.length}`}</button>}
        </div>
      </div>

      {sel.size > 0 && (
        <div className="selection-bar">
          <strong>{sel.size} selected</strong>
          <span className="spacer" />
          <button className="btn lime" onClick={() => setMockupFor(sel.list)}>Make mockups</button>
          <button className="btn" onClick={() => nav(`/generate?from=${sel.list.join(',')}`)}>More like these</button>
          {sel.size >= 2 && sel.size <= 3 && <button className="btn" title="Link them as one set: a front, a back and a sleeve print that go on a garment together" onClick={() => setLinkOpen(true)}>Link as set</button>}
          {sel.list.some(id => byId.get(id)?.setId) && <button className="btn" title="Take the selected designs out of their sets" onClick={() => doBulk('unlink', 'Unlinked')}>Unlink</button>}
          <button className="btn" onClick={() => doBulk('approve', 'Approved')}>Approve</button>
          <button className="btn" title="Add the selected designs to your favorites" aria-label="Favorite selected" onClick={() => doBulk('favorite', 'Added to favorites')}>★</button>
          <button className="btn" onClick={() => doBulk(filter.status === 'archived' ? 'draft' : 'archive', filter.status === 'archived' ? 'Restored' : 'Archived')}>{filter.status === 'archived' ? 'Restore' : 'Archive'}</button>
          <button className="btn danger" onClick={async () => (await ask({ title: `Delete ${plural(sel.size, 'design')}?`, body: 'They are removed from the library for good. This can’t be undone.', confirm: 'Delete', danger: true })) && doBulk('delete', 'Deleted')}>Delete</button>
          <button className="btn ghost" title="Clear the selection (Esc)" aria-label="Clear selection" onClick={sel.clear}>✕</button>
        </div>
      )}

      {isError && !designs.length ? <QueryError what="your designs" error={error} onRetry={() => refetch()} />
        : isLoading ? <GridSkeleton kind="design" count={14} />
        : !designs.length && !pending.length ? (
          filtered
            ? <Empty title="Nothing matches these filters" actions={<button className="btn" onClick={clearFilters}>Clear filters</button>}>Try another status or placement, or search for something else.</Empty>
            : <Empty title="No designs yet" actions={<Link className="btn lime" to="/generate">Generate with Codex</Link>}>Drag images onto this page, or let Codex create designs from your ideas and references.</Empty>
        ) : (
          <div className="grid masonry">
            {!filter.status && pending.map(j => <PendingCard key={j.id} job={j} />)}
            {designs.map(d => (
              <DesignCard key={d.id} design={d} selected={sel.has(d.id)} onToggle={e => sel.pick(d.id, e.shiftKey, ids)} onOpen={() => go(d)}
                onFavorite={() => patch.mutate({ id: d.id, favorite: !d.favorite })} />
            ))}
          </div>
        )}

      {current && <DesignDrawer design={current} mates={mates} making={making} onSwitch={id => { setPeek(mates.find(m => m.id === id) ?? null); setOpen(id); }} onClose={() => { setOpen(null); setPickFor(null); }} onMockups={() => setMockupFor([current.id])} onMockupsSet={() => setMockupFor(mates.map(d => d.id))}
        onAddPrint={setPickFor} onUnlink={d => run(() => bulk.mutateAsync({ ids: [d.id], action: 'unlink' }), 'Unlinked')}
        onPrev={prev && (() => go(prev))} onNext={next && (() => go(next))} position={at >= 0 ? `${at + 1} of ${designs.length}` : undefined}
        onParent={pid => { const d = designs.find(x => x.id === pid); if (d) go(d); else toast('The original is hidden by your filters. Clear them to see it.', true); }} />}
      {mockupFor && <QuickMockups designIds={mockupFor} onClose={() => setMockupFor(null)} />}
      {linkOpen && <LinkSelectedModal designs={sel.list.map(id => byId.get(id)).filter((d): d is Design => !!d)} onClose={() => setLinkOpen(false)} onDone={() => { setLinkOpen(false); sel.clear(); }} />}
      {pickFor && current && <PickPrintModal design={current} mates={mates} placement={pickFor} free={SLOTS.filter(p => !(mates.length > 1 ? mates : [current]).some(m => m.placement === p) && !making.includes(p))} onClose={() => setPickFor(null)} />}
    </>
  );
}

function DesignDrawer({ design, mates, making, onSwitch, onClose, onMockups, onMockupsSet, onAddPrint, onUnlink, onPrev, onNext, position, onParent }: { design: Design; mates: Design[]; making: Placement[]; onSwitch: (id: string) => void; onClose: () => void; onMockups: () => void; onMockupsSet: () => void; onAddPrint: (p: Placement) => void; onUnlink: (d: Design) => void; onPrev?: () => void; onNext?: () => void; position?: string; onParent: (id: string) => void }) {
  const run = useRun();
  const ask = useConfirm();
  const [title, setTitle] = useState(design.title);
  const [feedback, setFeedback] = useState('');
  const [count, setCount] = useState(3);
  useEffect(() => setTitle(design.title), [design.id, design.title]);
  useEffect(() => { setFeedback(''); setCount(3); }, [design.id]); // moving to another design must not carry the half-written feedback along
  const patch = useAction((body: Partial<Design>) => api.patch<Design>(`/designs/${design.id}`, body), [['designs']]);
  const refine = useAction(() => api.post(`/designs/${design.id}/refine`, { feedback }), [['designs']]);
  const upscale = useAction(() => api.post<Design>(`/designs/${design.id}/upscale`, {}), [['designs']]);
  const variations = useAction(() => api.post('/designs/generate', { ideas: [], referenceIds: [], designIds: [design.id], separateReferences: true, placement: design.placement, count }), [['designs']]);
  const del = useAction(() => api.del(`/designs/${design.id}`), [['designs']]);
  const printCm = (px: number) => ((px / 300) * 2.54).toFixed(1);

  return (
    <Drawer onClose={onClose} onPrev={onPrev} onNext={onNext} position={position} label={design.title} viewer={<img src={design.url} alt={design.title} decoding="async" />}>
      <div className="stack" style={{ gap: 10 }}>
        <input className="input" {...fieldText} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && title !== design.title && patch.mutate({ title })} aria-label="Title" style={{ fontWeight: 600, fontSize: 16 }} />
        <div className="row">
          <div className="seg" role="group" aria-label="Placement">{(['front', 'back', 'sleeve'] as const).map(p => <button key={p} className={design.placement === p ? 'on' : ''} aria-pressed={design.placement === p} onClick={() => run(() => patch.mutateAsync({ placement: p }))}>{p}</button>)}</div>
          <button className={`btn sm${design.favorite ? ' lime' : ''}`} aria-pressed={design.favorite} onClick={() => patch.mutate({ favorite: !design.favorite })}>{design.favorite ? '★ Favorite' : '☆ Favorite'}</button>
        </div>
        <div className="row">
          {design.status !== 'approved'
            ? <button className="btn primary sm" onClick={() => patch.mutate({ status: 'approved' })}>✓ Approve</button>
            : <button className="btn sm" onClick={() => patch.mutate({ status: 'draft' })}>Move back to drafts</button>}
          <button className="btn sm" onClick={() => patch.mutate({ status: design.status === 'archived' ? 'draft' : 'archived' })}>{design.status === 'archived' ? 'Restore' : 'Archive'}</button>
          {design.status !== 'draft' && <span className={`badge ${design.status}`}>{design.status}</span>}
        </div>
      </div>

      <button className="btn lime block" onClick={onMockups}>Make mockups with this design</button>

      <SetSlots design={design} mates={mates} making={making} onOpen={onSwitch} onAdd={onAddPrint} onUnlink={onUnlink} onMockups={onMockupsSet} />

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Refine with feedback</span>
        <textarea className="textarea" placeholder='e.g. "make the cat bigger and remove the stars"' value={feedback} onChange={e => setFeedback(e.target.value)} />
        <Assist flush field="refine" value={feedback} onChange={setFeedback} />
        <button className="btn" disabled={!feedback.trim() || refine.isPending} title={feedback.trim() ? undefined : 'Write what to change first'} onClick={() => run(async () => { await refine.mutateAsync(); setFeedback(''); }, 'Refinement queued — it will appear in Designs')}>Refine this design</button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">More like this</span>
        <div className="slider-row"><input type="range" min={1} max={8} value={count} aria-label="Number of variations" onChange={e => setCount(+e.target.value)} /><span className="hint">{plural(count, 'variation')}</span></div>
        <button className="btn" disabled={variations.isPending} onClick={() => run(() => variations.mutateAsync(), `${plural(count, 'variation')} queued`)}>Generate variations</button>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <div className="label">Print file</div>
        <p className="hint">{design.width} × {design.height} px · {printCm(design.width)} × {printCm(design.height)} cm at 300 DPI</p>
        <div className="stack" style={{ gap: 8 }}>
          <a className="btn" href={`/api/designs/${design.id}/download`}>Download PNG</a>
          <a className="btn" href={`/api/designs/${design.id}/download?max=20`} title="Same size and transparency, compressed to stay under 20 MB">Download under 20 MB</a>
          {Math.max(design.width, design.height) < 4096
            ? <button className="btn" disabled={upscale.isPending} title="fal.ai enlarges it to 4096 px on the long side and keeps the transparency" onClick={() => run(() => upscale.mutateAsync(), 'Upscaled to 4K: the print file is now the big one')}>{upscale.isPending ? 'Upscaling to 4K… (about 30 s)' : 'Upscale to 4K'}</button>
            : <span className="hint">4K print file ✓</span>}
        </div>
      </div>

      {design.prompt && <div className="stack" style={{ gap: 6 }}><span className="label">Prompt</span><div className="prompt-box">{design.prompt}</div></div>}
      <dl className="kv">
        <dt>Source</dt><dd>{design.source}</dd>
        <dt>Background</dt><dd>{design.transparent ? 'Transparent ✓' : <span className="badge warn">Solid — will print as a box</span>}</dd>
        <dt>Added</dt><dd>{timeAgo(design.createdAt)}</dd>
        {design.genMs != null && <><dt>Generated in</dt><dd>{fmtMs(design.genMs)}</dd></>}
        {design.parentId && <><dt>Based on</dt><dd><button className="btn ghost sm" onClick={() => onParent(design.parentId!)}>parent design</button></dd></>}
      </dl>
      <button className="btn danger" onClick={async () => (await ask({ title: 'Delete this design?', body: `“${design.title}” is removed from the library for good. This can’t be undone.`, confirm: 'Delete design', danger: true })) && run(async () => { await del.mutateAsync(); onClose(); }, 'Design deleted')}>Delete design</button>
    </Drawer>
  );
}
