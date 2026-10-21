import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FRAMING_LABEL, RATIO_LABEL, SHOOT_FRAMINGS, SHOOT_RATIOS, SHOT_TEMPLATES, shotsFor, smallUrl, type Preset, type Shoot, type ShootFraming, type ShootRatio } from '../../shared/types.ts';
import { api, claude, useAction, useJobs, useListings, useMockups, usePresets, useShoots, type GenerateShootsRequest, type PrintCheckResult, type ShotIdea } from '../api.ts';
import { usePreload, useSelectionKeys } from '../components/a11y.ts';
import { PendingCard } from '../components/DesignCard.tsx';
import { GridSkeleton, QueryError } from '../components/states.tsx';
import { Drawer, Empty, FileButton, PaneSwitch, plural, timeAgo, useConfirm, useRun, useSelection } from '../components/ui.tsx';
import { Assist, SparkIcon } from '../components/Assist.tsx';
import { fieldSearch, fieldText } from '../components/fields.ts';
import { useUrlParams } from '../components/urlState.ts';
import { useRemembered } from '../components/remember.ts';

const DEFAULT_SHOTS = ['ecom-front', 'life-front'];
/** A big shoot can have hundreds of photos waiting: this many get a card on the Photos page (the ones being made first), the rest are counted. */
const PENDING_SHOWN = 60;

/** The course's content packs (daily, luxury, night out, product placement...), as themes for the brand: Claude plans a different set of lifestyle shots for each one you tick. */
const PACKS: { key: string; label: string; theme: string }[] = [
  { key: 'daily', label: 'Everyday Cairo', theme: 'an ordinary day in Cairo: streets, errands, a corner shop, public transport' },
  { key: 'cafe', label: 'Café & coffee', theme: 'cafés and coffee: a window table, a ahwa on the pavement, a rooftop café' },
  { key: 'night', label: 'Night out', theme: 'a night out in Cairo: street lights, a taxi, a late-night food cart, neon signs' },
  { key: 'golden', label: 'Rooftop & golden hour', theme: 'rooftops and low sun in the last hour of daylight' },
  { key: 'coast', label: 'Sinai & coast', theme: 'a trip to the Sinai or the north coast: sea, sand, a camp, an old pick-up' },
  { key: 'sport', label: 'Gym & sport', theme: 'movement and sport: a gym, a football pitch, a run along the Nile' },
  { key: 'gift', label: 'Gift & product placement', theme: 'the garment as a gift or product placement: unboxing, folded on a bed, held by the person at a door' },
  { key: 'editorial', label: 'Luxury editorial', theme: 'a quiet luxury fashion editorial: old stone, a museum hall, soft window light, few props' },
];

export function ShootsPage() {
  const [params] = useSearchParams();
  const { data: mockups = [] } = useMockups();
  const { data: models = [] } = usePresets('model');
  const { data: locations = [] } = usePresets('location');
  const { data: studios = [] } = usePresets('studio');
  const { data: styles = [] } = usePresets('style');
  const [mockupIds, setMockupIds] = useState<string[]>(() => (params.get('mockups') ?? '').split(',').filter(Boolean));
  // The choices you make every shoot are remembered in this browser (a model, backdrop or style deleted since is ignored).
  const [shots, setShots] = useRemembered<string[]>('shoot.shots', DEFAULT_SHOTS);
  const [modelPick, setModelId] = useRemembered('shoot.model', '');
  const [locationPick, setLocationId] = useRemembered('shoot.location', '');
  const [studioPick, setStudioIds] = useRemembered<string[]>('shoot.studios', []);
  const [stylePick, setStyleId] = useRemembered('shoot.style', '');
  const modelId = models.some(m => m.id === modelPick) ? modelPick : '';
  const locationId = locations.some(m => m.id === locationPick) ? locationPick : '';
  const styleId = styles.some(m => m.id === stylePick) ? stylePick : '';
  const studioIds = studioPick.filter(id => studios.some(m => m.id === id));
  const [notes, setNotes] = useState('');
  const [count, setCount] = useRemembered('shoot.count', 1);
  const [ratio, setRatio] = useRemembered<ShootRatio>('shoot.ratio', '4:5');
  const [framing, setFraming] = useRemembered<ShootFraming>('shoot.framing', 'medium');
  const [urlParams, setUrlParams] = useUrlParams(); // the photo filters live in the address, so a refresh keeps them
  const kind = (['ecom', 'lifestyle'].includes(urlParams.get('kind') ?? '') ? urlParams.get('kind') : '') as '' | 'ecom' | 'lifestyle';
  const favorites = urlParams.get('fav') === '1';
  const modelFilter = urlParams.get('model') || ''; // a model's feed: every photo made with this model
  const [open, setOpen] = useState<Shoot | null>(null);
  const [pane, setPane] = useState(params.get('mockups') ? 0 : 1); // phones show the form or the photos, one at a time
  const run = useRun();
  const ask = useConfirm();
  const sel = useSelection();

  const { data: shoots = [], isPending: shootsLoading, isError: shootsFailed, error: shootsError, refetch: refetchShoots } = useShoots({ kind: kind || undefined, model: modelFilter || undefined, favorite: favorites });
  const { data: active = [] } = useJobs('active');
  const pending = active.filter(j => j.type === 'shoot');
  const pendingShown = [...pending.filter(j => j.status === 'running'), ...pending.filter(j => j.status !== 'running')].slice(0, PENDING_SHOWN);
  const generate = useAction((body: GenerateShootsRequest) => api.post<{ jobIds: string[]; skipped: number }>('/shoots/generate', body), [['shoots']]);
  const { data: listings = [] } = useListings();
  const listingName = useMemo(() => Object.fromEntries(listings.map(l => [l.id, l.title])), [listings]);
  const groups = useMemo(() => {
    const g = new Map<string, Shoot[]>();
    for (const s of shoots) { const k = s.listingId ?? ''; g.set(k, [...(g.get(k) ?? []), s]); }
    return [...g.entries()];
  }, [shoots]);
  const { data: everyShoot = [] } = useShoots();
  const photoCount = useMemo(() => { const m: Record<string, number> = {}; for (const x of everyShoot) m[x.mockupId] = (m[x.mockupId] ?? 0) + 1; return m; }, [everyShoot]);
  const [pickQ, setPickQ] = useState('');
  const pickable = useMemo(() => { const t = pickQ.trim().toLowerCase(); return t ? mockups.filter(m => m.name.toLowerCase().includes(t)) : mockups; }, [mockups, pickQ]);
  const untouched = useMemo(() => pickable.filter(m => !photoCount[m.id]), [pickable, photoCount]);
  const mockupName = useMemo(() => Object.fromEntries(mockups.map(m => [m.id, m.name])), [mockups]);
  // The viewer steps through the photos in the order they appear on screen (grouped by product).
  const ordered = useMemo(() => groups.flatMap(([, list]) => list), [groups]);
  const shown = open ? ordered.find(s => s.id === open.id) ?? open : null; // the live copy, so a caption written in the viewer shows at once
  const at = open ? ordered.findIndex(s => s.id === open.id) : -1;
  const prev = at > 0 ? ordered[at - 1] : undefined, next = at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : undefined;
  usePreload([prev?.url, next?.url]);
  const orderedIds = useMemo(() => ordered.map(s => s.id), [ordered]);
  useSelectionKeys(sel, orderedIds); // Esc clears, Cmd/Ctrl+A selects every photo shown
  const bulk = useAction((body: { ids?: string[]; batch?: string; action: string }) => api.post('/shoots/bulk', body), [['shoots'], ['listings'], ['listing']]);
  const removePhotos = async (ids: string[], title: string) => {
    if (!ids.length || !(await ask({ title, body: 'The photos are removed from their shoots and from the product galleries. This can’t be undone.', confirm: ids.length === 1 ? 'Delete photo' : `Delete ${ids.length} photos`, danger: true }))) return;
    await run(async () => { await bulk.mutateAsync({ ids, action: 'delete' }); sel.clear(); if (open && ids.includes(open.id)) setOpen(null); }, `${plural(ids.length, 'photo')} deleted`);
  };
  const selectGroup = (list: Shoot[]) => {
    const inGroup = new Set(list.map(s => s.id));
    sel.set(list.every(s => sel.has(s.id)) ? sel.list.filter(id => !inGroup.has(id)) : [...new Set([...sel.list, ...inGroup])]);
  };

  const chosen = mockups.filter(m => mockupIds.includes(m.id));
  const tasks = chosen.reduce((n, m) => n + shotsFor(SHOT_TEMPLATES.filter(t => shots.includes(t.key)), m.renders, m.views).reduce((k, t) => k + (t.usesStudio ? Math.max(1, studioIds.length) : 1), 0) * count, 0);
  const why = !chosen.length ? 'Choose at least one mockup' : !shots.length ? 'Choose at least one shot' : !tasks ? (() => { const sides = [...new Set(chosen.flatMap(m => (['front', 'back'] as const).filter(v => m.renders[v])))]; return sides.length === 1 ? `These mockups only have a ${sides[0]} print: choose a ${sides[0]} shot` : 'These mockups have no side the chosen shots need'; })() : '';
  const needsModel = SHOT_TEMPLATES.some(t => shots.includes(t.key) && t.usesModel);
  const needsLocation = SHOT_TEMPLATES.some(t => shots.includes(t.key) && t.usesLocation);
  const needsStudio = SHOT_TEMPLATES.some(t => shots.includes(t.key) && t.usesStudio);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const submit = () => run(async () => {
    const out = await generate.mutateAsync({ mockupIds, shots, modelId: modelId || null, locationId: locationId || null, studioIds, styleId: styleId || null, notes, count, ratio, framing });
    setPane(1);
    return out;
  }, `${plural(tasks, 'photo')} queued — about 2 minutes each`);

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Step 3 · <span className="kiro">another Kiro masterpiece</span></div><h1>Photo shoots</h1><p>E-commerce and lifestyle photos made by Codex from your mockups. The print is kept exactly as designed.</p></div>
        <Link className="btn" to="/presets">Manage models & locations</Link>
      </div>
      <PaneSwitch value={pane} onChange={setPane} items={[[0, 'New shoot'], [1, `Photos${pending.length ? ` · ${pending.length} in progress` : ''}`]]} />
      <div className="split" data-pane={pane}>
        <div className="panel stack">
          <div className="field">
            <span>Mockups <span className="hint">— {mockupIds.length} selected{mockupIds.length > 0 && <> · <button className="btn ghost sm" onClick={() => setMockupIds([])}>clear</button></>}</span></span>
            {!mockups.length ? <p className="hint">No mockups yet. <Link to="/designs">Make some from your designs</Link>.</p> : (
              <>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <input className="input" style={{ flex: 1, minWidth: 140 }} {...fieldSearch} placeholder="Find a mockup or color" aria-label="Find a mockup" value={pickQ} onChange={e => setPickQ(e.target.value)} />
                  <button className="btn sm" title="Tick every mockup shown" onClick={() => setMockupIds(ids => [...new Set([...ids, ...pickable.map(m => m.id)])])}>Tick all{pickQ ? ' shown' : ''}</button>
                  {untouched.length > 0 && <button className="btn sm" title="Tick the mockups that have no photo yet" onClick={() => setMockupIds(ids => [...new Set([...ids, ...untouched.map(m => m.id)])])}>Without photos · {untouched.length}</button>}
                </div>
                <div className="grid sm pick-grid">
                  {pickable.map(m => (
                    <button key={m.id} className={`card${mockupIds.includes(m.id) ? ' selected' : ''}`} style={{ padding: 0 }} onClick={() => setMockupIds(ids => toggle(ids, m.id))} title={`${m.name}${photoCount[m.id] ? ` · ${plural(photoCount[m.id], 'photo')} already` : ' · no photos yet'}`} aria-pressed={mockupIds.includes(m.id)}>
                      <span className="select-box">{mockupIds.includes(m.id) ? '✓' : ''}</span>
                      <div className="media photo" style={{ pointerEvents: 'none' }}><img src={smallUrl(m.renders.front ?? m.renders.back)} alt="" loading="lazy" decoding="async" fetchPriority="low" /></div>
                      <div className="body" style={{ pointerEvents: 'none' }}><div className="hint" style={{ fontSize: 11, lineHeight: 1.25 }}>{photoCount[m.id] ? plural(photoCount[m.id], 'photo') : 'no photos'}</div></div>
                    </button>
                  ))}
                </div>
                {!pickable.length && <p className="hint">No mockup matches “{pickQ}”.</p>}
              </>
            )}
          </div>

          {(['ecom', 'lifestyle'] as const).map(k => (
            <div key={k} className="field">
              <span>{k === 'ecom' ? 'E-commerce shots' : 'Lifestyle shots'}</span>
              <div className="row" style={{ gap: 6 }}>
                {SHOT_TEMPLATES.filter(t => t.kind === k).map(t => (
                  <button key={t.key} className={`chip${shots.includes(t.key) ? ' on' : ''}`} onClick={() => setShots(s => toggle(s, t.key))} aria-pressed={shots.includes(t.key)}>{t.label}</button>
                ))}
              </div>
            </div>
          ))}

          {needsModel && <PresetPicker label="Model" presets={models} value={modelId} onChange={setModelId} auto="Codex picks"
            hint={modelId ? `Every photo of this shoot uses ${models.find(m => m.id === modelId)?.name}.` : "No model chosen: Codex invents a different person for every photo. Pick one to keep the same person across the whole collection."} />}
          {needsStudio && <MultiPresetPicker label="Studio backdrops" presets={studios} values={studioIds} onChange={setStudioIds} auto="Grey studio" addTo="/presets?kind=studio" hint="Tick one or several: each studio photo on a model is made once on every backdrop you tick. The photo of a backdrop keeps its colour exact." />}
          {needsLocation && <PresetPicker label="Location" presets={locations} value={locationId} onChange={setLocationId} auto="Cairo defaults" addTo="/presets?kind=location" hint="Without a saved location, each take gets a real Cairo place: a Zamalek street, an old lane, a rooftop or a café. Write a place with details (the hour, the light, worn materials) and it is used word for word." />}
          <PresetPicker label="Style & mood" presets={styles} value={styleId} onChange={setStyleId} auto="None" addTo="/presets?kind=style" />
          {SHOT_TEMPLATES.some(t => shots.includes(t.key) && t.kind === 'lifestyle') && (
            <div className="field"><span>Format of lifestyle photos</span>
              <div className="seg" role="group" aria-label="Picture shape">
                {SHOOT_RATIOS.map(r => <button key={r} className={ratio === r ? 'on' : ''} aria-pressed={ratio === r} onClick={() => setRatio(r)}>{RATIO_LABEL[r]}</button>)}
              </div>
              <span className="hint">E-commerce photos are always 4:5, the shape of the store's photos.</span>
            </div>
          )}
          {SHOT_TEMPLATES.some(t => shots.includes(t.key) && t.kind === 'lifestyle') && (
            <div className="field"><span>Framing of lifestyle photos</span>
              <div className="seg" role="group" aria-label="How much of the person">
                {SHOOT_FRAMINGS.map(f => <button key={f} className={framing === f ? 'on' : ''} aria-pressed={framing === f} onClick={() => setFraming(f)}>{FRAMING_LABEL[f]}</button>)}
              </div>
              <span className="hint">Medium is waist up. Full length shows head to toe, wide makes the place the star, close-up fills the frame with the print.</span>
            </div>
          )}
          <label className="field"><span>Art direction <span className="hint">— optional</span></span>
            <textarea className="textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. golden hour, warm film look, model laughing, wide jeans" />
          </label>
          <Assist field="shoot" value={notes} onChange={setNotes} />
          <ShotPlanner mockupIds={mockupIds} modelId={modelId} styleId={styleId} ratio={ratio} disabled={!mockupIds.length} onQueued={() => setPane(1)} />
          <div className="field"><span>Takes of each shot <b>{count}</b></span><input type="range" min={1} max={6} value={count} aria-label="Takes of each shot" onChange={e => setCount(+e.target.value)} /></div>
          <div className="row sticky-actions">
            <span className="hint">{why || `= ${plural(tasks, 'photo')}`}</span>
            <span className="spacer" />
            <button className="btn lime" disabled={!!why || generate.isPending} title={why || undefined} onClick={submit}>Shoot {plural(tasks, 'photo')}</button>
          </div>
        </div>

        <div>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Kind of photo">{([['', 'All'], ['ecom', 'E-commerce'], ['lifestyle', 'Lifestyle']] as const).map(([v, l]) => <button key={v} className={kind === v ? 'on' : ''} aria-pressed={kind === v} onClick={() => setUrlParams({ kind: v })}>{l}</button>)}</div>
            <button className={`chip${favorites ? ' on' : ''}`} aria-pressed={favorites} onClick={() => setUrlParams({ fav: !favorites })}>★ Favorites</button>
            {modelFilter && <button className="chip on" title="Show the photos of every model again" onClick={() => setUrlParams({ model: null })}>Model: {models.find(m => m.id === modelFilter)?.name ?? 'deleted'} ✕</button>}
          </div>
          {sel.size > 0 && (
            <div className="selection-bar">
              <strong>{sel.size} selected</strong><span className="spacer" />
              <button className="btn" title="Add the selected photos to your favorites" aria-label="Favorite selected" onClick={() => run(async () => { await bulk.mutateAsync({ ids: sel.list, action: 'favorite' }); sel.clear(); }, 'Added to favorites')}>★</button>
              <button className="btn danger" onClick={() => removePhotos(sel.list, `Delete ${plural(sel.size, 'photo')}?`)}>Delete</button>
              <button className="btn ghost" title="Clear the selection (Esc)" aria-label="Clear selection" onClick={sel.clear}>✕</button>
            </div>
          )}
          {shootsFailed && !shoots.length ? <QueryError what="your photos" error={shootsError} onRetry={() => refetchShoots()} />
            : shootsLoading ? <GridSkeleton kind="photo" count={8} />
            : !shoots.length && !pending.length ? (
            <Empty title={kind || favorites || modelFilter ? 'No photos match these filters' : 'No photos yet'} actions={kind || favorites || modelFilter ? <button className="btn" onClick={() => setUrlParams({ kind: null, fav: null, model: null })}>Clear filters</button> : undefined}>
              {kind || favorites || modelFilter ? 'Try another kind of photo, or turn off the filters.' : <>Pick mockups and shots <span className="desk">on the left</span><span className="touch">in “New shoot”</span>. Photos appear here as they finish.</>}
            </Empty>
          ) : (
            <div className="stack">
              {pending.length > 0 && <div className="grid">{pendingShown.map(j => <PendingCard key={j.id} job={j} />)}</div>}
              {pending.length > pendingShown.length && <p className="hint">{pending.length - pendingShown.length} more waiting in line · <Link to="/queue">See the queue</Link></p>}
              {groups.map(([lid, list]) => (
                <div key={lid || 'none'} className="stack" style={{ gap: 10 }}>
                  <div className="row">
                    <h2 className="h-sm" style={{ margin: 0 }}>{lid ? listingName[lid] ?? 'Product' : 'Not in a product'}</h2>
                    <span className="hint">{plural(list.length, 'photo')}</span><span className="spacer" />
                    <button className="btn sm" title="Select every photo of this product shown here" onClick={() => selectGroup(list)}>{list.every(s => sel.has(s.id)) ? 'Unselect' : 'Select all'}</button>
                    <button className="btn sm danger" title="Delete the photos shown for this product" onClick={() => removePhotos(list.map(s => s.id), lid ? `Delete ${plural(list.length, 'photo')} of “${listingName[lid] ?? 'this product'}”?` : `Delete these ${plural(list.length, 'photo')}?`)}>Delete photos</button>
                    {lid && <Link className="btn sm" to={`/products/${lid}`}>Open product →</Link>}
                  </div>
                  <div className="grid">
                    {list.map(s => (
                      <div key={s.id} className={`card${sel.has(s.id) ? ' selected' : ''}`}>
                        <button className="select-box" onClick={e => sel.pick(s.id, e.shiftKey, orderedIds)} aria-pressed={sel.has(s.id)} aria-label={`Select ${SHOT_TEMPLATES.find(t => t.key === s.shot)?.label ?? 'photo'}, ${(mockupName[s.mockupId] ?? '').split(' — ').pop()}`} title="Select (Shift-click selects a range)">{sel.has(s.id) ? '✓' : ''}</button>
                        <button className="media photo tall" onClick={() => setOpen(s)} aria-label={`Open ${SHOT_TEMPLATES.find(t => t.key === s.shot)?.label ?? 'photo'}, ${(mockupName[s.mockupId] ?? '').split(' — ').pop()}`}><img src={s.thumbUrl} alt="" loading="lazy" decoding="async" /></button>
                        <div className="body">
                          <div className="title">{SHOT_TEMPLATES.find(t => t.key === s.shot)?.label ?? s.shot}</div>
                          <div className="meta"><span className="hint" title={mockupName[s.mockupId]}>{(mockupName[s.mockupId] ?? '').split(' — ').pop()}</span>{/(^|\| )Fix:/.test(s.notes) && <span className="badge" title={`Edited from another photo: ${s.notes.split('Fix:').pop()?.trim()}`}>Fixed</span>}{s.favorite && <span>★</span>}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {shown && <ShootDrawer shoot={shown} mockupName={mockupName[shown.mockupId]} onClose={() => setOpen(null)}
        onPrev={prev && (() => setOpen(prev))} onNext={next && (() => setOpen(next))} position={at >= 0 ? `${at + 1} of ${ordered.length}` : undefined} />}
    </>
  );
}

function ShootDrawer({ shoot, mockupName, onClose, onPrev, onNext, position }: { shoot: Shoot; mockupName?: string; onClose: () => void; onPrev?: () => void; onNext?: () => void; position?: string }) {
  const run = useRun();
  const ask = useConfirm();
  const [fav, setFav] = useState(shoot.favorite);
  useEffect(() => setFav(shoot.favorite), [shoot.id, shoot.favorite]); // stepping to another photo shows that photo's own state
  const patch = useAction((favorite: boolean) => api.patch(`/shoots/${shoot.id}`, { favorite }), [['shoots']]);
  const del = useAction(() => api.del(`/shoots/${shoot.id}`), [['shoots'], ['listings'], ['listing']]);
  const { data: sameShoot = [] } = useShoots(shoot.batchId ? { batch: shoot.batchId } : { batch: '__none__' });
  const delShoot = useAction(() => api.post('/shoots/bulk', { batch: shoot.batchId, action: 'delete' }), [['shoots'], ['listings'], ['listing']]);
  const again = useAction(() => api.post('/shoots/generate', { mockupIds: [shoot.mockupId], shots: [shoot.shot], modelId: shoot.modelId, locationId: shoot.kind === 'ecom' ? null : shoot.locationId, studioId: shoot.kind === 'ecom' ? shoot.locationId : null, styleId: shoot.styleId, notes: shoot.notes, count: 1 }), [['shoots']]);
  const template = SHOT_TEMPLATES.find(t => t.key === shoot.shot);
  return (
    <Drawer onClose={onClose} onPrev={onPrev} onNext={onNext} position={position} label={template?.label ?? 'Photo'} photo viewer={<img src={shoot.url} alt={template?.label ?? 'Photo'} decoding="async" />}>
      <h2>{template?.label ?? shoot.shot}</h2>
      <div className="row">
        <button className={`btn sm${fav ? ' lime' : ''}`} aria-pressed={fav} onClick={() => { setFav(!fav); patch.mutate(!fav); }}>{fav ? '★ Favorite' : '☆ Favorite'}</button>
        <a className="btn sm" href={`/api/shoots/${shoot.id}/download`}>Download</a>
        <button className="btn sm" onClick={() => run(() => again.mutateAsync(), 'Another take queued')}>Shoot again</button>
      </div>
      <dl className="kv">
        {shoot.listingId && <><dt>Product</dt><dd><Link to={`/products/${shoot.listingId}`}>Open product</Link></dd></>}
        <dt>Mockup</dt><dd><Link to={`/mockups/${shoot.mockupId}`}>{mockupName ?? 'deleted'}</Link></dd>
        <dt>Type</dt><dd>{shoot.kind === 'ecom' ? 'E-commerce' : 'Lifestyle'}</dd>
        {shoot.notes && <><dt>Direction</dt><dd>{shoot.notes}</dd></>}
        <dt>Created</dt><dd>{timeAgo(shoot.createdAt)}</dd>
      </dl>
      <p className="hint">Check the print closely: AI can change small details. If it drifted, use “Shoot again”.</p>
      <QualityBox key={shoot.id} shoot={shoot} />
      <CaptionBox shoot={shoot} />
      <button className="btn danger" onClick={async () => (await ask({ title: 'Delete this photo?', body: 'It is removed from the shoot and from the product gallery. This can’t be undone.', confirm: 'Delete photo', danger: true })) && run(async () => { await del.mutateAsync(); (onNext ?? onPrev ?? onClose)(); }, 'Photo deleted')}>Delete photo</button>
      {sameShoot.length > 1 && (
        <button className="btn danger" onClick={async () => (await ask({ title: 'Delete the whole shoot?', body: `A shoot is everything one “Shoot” click made. All ${sameShoot.length} photos of this one are removed from the product galleries. This can’t be undone.`, confirm: `Delete ${sameShoot.length} photos`, danger: true })) && run(async () => { await delShoot.mutateAsync(); onClose(); }, 'Shoot deleted')}>Delete the whole shoot · {plural(sameShoot.length, 'photo')}</button>
      )}
    </Drawer>
  );
}

function PresetPicker({ label, presets, value, onChange, auto, hint, addTo = '/presets' }: { label: string; presets: Preset[]; value: string; onChange: (id: string) => void; auto: string; hint?: string; addTo?: string }) {
  return (
    <div className="field"><span>{label}</span>
      <div className="preset-pick">
        <button className={`preset-opt${value ? '' : ' on'}`} onClick={() => onChange('')} aria-pressed={!value}>
          <span className="pic none" style={{ fontSize: 22 }}>{auto === "None" ? "—" : "✦"}</span><span className="name">{auto}</span>
        </button>
        {presets.map(p => (
          <button key={p.id} className={`preset-opt${value === p.id ? ' on' : ''}`} onClick={() => onChange(p.id)} aria-pressed={value === p.id} title={p.description}>
            <span className="pic">{p.thumbUrl ? <img src={p.thumbUrl} alt="" loading="lazy" decoding="async" /> : <span className="none">No photo</span>}</span>
            <span className="name">{p.name}</span>
          </button>
        ))}
        <Link className="preset-opt add" to={addTo}><span className="pic none">+</span><span className="name">Add new</span></Link>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Like PresetPicker, but several can be ticked (studio backdrops: one photo on each). Nothing ticked means the default. */
function MultiPresetPicker({ label, presets, values, onChange, auto, hint, addTo }: { label: string; presets: Preset[]; values: string[]; onChange: (ids: string[]) => void; auto: string; hint?: string; addTo: string }) {
  return (
    <div className="field"><span>{label}{values.length > 1 && <b className="hint"> · {values.length} ticked</b>}</span>
      <div className="preset-pick">
        <button className={`preset-opt${values.length ? '' : ' on'}`} onClick={() => onChange([])} aria-pressed={!values.length}>
          <span className="pic none" style={{ fontSize: 22 }}>✦</span><span className="name">{auto}</span>
        </button>
        {presets.map(p => (
          <button key={p.id} className={`preset-opt${values.includes(p.id) ? ' on' : ''}`} onClick={() => onChange(values.includes(p.id) ? values.filter(x => x !== p.id) : [...values, p.id])} aria-pressed={values.includes(p.id)} title={p.description}>
            <span className="pic">{p.thumbUrl ? <img src={p.thumbUrl} alt="" loading="lazy" decoding="async" /> : <span className="none">No photo</span>}</span>
            <span className="name">{p.name}</span>
          </button>
        ))}
        <Link className="preset-opt add" to={addTo}><span className="pic none">+</span><span className="name">Add new</span></Link>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** The course's "AI chat sees the product and the model and writes the prompts": Claude looks at the chosen mockup (and model) and plans different lifestyle shots, each with its own written place and art direction. You edit, tick and shoot. */
function ShotPlanner({ mockupIds, modelId, styleId, ratio, disabled, onQueued }: { mockupIds: string[]; modelId: string; styleId: string; ratio: ShootRatio; disabled: boolean; onQueued: () => void }) {
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<string[]>([]);
  const [theme, setTheme] = useState('');
  const [howMany, setHowMany] = useState(5);
  const [same, setSame] = useState(false); // the camera course's coverage: one place and light, many camera setups
  const [ideas, setIdeas] = useState<(ShotIdea & { on: boolean })[]>([]);
  const plan = useAction(() => claude.ideas({ mockupIds, modelId: modelId || null, count: howMany, same, theme: [...PACKS.filter(p => packs.includes(p.key)).map(p => p.theme), theme.trim()].filter(Boolean).join('; ') || undefined }), []);
  const readPhoto = useAction((f: File) => claude.readPhoto(f), []);
  const queue = useAction(() => claude.runIdeas({ mockupIds, modelId: modelId || null, styleId: styleId || null, ratio, ideas: ideas.filter(i => i.on) }), [['shoots']]);
  const picked = ideas.filter(i => i.on).length;
  const edit = (at: number, patch: Partial<ShotIdea & { on: boolean }>) => setIdeas(list => list.map((x, i) => (i === at ? { ...x, ...patch } : x)));
  const lifestyle = SHOT_TEMPLATES.filter(t => t.usesLocation);

  return (
    <div className="planner">
      <button type="button" className="planner-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <SparkIcon /> <strong>Plan lifestyle shots with Claude</strong><span className="hint">Claude looks at the garment and the model and writes a different place and direction for each photo</span><span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="field"><span>Content packs <span className="hint">— pick any, or write your own theme</span></span>
            <div className="row" style={{ gap: 6 }}>
              {PACKS.map(p => <button key={p.key} type="button" className={`chip${packs.includes(p.key) ? ' on' : ''}`} aria-pressed={packs.includes(p.key)} onClick={() => setPacks(l => (l.includes(p.key) ? l.filter(x => x !== p.key) : [...l, p.key]))}>{p.label}</button>)}
            </div>
          </div>
          <input className="input" {...fieldText} value={theme} onChange={e => setTheme(e.target.value)} placeholder="Or your own theme: a wedding in Alexandria, first day of university…" aria-label="Your own theme" />
          <label className="check"><input type="checkbox" checked={same} onChange={e => setSame(e.target.checked)} /><span>One scene, many camera setups <span className="hint">— the same place and light in every photo, a different angle, lens and size for each, like a photographer covering a shoot</span></span></label>
          <div className="field"><span>Ideas <b>{howMany}</b></span><input type="range" min={2} max={8} value={howMany} aria-label="Number of ideas" onChange={e => setHowMany(+e.target.value)} /></div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" disabled={disabled || plan.isPending} title={disabled ? 'Choose a mockup first' : 'Takes about 30 to 60 seconds'}
              onClick={() => run(async () => { const out = await plan.mutateAsync(); setIdeas(out.ideas.map(i => ({ ...i, on: true }))); })}>
              <SparkIcon /> {plan.isPending ? 'Claude is planning…' : ideas.length ? 'Plan again' : 'Plan the shots'}
            </button>
            <FileButton className="btn" title="Claude reads a photo you like (Pinterest, say), breaks it into place, pose and camera, and adds it as one idea for your garment. The photo itself is not used or kept." disabled={readPhoto.isPending}
              onFiles={f => run(async () => {
                const r = await readPhoto.mutateAsync(f[0]);
                setIdeas(l => [...l, { title: 'From my photo', shot: 'life-front', size: 'medium', place: r.place, notes: `${r.pose} ${r.shot} ${r.look}`, on: true }]);
              }, 'Added as an idea. Check it, then shoot.')}>
              {readPhoto.isPending ? 'Reading the photo…' : 'Recreate a photo I like'}
            </FileButton>
          </div>
          {plan.isPending && <p className="hint">Claude is looking at the garment{modelId ? ' and the model' : ''}…</p>}
          {ideas.map((idea, at) => (
            <div key={at} className={`idea${idea.on ? ' on' : ''}`}>
              <div className="row" style={{ gap: 8 }}>
                <label className="check" style={{ alignItems: 'center' }}><input type="checkbox" checked={idea.on} onChange={e => edit(at, { on: e.target.checked })} aria-label={`Shoot ${idea.title}`} /><strong>{idea.title}</strong></label>
                <span className="spacer" />
                <select className="input" style={{ width: 'auto', minHeight: 32 }} value={idea.shot} onChange={e => edit(at, { shot: e.target.value })} aria-label="Shot">{lifestyle.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                <select className="input" style={{ width: 'auto', minHeight: 32 }} value={idea.size} onChange={e => edit(at, { size: e.target.value })} aria-label="Framing">{SHOOT_FRAMINGS.map(f => <option key={f} value={f}>{FRAMING_LABEL[f]}</option>)}</select>
              </div>
              <label className="field"><span className="hint">Place</span><textarea className="textarea" rows={3} value={idea.place} onChange={e => edit(at, { place: e.target.value })} style={{ fontSize: 13 }} /></label>
              <label className="field"><span className="hint">Direction</span><textarea className="textarea" rows={2} value={idea.notes} onChange={e => edit(at, { notes: e.target.value })} style={{ fontSize: 13 }} /></label>
            </div>
          ))}
          {ideas.length > 0 && (
            <button type="button" className="btn lime" disabled={!picked || queue.isPending || disabled}
              onClick={() => run(async () => { const out = await queue.mutateAsync(); onQueued(); return out; }, `${plural(picked * Math.max(1, mockupIds.length), 'photo')} queued, about 2 minutes each`)}>
              Shoot {plural(picked * Math.max(1, mockupIds.length), 'photo')} from these ideas
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A caption and hashtags for a photo (the course's Captions step), written by Claude from the photo itself and saved on it. */
function CaptionBox({ shoot }: { shoot: Shoot }) {
  const run = useRun();
  const [platform, setPlatform] = useState<'instagram' | 'tiktok'>('instagram');
  const [length, setLength] = useState<'short' | 'medium'>('medium');
  const [about, setAbout] = useState(''); // the course: add context so the caption has an angle
  const [text, setText] = useState(shoot.caption), [tags, setTags] = useState(shoot.hashtags.join(' '));
  useEffect(() => { setText(shoot.caption); setTags(shoot.hashtags.join(' ')); }, [shoot.id, shoot.caption, shoot.hashtags.join(' ')]); // stepping to another photo shows its own caption
  const write = useAction(() => claude.caption(shoot.id, { platform, length, context: about.trim() || undefined }), [['shoots']]);
  const save = useAction((body: { caption?: string; hashtags?: string[] }) => api.patch(`/shoots/${shoot.id}`, body), [['shoots']]);
  const copy = (value: string, what: string) => run(async () => { await navigator.clipboard.writeText(value); }, `${what} copied`);
  return (
    <div className="stack caption-box" style={{ gap: 8 }}>
      <h3 className="h-sm" style={{ margin: 0 }}>Caption</h3>
      <div className="row" style={{ gap: 8 }}>
        <div className="seg" role="group" aria-label="Platform">{([['instagram', 'Instagram'], ['tiktok', 'TikTok']] as const).map(([v, l]) => <button key={v} className={platform === v ? 'on' : ''} aria-pressed={platform === v} onClick={() => setPlatform(v)}>{l}</button>)}</div>
        <div className="seg" role="group" aria-label="Length">{([['short', 'Short'], ['medium', 'Medium']] as const).map(([v, l]) => <button key={v} className={length === v ? 'on' : ''} aria-pressed={length === v} onClick={() => setLength(v)}>{l}</button>)}</div>
      </div>
      <input className="input" {...fieldText} value={about} onChange={e => setAbout(e.target.value)} placeholder="What should the post say? e.g. new drop, Ramadan, shot in Imbaba" aria-label="What the caption is about" maxLength={400} />
      <button className="btn sm" disabled={write.isPending} onClick={() => run(() => write.mutateAsync())}><SparkIcon /> {write.isPending ? 'Claude is writing…' : shoot.caption ? 'Write another caption' : 'Write a caption with Claude'}</button>
      {(shoot.caption || text) && (
        <>
          <textarea className="textarea" rows={4} value={text} onChange={e => setText(e.target.value)} onBlur={() => text !== shoot.caption && save.mutate({ caption: text })} aria-label="Caption" style={{ fontSize: 13 }} />
          <input className="input" {...fieldText} value={tags} onChange={e => setTags(e.target.value)} onBlur={() => tags !== shoot.hashtags.join(' ') && save.mutate({ hashtags: tags.split(/\s+/).filter(Boolean) })} aria-label="Hashtags" />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => copy(text, 'Caption')}>Copy caption</button>
            <button className="btn sm" onClick={() => copy(`${text}\n\n${tags}`.trim(), 'Caption and hashtags')}>Copy with hashtags</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Typical things that go wrong in a photo of a print, one click each (one change at a time works best). */
const FIX_IDEAS = [
  'the print is cut off or hidden: show the whole print',
  'a sleeve print is missing: add it down the outside of both sleeves',
  'the print colours have drifted: match the artwork colours exactly',
  'hands or hair cover the print: move them away from it',
  'the skin looks plastic: add fine natural pores, keep it clean and even',
  'the hands look wrong: five natural fingers and a relaxed pose',
  'the background looks fake: make it a real, slightly worn place with ordinary clutter',
  'the light looks flat: use a lower warm sun from the side',
];

/** The check and fix loop (the course: keep editing the strongest result instead of starting over). Claude compares the photo with the artwork files; Codex then edits a copy of the photo with one stated change, saved beside the original. */
function QualityBox({ shoot }: { shoot: Shoot }) {
  const run = useRun();
  const [fix, setFix] = useState('');
  const [result, setResult] = useState<PrintCheckResult | null>(null);
  const check = useAction(() => claude.checkPrint(shoot.id), []);
  const queue = useAction(() => api.post<{ jobId: string }>(`/shoots/${shoot.id}/fix`, { feedback: fix.trim() }), [['shoots']]);
  return (
    <div className="stack quality-box" style={{ gap: 8 }}>
      <h3 className="h-sm" style={{ margin: 0 }}>Check &amp; fix</h3>
      <button className="btn sm" disabled={check.isPending} title="Claude looks at the photo next to the artwork files (about 30 seconds)"
        onClick={() => run(async () => { const r = await check.mutateAsync(); setResult(r); if (r.verdict === 'fix' && r.fix && !fix.trim()) setFix(r.fix); })}>
        <SparkIcon /> {check.isPending ? 'Claude is checking…' : result ? 'Check again' : 'Check the print with Claude'}
      </button>
      {result && (result.verdict === 'ok'
        ? <p className="check-ok" role="status">The print looks faithful to the artwork.{result.problems.length ? ` Notes: ${result.problems.join(' ')}` : ''}</p>
        : <ul className="notes" role="status">{result.problems.map(p => <li key={p} className="bad">{p}</li>)}</ul>)}
      <textarea className="textarea" rows={3} value={fix} onChange={e => setFix(e.target.value)} placeholder="What should change? One change at a time works best." aria-label="What to fix" style={{ fontSize: 13 }} />
      <div className="row" style={{ gap: 6 }}>{FIX_IDEAS.map(p => <button key={p} type="button" className="chip" onClick={() => setFix(p[0].toUpperCase() + p.slice(1))}>{p.split(':')[0]}</button>)}</div>
      <button className="btn sm lime" disabled={!fix.trim() || queue.isPending} onClick={() => run(async () => { await queue.mutateAsync(); setFix(''); }, 'Fix queued: a new photo appears beside this one in about 2 minutes')}>Fix this photo</button>
      <span className="hint">The original stays. Codex edits a copy.</span>
    </div>
  );
}
