import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { PLACEMENT_DEFAULTS, PRINT_TOP, layerSize, refitViews, type Design, type Layer, type Mockup, type Placement, type Product, type View } from '../../shared/types.ts';
import { api, useAction, useDesigns, useMockup, useProducts, useShoots } from '../api.ts';
import { MockupCanvas, loadImage } from '../components/MockupCanvas.tsx';
import { ProductPicker } from '../components/ProductPicker.tsx';
import { dialogOpen, isTyping } from '../components/a11y.ts';
import { EditorSkeleton, QueryError } from '../components/states.tsx';
import { Modal, plural, useConfirm, useRun, useToast } from '../components/ui.tsx';
import { fieldNumber, fieldText } from '../components/fields.ts';
import { Nudge } from '../components/Nudge.tsx';
import { followSleeve, isSleevePrint, silhouetteOf, type Silhouette } from '../components/sleeveFit.ts';
import { EyeIcon, LinkIcon, SetIcon, ZoomViewer } from '../components/ZoomViewer.tsx';
import { linkedSets, matesOf, SET_LABEL } from '../components/linkedSets.ts';
import { alignShifts, boxOf, cleanGuides, distributeShifts, NO_GUIDES, type AlignKind, type Guides } from '../components/layout.ts';

type Draft = Pick<Mockup, 'name' | 'productId' | 'bodyWidth' | 'views'>;
const uid = () => `lyr_${Math.random().toString(36).slice(2, 10)}`;
const toDraft = (m: Mockup): Draft => ({ name: m.name, productId: m.productId, bodyWidth: m.bodyWidth, views: m.views });
const VIEWS = ['front', 'back'] as const;
// Guide lines belong to this browser (they are an aid for placing, not part of the mockup): one set per mockup and side.
const guideKey = (id: string | undefined) => `hippies.guides.${id}`;
const loadGuides = (id: string | undefined): Record<View, Guides> => {
  try { const raw = JSON.parse(localStorage.getItem(guideKey(id)) ?? 'null'); return { front: cleanGuides(raw?.front), back: cleanGuides(raw?.back) }; }
  catch { return { front: NO_GUIDES, back: NO_GUIDES }; }
};
// Where a garment's outer edges run in each photo, read once from its mask (the sleeves hang a little differently in the front and the back photo).
const outlines = new Map<string, Promise<Silhouette | null>>();
const outlineOf = (maskUrl: string) => {
  let p = outlines.get(maskUrl);
  if (!p) {
    p = loadImage(maskUrl).then(silhouetteOf, () => null);
    outlines.set(maskUrl, p);
    p.then(o => { if (!o) outlines.delete(maskUrl); }); // unreadable now: try again next time
  }
  return p;
};

export function MockupEditorPage() {
  const { id } = useParams();
  const { data: mockup, isError, error, refetch } = useMockup(id);
  const { data: products = [] } = useProducts();
  const { data: designs = [] } = useDesigns({ status: 'all' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<View>('front');
  const [selected, setSelected] = useState<string[]>([]); // the designs picked on this side (Shift-click, or a box dragged round them)
  const [centerLine, setCenterLine] = useState(false);
  const [snapOn, setSnapOn] = useState(() => { try { return localStorage.getItem('hippies.snap') !== '0'; } catch { return true; } });
  const [guideSets, setGuideSets] = useState<Record<View, Guides>>(() => loadGuides(id));
  useEffect(() => setGuideSets(loadGuides(id)), [id]); // another mockup, its own guides
  const [trayFilter, setTrayFilter] = useState<'all' | 'approved' | 'linked' | Placement>('all');
  const [hotSet, setHotSet] = useState<string | null>(null); // the set whose prints light up in the tray (hover, or the design selected on the garment)
  const [cloneOpen, setCloneOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [look, setLook] = useState<string | null>(null); // the design being looked at closely
  const [copied, setCopied] = useState<{ id: string; json: string } | null>(null); // the draft last saved as a new mockup
  const run = useRun();
  const toast = useToast();
  const ask = useConfirm();
  const nav = useNavigate();

  const draftRef = useRef<Draft | null>(null);
  const dirtyRef = useRef(false);
  const editSeq = useRef(0);
  const seeded = useRef<string | null>(null);
  // Undo and redo live in client state only: snapshots of the draft. Edits that are one continuous gesture (a drag, a slider, typing) share a `coalesce` key and become one step.
  const hist = useRef<{ past: Draft[]; future: Draft[]; key: string; at: number }>({ past: [], future: [], key: '', at: 0 });
  const savedJson = useRef(''); // the draft as last saved (or loaded): "unsaved" means the draft differs from it, so undoing back to it is clean again
  const [, setHistTick] = useState(0);
  const setDirtyBoth = (v: boolean) => { dirtyRef.current = v; setDirty(v); };
  const seed = (m: Mockup, keepHistory = false) => {
    const d = toDraft(m);
    draftRef.current = d; seeded.current = `${m.id}:${m.updatedAt}`; savedJson.current = JSON.stringify(d); setDraft(d);
    if (!keepHistory) { hist.current = { past: [], future: [], key: '', at: 0 }; setHistTick(t => t + 1); }
  };

  // Seed from the server only when we have no unsaved edits and haven't already seeded this exact version
  // (a save seeds from its own PUT response, so the follow-up refetch is a no-op).
  useEffect(() => {
    if (!mockup || mockup.id !== id) return;
    const key = `${mockup.id}:${mockup.updatedAt}`;
    if (seeded.current === key) return;
    if (seeded.current?.startsWith(`${id}:`) && dirtyRef.current) return;
    seed(mockup);
    setDirtyBoth(false);
  }, [mockup, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const safeCopy = !!copied && dirty && !!draft && JSON.stringify(draft) === copied.json; // unsaved here, but exactly this is saved as a new mockup
  useEffect(() => {
    if (!dirty || safeCopy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, safeCopy]);

  // Leaving with unsaved changes asks first (the in-app dialog below); closing the tab or reloading uses the browser's own prompt (above).
  const copiedRef = useRef(copied);
  copiedRef.current = copied;
  const blocker = useBlocker(() => dirtyRef.current && !(copiedRef.current && JSON.stringify(draftRef.current) === copiedRef.current.json));

  const actions = useRef({ save: () => {}, saveNew: () => {}, remove: () => {}, deselect: () => {}, selectAll: () => {}, undo: () => {}, redo: () => {} });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && !e.altKey && k === 's') { e.preventDefault(); if (e.shiftKey) actions.current.saveNew(); else actions.current.save(); return; }
      const t = e.target as HTMLElement | null;
      if (dialogOpen()) return;
      if (mod && !e.altKey && !e.shiftKey && k === 'a') { if (isTyping(t)) return; e.preventDefault(); actions.current.selectAll(); return; }
      if (mod && !e.altKey && (k === 'z' || k === 'y')) {
        if (isTyping(t)) return; // a text field keeps its own undo
        e.preventDefault();
        if (k === 'y' || e.shiftKey) actions.current.redo(); else actions.current.undo();
        return;
      }
      if (isTyping(t) || mod || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // only on the canvas or the layer list (or with nothing focused), so a stray Backspace on a button or slider never removes a design
        const at = document.activeElement;
        if (!at || at === document.body || at.tagName === 'CANVAS' || at.closest('.layer-list')) { e.preventDefault(); actions.current.remove(); }
      } else if (e.key === 'Escape') actions.current.deselect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const save = useAction((d: Draft) => api.put<Mockup>(`/mockups/${id}`, d), [['mockups'], ['mockup', id]]);
  const del = useAction(() => api.del(`/mockups/${id}`), [['mockups'], ['shoots'], ['listings'], ['listing']]);
  const saveNew = useAction((d: Draft) => api.post<Mockup>('/mockups', d), [['mockups'], ['listings']]);
  const { data: myShoots = [] } = useShoots(id ? { mockup: id } : { mockup: '__none__' });

  const product = products.find(p => p.id === draft?.productId);
  const byId = useMemo(() => Object.fromEntries(designs.map(d => [d.id, d])), [designs]);
  const sets = useMemo(() => linkedSets(designs), [designs]); // which designs are linked, and each set's colour
  const layers = draft?.views[view] ?? [];
  const sel = layers.filter(l => selected.includes(l.id));
  const layer = sel.length === 1 ? sel[0] : null; // the single design the sliders and handles are for
  const used = useMemo(() => [...new Set([...(draft?.views.front ?? []), ...(draft?.views.back ?? [])].map(l => l.designId))], [draft]);
  const designUrls = useMemo(() => Object.fromEntries(used.filter(i => byId[i]).map(i => [i, byId[i].url])), [used, byId]);
  const designAspect = useMemo(() => Object.fromEntries(designs.map(d => [d.id, d.height / d.width])), [designs]);
  const tray = trayFilter === 'linked' ? sets.order.flatMap(sid => sets.members[sid])
    : designs.filter(d => d.status !== 'archived' && (trayFilter === 'all' || (trayFilter === 'approved' ? d.status === 'approved' : d.placement === trayFilter)));
  const setColor = (d?: Pick<Design, 'setId'>) => (d?.setId ? sets.color[d.setId] : undefined);
  const selSets = new Set(sel.map(l => byId[l.designId]?.setId).filter((s): s is string => !!s && !!sets.color[s]));
  const matesText = (d: Design) => matesOf(sets, d).map(m => `${SET_LABEL[m.placement]}: ${m.title}`).join(', ');

  if (!draft || !product) return isError && !mockup ? <QueryError what="this mockup" error={error} onRetry={() => refetch()} /> : <EditorSkeleton />;

  // Applies an edit against the latest draft; a change that results in an identical draft is ignored (stays clean).
  // `coalesce`: edits with the same key within 0.7 s (one drag, one slider move, typing) are a single undo step.
  const edit = (fn: (d: Draft) => Draft, coalesce?: string) => {
    const cur = draftRef.current;
    if (!cur) return;
    const next = fn(cur);
    const json = JSON.stringify(next);
    if (next === cur || json === JSON.stringify(cur)) return;
    const h = hist.current, now = Date.now();
    if (!(coalesce && coalesce === h.key && now - h.at < 700)) { h.past.push(cur); if (h.past.length > 100) h.past.shift(); }
    h.key = coalesce ?? ''; h.at = now; h.future = [];
    draftRef.current = next; editSeq.current++;
    setDraft(next); setDirtyBoth(json !== savedJson.current); setHistTick(t => t + 1);
  };
  // Undo / redo: swap the draft with the previous (or next) snapshot. Going back to the saved state makes the editor clean again.
  const travel = (from: 'past' | 'future') => {
    const h = hist.current, cur = draftRef.current, target = h[from].pop();
    if (!cur || !target) return;
    h[from === 'past' ? 'future' : 'past'].push(cur); h.key = '';
    const sideChanged = VIEWS.filter(v => JSON.stringify(target.views[v]) !== JSON.stringify(cur.views[v]));
    if (sideChanged.length && !sideChanged.includes(view)) setView(sideChanged[0]); // show the side that changed
    draftRef.current = target; editSeq.current++;
    setDraft(target); setDirtyBoth(JSON.stringify(target) !== savedJson.current); setHistTick(t => t + 1);
    setSelected(s => s.filter(sid => [...target.views.front, ...target.views.back].some(l => l.id === sid)));
  };
  const canUndo = hist.current.past.length > 0, canRedo = hist.current.future.length > 0;
  const setLayers = (v: View, fn: (ls: Layer[]) => Layer[], coalesce?: string) => edit(d => ({ ...d, views: { ...d.views, [v]: fn(d.views[v]) } }), coalesce);
  const patchLayer = (lid: string, patch: Partial<Layer>) => setLayers(view, ls => ls.map(l => (l.id === lid ? { ...l, ...patch } : l)), 'flip' in patch ? undefined : `${view}:${lid}:${Object.keys(patch).join()}`);
  const removeSelected = () => { if (!sel.length) return; setLayers(view, ls => ls.filter(l => !selected.includes(l.id))); setSelected([]); };
  // Several designs at once (a drag, the arrow keys): one undo step per gesture.
  const moveLayers = (to: Record<string, { x: number; y: number }>) => setLayers(view, ls => ls.map(l => (to[l.id] ? { ...l, ...to[l.id] } : l)), `${view}:move:${Object.keys(to).sort().join(',')}`);
  const nudgeSelected = (dx: number, dy: number) => moveLayers(Object.fromEntries(sel.map(l => [l.id, { x: l.x + dx, y: l.y + dy }])));
  const boxesOfSelected = () => sel.map(l => { const z = layerSize(l.widthCm, draft.bodyWidth, designAspect[l.designId] ?? 1); return { id: l.id, box: boxOf(l, z.w, z.h) }; });
  const shiftSelected = (by: Record<string, [number, number]>) => setLayers(view, ls => ls.map(l => (by[l.id] ? { ...l, x: Math.round((l.x + by[l.id][0]) * 10) / 10, y: Math.round((l.y + by[l.id][1]) * 10) / 10 } : l)));
  const alignSelected = (kind: AlignKind) => shiftSelected(alignShifts(boxesOfSelected(), kind));
  const spreadSelected = (axis: 'x' | 'y') => shiftSelected(distributeShifts(boxesOfSelected(), axis));
  const flipSelected = () => setLayers(view, ls => ls.map(l => (selected.includes(l.id) ? { ...l, flip: !l.flip } : l)));
  const pickRow = (lid: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => setSelected(cur => (e.shiftKey || e.metaKey || e.ctrlKey ? (cur.includes(lid) ? cur.filter(i => i !== lid) : [...cur, lid]) : [lid]));
  const setViewGuides = (v: View, g: Guides) => {
    const next = { ...guideSets, [v]: g };
    setGuideSets(next);
    try { if (VIEWS.some(w => next[w].v.length || next[w].h.length)) localStorage.setItem(guideKey(id), JSON.stringify(next)); else localStorage.removeItem(guideKey(id)); } catch { /* a private window: guides last until the page closes */ }
  };
  const toggleSnap = () => { const on = !snapOn; setSnapOn(on); try { localStorage.setItem('hippies.snap', on ? '1' : '0'); } catch { /* not saved */ } };
  // Stacking order without drag and drop: later layers paint on top.
  const moveLayer = (lid: string, dir: 1 | -1) => setLayers(view, ls => {
    const i = ls.findIndex(l => l.id === lid), j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return ls;
    const next = [...ls]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  // A layer for a design on a side, at that side's usual spot for it (a sleeve print keeps its sleeve spot).
  const newLayer = (d: Design, side: View, at?: { x: number; y: number }): Layer => {
    const placement: Placement = d.placement === 'sleeve' ? 'sleeve' : side;
    const def = PLACEMENT_DEFAULTS[placement];
    const { h } = layerSize(def.widthCm, draft.bodyWidth, d.height / d.width);
    return { id: uid(), designId: d.id, widthCm: def.widthCm, rotation: 0, flip: false, opacity: 100,
      x: at ? Math.round(at.x) : def.x, y: at ? Math.round(at.y) : Math.round(PRINT_TOP[product.type][placement] + h / 2) };
  };
  const addDesign = (designId: string, at?: { x: number; y: number }) => {
    const d = byId[designId];
    if (!d) return;
    if (layers.length >= 20) return run(async () => { throw new Error('Up to 20 designs per side.'); });
    const l = newLayer(d, view, at); // it goes on the side you are looking at
    setLayers(view, ls => [...ls, l]);
    setSelected([l.id]);
  };
  // Several linked prints at once, each on the side it belongs to (front and sleeve prints on the front, back prints on the back). Ones already on the garment are skipped. One undo step.
  const addMany = (ds: Design[]) => {
    const have = new Set([...draft.views.front, ...draft.views.back].map(l => l.designId));
    const add: Record<View, Layer[]> = { front: [], back: [] };
    const fresh = ds.filter(d => !have.has(d.id));
    for (const d of fresh) { const side = PLACEMENT_DEFAULTS[d.placement].view; add[side].push(newLayer(d, side)); }
    if (!fresh.length) { toast('Those are already on the garment'); return; }
    if (VIEWS.some(v => draft.views[v].length + add[v].length > 20)) return run(async () => { throw new Error('Up to 20 designs per side.'); });
    edit(cur => ({ ...cur, views: { front: [...cur.views.front, ...add.front], back: [...cur.views.back, ...add.back] } }));
    const to: View = add.front.length ? 'front' : 'back';
    setView(to); setSelected(add[to].map(l => l.id));
    toast(fresh.length === 1 ? `Added ${fresh[0].title}` : `Added ${fresh.length} designs: ${fresh.map(d => SET_LABEL[d.placement]).join(', ')}`);
  };

  const recenter = () => {
    if (!layer) return;
    const d = byId[layer.designId];
    const placement: Placement = d?.placement === 'sleeve' ? 'sleeve' : view;
    const { h } = layerSize(layer.widthCm, draft.bodyWidth, designAspect[layer.designId] ?? 1);
    patchLayer(layer.id, { x: PLACEMENT_DEFAULTS[placement].x, y: Math.round(PRINT_TOP[product.type][placement] + h / 2), rotation: 0 });
  };

  // Another color keeps everything. Another style takes that style's usual body width, and the prints keep their distance from where prints start on that garment type (necklines and hoods sit at different heights).
  // The sleeve prints of this side go on the other side too: same size, fitted to that photo's sleeves. Prints of the same designs that are already there are replaced, so it can be repeated.
  const copySleeves = () => run(async () => {
    if (!draftRef.current || !product) return;
    const to: View = view === 'front' ? 'back' : 'front';
    if (!draftRef.current.views[view].some(isSleevePrint)) throw new Error(`There are no sleeve prints on the ${view} yet.`);
    setCopying(true);
    try {
      const [from, onto] = await Promise.all([outlineOf(product.masks[view]), outlineOf(product.masks[to])]);
      const cur = draftRef.current; // read again: the draft may have changed while the photos loaded
      if (!cur) return;
      const sleeves = cur.views[view].filter(isSleevePrint);
      const copies = sleeves.map(l => ({ ...(from && onto ? followSleeve(l, layerSize(l.widthCm, cur.bodyWidth, designAspect[l.designId] ?? 1), from, onto) : l), id: uid(), flip: !l.flip })); // mirrored, as the other sleeve of the pair
      const same = new Set(sleeves.map(l => l.designId));
      const kept = cur.views[to].filter(l => !(isSleevePrint(l) && same.has(l.designId)));
      if (kept.length + copies.length > 20) throw new Error(`The ${to} would have more than 20 designs.`);
      edit(d => ({ ...d, views: { ...d.views, [to]: [...kept, ...copies] } }));
      setView(to); setSelected([]);
      toast(`${plural(copies.length, 'sleeve print')} copied to the ${to}, flipped${from && onto ? '' : ' (their photos could not be read, so check the position)'}`);
    } finally { setCopying(false); }
  });

  const looked = look ? byId[look] : undefined;
  const lookAt = looked ? tray.findIndex(d => d.id === looked.id) : -1;
  const lookMates = looked ? matesOf(sets, looked) : [];
  const layerDesign = layer ? byId[layer.designId] : undefined;
  const layerMates = layerDesign ? matesOf(sets, layerDesign) : [];
  const placedIds = new Set([...draft.views.front, ...draft.views.back].map(l => l.designId));

  const switchGarment = (pid: string) => {
    const to = products.find(x => x.id === pid);
    if (!to || !product || pid === draft.productId) return;
    const label = (p: Product) => `${p.color} ${p.style}`;
    edit(d => ({
      ...d, productId: pid,
      bodyWidth: product.style === to.style ? d.bodyWidth : to.defaultBodyWidth,
      views: refitViews(d.views, product.type, to.type, did => byId[did]?.placement),
      name: d.name === label(product) ? label(to) : d.name.endsWith(` — ${label(product)}`) ? `${d.name.slice(0, -label(product).length)}${label(to)}` : d.name, // a name made from the garment follows it: the default "Color Style" and "<designs> — Color Style"
    }));
  };

  const doSave = async () => {
    if (save.isPending) return;
    const seq = editSeq.current;
    const out = await save.mutateAsync(draftRef.current!);
    // Seed from the PUT response unless the user kept editing while it saved.
    if (editSeq.current === seq) { seed(out, true); setDirtyBoth(false); }
    else { seeded.current = `${out.id}:${out.updatedAt}`; savedJson.current = JSON.stringify(toDraft(out)); setDirtyBoth(JSON.stringify(draftRef.current) !== savedJson.current); }
    return out;
  };
  // "Save as new" makes the draft a new mockup and leaves this one as it was last saved, so you can keep choosing designs here without replacing what you saved.
  // A name made from the garment becomes "<designs> — <garment>" (like Quick mockups); a name you changed is kept as it is.
  const copyName = (d: Draft) => {
    if (!product || d.name !== mockup?.name) return d.name;
    const label = `${product.color} ${product.style}`;
    if (d.name !== label && !d.name.endsWith(` — ${label}`)) return `${d.name} (copy)`;
    const titles = [...new Set([...d.views.front, ...d.views.back].map(l => byId[l.designId]?.title).filter((t): t is string => !!t))].map(t => (t.length > 32 ? `${t.slice(0, 31)}…` : t));
    return titles.length ? `${titles.slice(0, 3).join(' + ')}${titles.length > 3 ? ` + ${titles.length - 3} more` : ''} — ${label}` : d.name;
  };
  const doSaveNew = async () => {
    const cur = draftRef.current;
    if (!cur || saveNew.isPending) return;
    const out = await saveNew.mutateAsync({ ...cur, name: copyName(cur) });
    setCopied({ id: out.id, json: JSON.stringify(cur) });
    toast(`Saved as a new mockup: ${out.name}`, false, { label: 'Open', run: () => nav(`/mockups/${out.id}`) });
  };
  actions.current = {
    save: () => { if (dirtyRef.current && !save.isPending && !dialogOpen()) run(doSave, 'Saved and rendered'); },
    saveNew: () => { if (!saveNew.isPending && !dialogOpen()) run(doSaveNew); },
    remove: () => removeSelected(), deselect: () => setSelected([]), selectAll: () => setSelected(layers.map(l => l.id)),
    undo: () => travel('past'), redo: () => travel('future'),
  };

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow"><Link to="/mockups">Mockups</Link> / editor · <span className="kiro">♥ by Kiro</span></div>
          <h1 className="sr-only">Mockup editor: {draft.name}</h1>
          <input className="input" {...fieldText} style={{ fontFamily: 'Inter', fontSize: 22, fontWeight: 600, border: 0, padding: '4px 0', background: 'transparent', maxWidth: 640 }}
            value={draft.name} onChange={e => edit(d => ({ ...d, name: e.target.value }), 'name')} aria-label="Mockup name" />
        </div>
        <div className="row">
          {safeCopy && copied ? <span className="save-state"><span aria-hidden="true">✓</span> Saved as a new mockup · <Link to={`/mockups/${copied.id}`}>Open it</Link></span>
            : dirty ? <span className="badge warn">Unsaved changes</span> : <span className="save-state"><span aria-hidden="true">✓</span> All changes saved</span>}
          <button className="btn" onClick={() => setCloneOpen(true)} title="Copy this placement to other colors or other garments">Apply to more products</button>
          <button className="btn" onClick={() => run(async () => { if (dirty) await doSave(); nav(`/shoots?mockups=${id}`); })} title={dirty ? 'Saves first, then opens Photo shoots with this mockup' : 'Make photos of this mockup'}>Photo shoots →</button>
          <button className="btn" disabled={saveNew.isPending} title="Save this as a new mockup. This one stays as it was last saved, so you can keep choosing designs here (Shift+Cmd/Ctrl+S)" onClick={() => run(doSaveNew)}>{saveNew.isPending ? 'Saving…' : 'Save as new'}</button>
          <button className="btn primary" disabled={save.isPending} title="Save and render (Cmd/Ctrl+S)" onClick={() => run(doSave, 'Saved and rendered')}>{save.isPending ? 'Rendering…' : 'Save & render'}</button>
        </div>
      </div>

      <div className="editor">
        <div className="panel stack" style={{ gap: 12 }}>
          <div className="panel-title" style={{ marginBottom: 0 }}><h2 className="h-sm">Designs</h2><Link className="btn ghost sm" to="/generate">+ New</Link></div>
          <select className="select" value={trayFilter} onChange={e => setTrayFilter(e.target.value as typeof trayFilter)} aria-label="Filter designs">
            <option value="all">All designs</option><option value="approved">Approved</option>
            <option value="front">Front prints</option><option value="back">Back prints</option><option value="sleeve">Sleeve prints</option><option value="linked">Linked sets</option>
          </select>
          <p className="hint"><span className="desk">Drag onto the garment, or click to place at the default spot.</span><span className="touch">Tap a design to place it on the garment.</span></p>
          <div className="design-tray">
            {tray.map(d => {
              const color = setColor(d), linked = matesText(d); // a linked print wears its set's colour and says which print it is
              const set = (d.setId && sets.members[d.setId]) || [d], done = set.every(m => placedIds.has(m.id)), names = set.map(m => SET_LABEL[m.placement]).join(', ');
              const hot = !!color && (d.setId === hotSet || (!!d.setId && selSets.has(d.setId)));
              return (
                <div key={d.id} className={`tray-cell${color ? ' linked' : ''}${hot ? ' hot' : ''}`} style={color ? ({ '--set': color } as CSSProperties) : undefined}
                  onMouseEnter={color ? () => setHotSet(d.setId) : undefined} onMouseLeave={color ? () => setHotSet(null) : undefined}>
                  <button className="tray-item" draggable title={`${d.title} — drag onto the garment, or click to place${linked ? `\nLinked with ${linked}` : ''}`} aria-label={`Place ${d.title} on the ${view}${linked ? `. Linked with ${linked}` : ''}`}
                    onDragStart={e => { e.dataTransfer.setData('application/x-design', d.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => addDesign(d.id)}>
                    <img src={d.thumbUrl} alt="" width={d.width} height={d.height} loading="lazy" decoding="async" />
                  </button>
                  {color && <span className="tray-link" aria-hidden="true"><LinkIcon />{SET_LABEL[d.placement]}</span>}
                  {color && set.length > 1 && (
                    <button className="tray-all" disabled={done} aria-label={`Put the whole set on the garment: ${names}`}
                      title={done ? 'The whole set is already on the garment' : `Put the whole set on the garment (${names}), each print on its own side`} onClick={() => addMany(set)}><SetIcon /></button>
                  )}
                  <button className="tray-eye" aria-label={`Look closer at ${d.title}`} title="Look closer: zoom in to check the details" onClick={() => setLook(d.id)}><EyeIcon /></button>
                </div>
              );
            })}
            {!tray.length && <p className="hint">No designs here yet.</p>}
          </div>
        </div>

        <div className="stage">
          <div className="row stage-bar" style={{ marginBottom: 10 }}>
            <div className="seg" role="group" aria-label="Side of the garment">{VIEWS.map(v => <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => { setView(v); setSelected([]); }}>{v === 'front' ? 'Front' : 'Back'} · {draft.views[v].length}</button>)}</div>
            <div className="hist">
              <button className="btn sm" disabled={!canUndo} aria-label="Undo" title={canUndo ? 'Undo (Cmd/Ctrl+Z)' : 'Nothing to undo yet'} onClick={() => travel('past')}>↶<span className="desk"> Undo</span></button>
              <button className="btn sm" disabled={!canRedo} aria-label="Redo" title={canRedo ? 'Redo (Shift+Cmd/Ctrl+Z)' : 'Nothing to redo'} onClick={() => travel('future')}>↷<span className="desk"> Redo</span></button>
            </div>
            {layers.some(isSleevePrint) && (
              <button className="btn sm" disabled={copying} title={`Put these sleeve prints on the ${view === 'front' ? 'back' : 'front'} too: same size, flipped, fitted to that photo's sleeves`} onClick={copySleeves}>
                {copying ? 'Copying…' : <><span className="desk">Copy sleeves to </span><span className="touch">Sleeves → </span>{view === 'front' ? 'Back' : 'Front'}</>}
              </button>
            )}
            <span className="spacer" />
            {(guideSets[view].v.length > 0 || guideSets[view].h.length > 0) && <button className="btn ghost sm" title="Remove every guide line on this side" onClick={() => setViewGuides(view, NO_GUIDES)}>Clear guides</button>}
            <button className="btn ghost sm" aria-pressed={snapOn} title="Designs snap to guide lines, the center line and each other while you move them. Hold Alt to move freely." onClick={toggleSnap}>Snap: {snapOn ? 'on' : 'off'}</button>
            <button className="btn ghost sm" aria-pressed={centerLine} title="A dashed line down the middle of the garment, to line a design up" onClick={() => setCenterLine(g => !g)}>{centerLine ? 'Hide' : 'Show'} center line</button>
          </div>
          <MockupCanvas photo={product.images[view]} mask={product.masks[view]} layers={layers} designUrls={designUrls} designAspect={designAspect}
            bodyWidth={draft.bodyWidth} selected={selected} onSelect={setSelected} onChange={patchLayer} onMove={moveLayers} onDropDesign={(did, x, y) => addDesign(did, { x, y })}
            centerLine={centerLine} guides={guideSets[view]} onGuides={g => setViewGuides(view, g)} snap={snapOn} />
          {/* phones: the page header scrolls away, so unsaved changes get a Save button pinned to the canvas */}
          {dirty && <>
            <button className="btn fab fab-new" disabled={saveNew.isPending} onClick={() => run(doSaveNew)}>{saveNew.isPending ? 'Saving…' : 'Save as new'}</button>
            <button className="btn lime fab" disabled={save.isPending} onClick={() => run(doSave, 'Saved and rendered')}>{save.isPending ? 'Rendering…' : 'Save & render'}</button>
          </>}
          <p className="hint" style={{ marginTop: 10 }}>Drag to move · corner square to resize · circle to rotate · Shift-click or drag a box to select several · drag from the rulers for guide lines. Press ? for all shortcuts. The saved render adds fabric shading.</p>
          {mockup && (mockup.renders.front || mockup.renders.back) && (
            <div className="row renders" style={{ marginTop: 8 }}>
              <span className="hint">Saved renders:</span>
              {mockup.renders.front && <a className="btn ghost sm" href={mockup.renders.front} target="_blank" rel="noreferrer">Front ↗</a>}
              {mockup.renders.back && <a className="btn ghost sm" href={mockup.renders.back} target="_blank" rel="noreferrer">Back ↗</a>}
            </div>
          )}
        </div>

        <div className="inspector stack">
          <div className="panel stack" style={{ gap: 14 }}>
            <h2 className="h-sm">{sel.length > 1 ? `${sel.length} designs selected` : layer ? byId[layer.designId]?.title ?? 'Design' : 'Placement'}</h2>
            {sel.length > 1 ? (
              <>
                <Nudge className="touch" onMove={nudgeSelected} />
                <div className="field"><span>Align</span>
                  <div className="align-row" role="group" aria-label="Align the selected designs, left to right">
                    {([['left', 'Left', 'Line up their left edges'], ['center', 'Center', 'Line up their middles, left to right'], ['right', 'Right', 'Line up their right edges']] as const).map(([kind, label, tip]) => <button key={kind} className="btn sm" title={tip} onClick={() => alignSelected(kind)}>{label}</button>)}
                  </div>
                  <div className="align-row" role="group" aria-label="Align the selected designs, top to bottom">
                    {([['top', 'Top', 'Line up their top edges'], ['middle', 'Middle', 'Line up their middles, top to bottom'], ['bottom', 'Bottom', 'Line up their bottom edges']] as const).map(([kind, label, tip]) => <button key={kind} className="btn sm" title={tip} onClick={() => alignSelected(kind)}>{label}</button>)}
                  </div>
                </div>
                {sel.length > 2 && (
                  <div className="field"><span>Space evenly</span>
                    <div className="align-row two"><button className="btn sm" title="Equal gaps from the leftmost to the rightmost" onClick={() => spreadSelected('x')}>Across</button><button className="btn sm" title="Equal gaps from the top one to the bottom one" onClick={() => spreadSelected('y')}>Down</button></div>
                  </div>
                )}
                <div className="row">
                  <button className="btn sm" title="Mirror every selected design" onClick={flipSelected}>Flip</button>
                  <button className="btn sm danger" title="Remove the selected designs (Del). Undo brings them back." onClick={removeSelected}>Remove</button>
                  <button className="btn sm ghost" onClick={() => setSelected([])}>Select none</button>
                </div>
                <p className="hint">Aligns to the edges of the whole selection. Shift-click a design to add it or take it out.</p>
              </>
            ) : !layer ? <p className="hint">Select a design on the garment to adjust it. Shift-click, or drag a box round several, to select more.<span className="touch"> Drag it to move, the corner square to resize, the circle to rotate.</span></p> : (
              <>
                <Nudge className="touch" onMove={(dx, dy) => patchLayer(layer.id, { x: layer.x + dx, y: layer.y + dy })} />
                <div className="field"><span>Width (cm)</span>
                  <div className="slider-row"><input type="range" min={1} max={60} step={0.5} value={layer.widthCm} aria-label="Width slider" onChange={e => patchLayer(layer.id, { widthCm: +e.target.value })} />
                    <input className="input" {...fieldNumber} type="number" min={1} max={60} step={0.5} value={layer.widthCm} onChange={e => patchLayer(layer.id, { widthCm: Math.min(60, Math.max(1, +e.target.value || 1)) })} aria-label="Width in cm" /></div>
                </div>
                <div className="field"><span>Rotation (°)</span>
                  <div className="slider-row"><input type="range" min={-180} max={180} value={layer.rotation} aria-label="Rotation slider" onChange={e => patchLayer(layer.id, { rotation: +e.target.value })} />
                    <input className="input" autoComplete="off" enterKeyHint="done" type="number" min={-180} max={180} value={layer.rotation} onChange={e => patchLayer(layer.id, { rotation: Math.min(180, Math.max(-180, +e.target.value || 0)) })} aria-label="Rotation" /></div>
                </div>
                <div className="field"><span>Opacity (%)</span>
                  <div className="slider-row"><input type="range" min={5} max={100} value={layer.opacity} aria-label="Opacity" onChange={e => patchLayer(layer.id, { opacity: +e.target.value })} /><span className="hint">{layer.opacity}%</span></div>
                </div>
                <div className="row">
                  <button className="btn sm" title="Back to this design's default spot, upright" onClick={recenter}>Reset position</button>
                  <button className="btn sm" title="Line the design up with the middle of the garment" onClick={() => patchLayer(layer.id, { x: 512 })}>Center horizontally</button>
                  <button className="btn sm" title="Mirror the design" onClick={() => patchLayer(layer.id, { flip: !layer.flip })}>Flip</button>
                  <button className="btn sm" title="Make a copy a little lower and to the right" onClick={() => { const c = { ...layer, id: uid(), x: layer.x + 30, y: layer.y + 30 }; setLayers(view, ls => [...ls, c]); setSelected([c.id]); }}>Duplicate</button>
                  <button className="btn sm danger" title="Remove from this mockup (Del). Undo brings it back." onClick={() => { setLayers(view, ls => ls.filter(l => l.id !== layer.id)); setSelected([]); }}>Remove</button>
                </div>
                {layerMates.length > 0 && (
                  <div className="field linked-box" style={{ '--set': setColor(layerDesign) } as CSSProperties}>
                    <span className="linked-title"><LinkIcon /> Linked with</span>
                    {layerMates.map(m => {
                      const side = PLACEMENT_DEFAULTS[m.placement].view, on = placedIds.has(m.id);
                      return (
                        <div key={m.id} className="mate-row">
                          <img src={m.thumbUrl} alt="" loading="lazy" decoding="async" />
                          <span className="lname"><b>{SET_LABEL[m.placement]}</b> · {m.title}</span>
                          <button className="btn sm" disabled={on} title={on ? 'Already on this garment' : `Put it on the ${side} at its usual spot`} onClick={() => addMany([m])}>{on ? 'Added' : 'Add'}</button>
                        </div>
                      );
                    })}
                    {layerMates.filter(m => !placedIds.has(m.id)).length > 1 && <button className="btn sm" onClick={() => addMany(layerMates)}>Add them all</button>}
                  </div>
                )}
              </>
            )}
            {layers.length > 0 && (
              <div className="layer-list">
                <div className="row"><span className="label">On the {view}</span><span className="spacer" />
                  {layers.length > 1 && <button className="btn ghost sm" title="Select every design on this side (Cmd/Ctrl+A)" onClick={() => setSelected(sel.length === layers.length ? [] : layers.map(l => l.id))}>{sel.length === layers.length ? 'Select none' : 'Select all'}</button>}
                </div>
                {[...layers].reverse().map(l => (
                  <div key={l.id} className="layer-row">
                    <label className="layer-pick" title="Add to the selection"><input type="checkbox" checked={selected.includes(l.id)} aria-label={`Select ${byId[l.designId]?.title ?? 'design'}`} onChange={() => pickRow(l.id, { shiftKey: true, metaKey: false, ctrlKey: false })} /></label>
                    <button className={`layer-item${selected.includes(l.id) ? ' on' : ''}`} aria-pressed={selected.includes(l.id)} title={byId[l.designId]?.title} onClick={e => pickRow(l.id, e)}>
                      {byId[l.designId] && <img src={byId[l.designId].thumbUrl} alt="" loading="lazy" decoding="async" />}<span className="lname">{byId[l.designId]?.title ?? 'Missing design'}</span>
                      {setColor(byId[l.designId]) && <span className="layer-link" style={{ '--set': setColor(byId[l.designId]) } as CSSProperties} title={`Linked with ${matesText(byId[l.designId])}`}><LinkIcon /></span>}
                      <span className="spacer" /><span className="hint">{l.widthCm} cm</span>
                    </button>
                    {layer?.id === l.id && (
                      <div className="layer-move">
                        <button className="btn sm" aria-label="Bring forward" title="Bring forward" disabled={l.id === layers[layers.length - 1].id} onClick={() => moveLayer(l.id, 1)}>▲</button>
                        <button className="btn sm" aria-label="Send backward" title="Send backward" disabled={l.id === layers[0].id} onClick={() => moveLayer(l.id, -1)}>▼</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {mockup && (mockup.renders.front || mockup.renders.back) && (
              <div className="touch"><div className="row">
                <span className="hint">Saved renders:</span>
                {mockup.renders.front && <a className="btn ghost sm" href={mockup.renders.front} target="_blank" rel="noreferrer">Front ↗</a>}
                {mockup.renders.back && <a className="btn ghost sm" href={mockup.renders.back} target="_blank" rel="noreferrer">Back ↗</a>}
              </div></div>
            )}
          </div>

          <div className="panel stack" style={{ gap: 12 }}>
            <h2 className="h-sm">Garment</h2>
            <ProductPicker value={[draft.productId]} multiple={false} onChange={([pid]) => switchGarment(pid)} />
            <p className="hint">Any garment works. Another color stays in this product; another style moves this mockup to that style's product when you save.</p>
            <label className="field"><span>Body width (cm)</span>
              <input className="input" {...fieldNumber} type="number" min={30} max={100} step={0.5} value={draft.bodyWidth}
                onChange={e => edit(d => ({ ...d, bodyWidth: Math.min(100, Math.max(30, +e.target.value || product.defaultBodyWidth)) }), 'bodyWidth')} />
              <span className="hint">Measure the real garment flat, armpit to armpit. Print sizes in cm are based on it.</span>
            </label>
          </div>
          <button className="btn danger" onClick={async () => (await ask({ title: 'Delete this mockup?', body: `“${draft.name}” and its renders are removed${myShoots.length ? `, and so ${myShoots.length === 1 ? 'is its photo' : `are its ${myShoots.length} photos`}` : ''}. The designs stay in your library.`, confirm: 'Delete mockup', danger: true })) && run(async () => { await del.mutateAsync(); setDirtyBoth(false); nav('/mockups'); }, 'Mockup deleted')}>Delete mockup</button>
        </div>
      </div>

      {looked && (
        <ZoomViewer src={looked.url} preview={looked.thumbUrl} width={looked.width} height={looked.height} title={looked.title}
          meta={<>
            <span>{looked.width} × {looked.height} px</span>
            <span>{looked.placement[0].toUpperCase() + looked.placement.slice(1)} print</span>
            {!looked.transparent && <span className="badge warn" title="This would print with a background box">Not transparent</span>}
            {lookAt >= 0 && <span>{lookAt + 1} of {tray.length}</span>}
            {lookMates.length > 0 && <span className="look-linked"><LinkIcon /> Linked:{lookMates.map(m => <button key={m.id} className="look-chip" title={`Look at the ${m.placement} print`} onClick={() => setLook(m.id)}>{SET_LABEL[m.placement]} · {m.title}</button>)}</span>}
          </>}
          onClose={() => setLook(null)}
          onPrev={lookAt > 0 ? () => setLook(tray[lookAt - 1].id) : undefined}
          onNext={lookAt >= 0 && lookAt < tray.length - 1 ? () => setLook(tray[lookAt + 1].id) : undefined}
          actions={<>
            {lookMates.length > 0 && <button className="btn sm" title="Put this print and the ones linked with it on the garment, each on its own side" onClick={() => { addMany((looked.setId && sets.members[looked.setId]) || [looked]); setLook(null); }}>Place the whole set</button>}
            <button className="btn primary sm" onClick={() => { addDesign(looked.id); setLook(null); }}>Place on the garment</button>
          </>} />
      )}
      {cloneOpen && <CloneColors mockupId={id!} type={product.type} current={draft.productId} beforeClone={dirty ? doSave : undefined} onClose={() => setCloneOpen(false)} />}
      {blocker.state === 'blocked' && (
        <Modal title="Leave without saving?" onClose={() => blocker.reset()}>
          <div className="stack">
            <p className="confirm-body">You changed “{draft.name}” since the last save. Leaving now throws those changes away.</p>
            <div className="row"><span className="spacer" />
              <button className="btn" data-autofocus onClick={() => blocker.reset()}>Keep editing</button>
              <button className="btn danger" onClick={() => blocker.proceed()}>Leave without saving</button>
              <button className="btn primary" disabled={save.isPending} onClick={() => run(async () => { await doSave(); blocker.proceed(); })}>{save.isPending ? 'Rendering…' : 'Save & leave'}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function CloneColors({ mockupId, type, current, beforeClone, onClose }: { mockupId: string; type: Product['type']; current: string; beforeClone?: () => Promise<unknown>; onClose: () => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const run = useRun();
  const nav = useNavigate();
  const clone = useAction((productIds: string[]) => api.post<Mockup[]>(`/mockups/${mockupId}/clone`, { productIds }), [['mockups']]);
  const chosen = ids.filter(i => i !== current);
  return (
    <Modal title="Apply this placement to more products" onClose={onClose} wide>
      <div className="stack">
        <p className="hint">Creates a new mockup per product with the same designs and sizes. On another type of garment, each print keeps its distance from the neckline.</p>
        <ProductPicker value={ids} onChange={setIds} initialType={type} />
        <div className="row"><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!chosen.length || clone.isPending} title={chosen.length ? undefined : 'Pick at least one other product first'}
            onClick={() => run(async () => { if (beforeClone) await beforeClone(); const out = await clone.mutateAsync(chosen); onClose(); nav('/mockups', { state: { flash: `${plural(out.length, 'mockup')} created. Select them to start a photo shoot.`, select: out.map(m => m.id) } }); })}>
            {clone.isPending ? 'Rendering…' : `Create ${plural(chosen.length, 'mockup')}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
