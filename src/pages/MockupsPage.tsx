import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { smallUrl, type Mockup } from '../../shared/types.ts';
import { api, useAction, useMockups, useProducts, useShoots } from '../api.ts';
import { useSelectionKeys } from '../components/a11y.ts';
import { ProductPicker } from '../components/ProductPicker.tsx';
import { GridSkeleton, QueryError } from '../components/states.tsx';
import { Empty, Modal, plural, timeAgo, useConfirm, useRun, useSelection, useToast } from '../components/ui.tsx';
import { fieldSearch } from '../components/fields.ts';
import { useUrlSearch } from '../components/urlState.ts';

export function MockupsPage() {
  const { data: allMockups = [], isPending: isLoading, isError, error, refetch } = useMockups();
  const { data: products = [] } = useProducts();
  const sel = useSelection();
  const nav = useNavigate();
  const run = useRun();
  const ask = useConfirm();
  const toast = useToast();
  const location = useLocation();
  const [creating, setCreating] = useState(false);
  const [q, setQ, qNow] = useUrlSearch(); // the search term lives in the address
  useEffect(() => {
    const st = location.state as { flash?: string; select?: string[] } | null;
    if (st?.flash) toast(st.flash);
    if (st?.select?.length) sel.set(st.select); // mockups just made are ticked, so the next step ("Create photo shoots") is one click
  }, [location.state, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const del = useAction(async (ids: string[]) => { for (const id of ids) await api.del(`/mockups/${id}`); }, [['mockups'], ['shoots'], ['listings'], ['listing']]);
  const { data: allShoots = [] } = useShoots();
  const product = (id: string) => products.find(p => p.id === id);
  const photoCount = useMemo(() => { const c: Record<string, number> = {}; for (const x of allShoots) c[x.mockupId] = (c[x.mockupId] ?? 0) + 1; return c; }, [allShoots]);
  const [noPhotos, setNoPhotos] = useState(false); // only the mockups nobody has shot yet
  const withoutPhotos = allMockups.filter(m => !photoCount[m.id] && (m.renders.front || m.renders.back)).length;
  const mockups = useMemo(() => {
    const t = qNow.toLowerCase();
    const list = noPhotos ? allMockups.filter(m => !photoCount[m.id]) : allMockups;
    return t ? list.filter(m => `${m.name} ${products.find(p => p.id === m.productId)?.color ?? ''}`.toLowerCase().includes(t)) : list;
  }, [allMockups, products, qNow, noPhotos, photoCount]);
  const ids = useMemo(() => mockups.map(m => m.id), [mockups]);
  useSelectionKeys(sel, ids); // Esc clears the selection, Cmd/Ctrl+A selects every mockup shown

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Step 2 · <span className="kiro">♥ by Kiro</span></div><h1>Mockups</h1><p>Designs placed on your garments, front and back. Select some to create photo shoots.</p></div>
        <div className="row">
          <Link className="btn" to="/designs">Pick designs →</Link>
          <button className="btn primary" onClick={() => setCreating(true)}>New blank mockup</button>
        </div>
      </div>

      {allMockups.length > 0 && (
        <div className="toolbar">
          <div className="search-row">
            <input className="input search" {...fieldSearch} data-search placeholder="Search mockups or colors" aria-label="Search mockups" title="Search (press / to jump here)" value={q} onChange={e => setQ(e.target.value)} />
            <button className={`chip${noPhotos ? ' on' : ''}`} aria-pressed={noPhotos} title="Show only the mockups that have no photo yet" onClick={() => setNoPhotos(v => !v)}>No photos yet · {withoutPhotos}</button>
            <span className="spacer" />
            {mockups.length > 0 && <button className="btn ghost sm" title="Select every mockup shown (Cmd/Ctrl+A)" onClick={() => (sel.size === mockups.length ? sel.clear() : sel.set(ids))}>{sel.size === mockups.length ? 'Unselect all' : `Select all ${mockups.length}`}</button>}
          </div>
        </div>
      )}

      {sel.size > 0 && (
        <div className="selection-bar">
          <strong>{sel.size} selected</strong><span className="spacer" />
          <button className="btn lime" onClick={() => nav(`/shoots?mockups=${sel.list.join(',')}`)}>Create photo shoots</button>
          <button className="btn danger" onClick={async () => (await ask({ title: `Delete ${plural(sel.size, 'mockup')}?`, body: `The mockups and their renders are removed${allShoots.filter(x => sel.has(x.mockupId)).length ? `, and so ${allShoots.filter(x => sel.has(x.mockupId)).length === 1 ? 'is the photo' : `are the ${allShoots.filter(x => sel.has(x.mockupId)).length} photos`} made from ${sel.size === 1 ? 'it' : 'them'}` : ''}. The designs stay in your library.`, confirm: 'Delete', danger: true })) && run(async () => { await del.mutateAsync(sel.list); sel.clear(); }, 'Deleted')}>Delete</button>
          <button className="btn ghost" title="Clear the selection (Esc)" aria-label="Clear selection" onClick={sel.clear}>✕</button>
        </div>
      )}

      {isError && !allMockups.length ? <QueryError what="your mockups" error={error} onRetry={() => refetch()} />
        : isLoading ? <GridSkeleton kind="mockup" className="grid lg" count={8} />
        : !mockups.length ? (
          allMockups.length
            ? <Empty title={noPhotos && !qNow ? 'Every mockup has photos' : 'No mockups match your search'} actions={<button className="btn" onClick={() => { setQ(''); setNoPhotos(false); }}>Show all</button>}>{noPhotos && !qNow ? 'Nothing is waiting for a photo shoot.' : 'Try a garment color or part of a design name.'}</Empty>
            : <Empty title="No mockups yet" actions={<Link className="btn lime" to="/designs">Go to designs</Link>}>Select designs in your library and choose “Make mockups”, or start a blank mockup and drag designs onto it.</Empty>
        ) : (
        <div className="grid lg">
          {mockups.map(m => (
            <div key={m.id} className={`card${sel.has(m.id) ? ' selected' : ''}`}>
              <button className="select-box" onClick={e => sel.pick(m.id, e.shiftKey, ids)} aria-pressed={sel.has(m.id)} aria-label={`Select ${m.name}`} title="Select (Shift-click selects a range)">{sel.has(m.id) ? '✓' : ''}</button>
              <Link to={`/mockups/${m.id}`} aria-label={`Open ${m.name}`} className={`media photo${m.renders.front && m.renders.back ? ' pair' : ''}`} style={{ display: 'grid', gridTemplateColumns: m.renders.front && m.renders.back ? '1fr 1fr' : '1fr', gap: 2 }}>
                {m.renders.front && <img src={smallUrl(m.renders.front)} alt="Front" loading="lazy" decoding="async" fetchPriority="low" />}
                {m.renders.back && <img src={smallUrl(m.renders.back)} alt="Back" loading="lazy" decoding="async" fetchPriority="low" />}
                {!m.renders.front && !m.renders.back && <span className="hint">Empty — <span className="desk">click</span><span className="touch">tap</span> to add designs</span>}
              </Link>
              <div className="body">
                <div className="title" title={m.name}>{m.name}</div>
                <div className="meta">
                  {product(m.productId) && <span className="badge">{product(m.productId)!.color}</span>}
                  {m.views.front.length > 0 && <span className="badge">front</span>}
                  {m.views.back.length > 0 && <span className="badge">back</span>}
                  {photoCount[m.id] ? <span className="badge ok" title="Photos made from this mockup">{plural(photoCount[m.id], 'photo')}</span> : (m.renders.front || m.renders.back) && <span className="badge" title="No photo shoot yet">no photos</span>}
                  <span className="hint">{timeAgo(m.updatedAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <NewMockup onClose={() => setCreating(false)} onCreated={(m: Mockup) => nav(`/mockups/${m.id}`)} />}
    </>
  );
}

function NewMockup({ onClose, onCreated }: { onClose: () => void; onCreated: (m: Mockup) => void }) {
  const [productId, setProductId] = useState<string[]>([]);
  const run = useRun();
  const create = useAction((id: string) => api.post<Mockup>('/mockups', { productId: id, views: { front: [], back: [] } }), [['mockups']]);
  return (
    <Modal title="New mockup — choose a garment" onClose={onClose} wide>
      <div className="stack">
        <ProductPicker value={productId} onChange={setProductId} multiple={false} />
        <div className="row"><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!productId.length || create.isPending} title={productId.length ? undefined : 'Choose a garment first'} onClick={() => run(async () => onCreated(await create.mutateAsync(productId[0])))}>Open editor</button>
        </div>
      </div>
    </Modal>
  );
}
