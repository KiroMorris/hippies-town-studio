import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Placement, Reference } from '../../shared/types.ts';
import { api, uploadForm, useAction, useDesigns, useJobs, useReferences, type GenerateDesignsRequest } from '../api.ts';
import { DesignCard, PendingCard } from '../components/DesignCard.tsx';
import { DropZone, Empty, PaneSwitch, plural, useConfirm, usePageDrop, useRun, useToast } from '../components/ui.tsx';
import { Assist } from '../components/Assist.tsx';
import { fieldUrl } from '../components/fields.ts';
import { useRemembered } from '../components/remember.ts';
import { QuickMockups } from '../components/QuickMockups.tsx';

const BATCH_KEY = 'studio.lastDesignBatch';
/** Ideas that only make sense with a picture to work from ("extract the exact design"). Without one Codex asks for the image and makes nothing. */
const NEEDS_IMAGE = /\b(extract|exact(ly)?|attached|recreate|redraw|vectori[sz]e|(this|these|that|those) (design|designs|image|images|picture|pictures|photo|photos|logo|artwork)|the (image|images|picture|photo|photos|reference|references|logo)|same (design|image|picture|photo))\b/i;
const readBatch = () => { try { return localStorage.getItem(BATCH_KEY); } catch { return null; } };

export function GeneratePage() {
  const [params] = useSearchParams();
  const fromDesigns = (params.get('from') ?? '').split(',').filter(Boolean);
  const [ideas, setIdeas] = useState('');
  const [picked, setRefIds] = useRemembered<string[]>('generate.refs', []); // survives a refresh (a dropped image used to look added but count as none)
  const [separate, setSeparate] = useState(true);
  const [placements, setPlacements] = useRemembered<Placement[]>('generate.placements', ['front']);
  const [mockupFor, setMockupFor] = useState<string[] | null>(null);
  const nav = useNavigate();
  const [egyptian, setEgyptian] = useState(false);
  const [exact, setExact] = useState(false); // recreate the reference's artwork exactly instead of being inspired by it
  const [count, setCount] = useState(fromDesigns.length ? 3 : 2);
  const [batch, setBatch] = useState<string | null>(readBatch);
  const [pane, setPane] = useState(0); // phones show the form or the latest batch, one at a time
  const run = useRun();
  const ask = useConfirm();
  const toast = useToast();
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState(0); // pasted, dropped or linked images still on their way in

  const { data: refs = [], isSuccess: refsLoaded } = useReferences();
  const refIds = refsLoaded ? picked.filter(id => refs.some(r => r.id === id)) : []; // a reference deleted since is dropped
  const { data: sourceDesigns = [] } = useDesigns({});
  const fromList = sourceDesigns.filter(d => fromDesigns.includes(d.id));
  useEffect(() => { if (fromList[0]) setPlacements([fromList[0].placement]); }, [fromList[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadRefs = useAction((files: File[]) => api.post<Reference[]>('/references', uploadForm(files)), [['references']]);
  const fromLinks = useAction((urls: string[]) => api.post<{ references: Reference[]; errors: string[] }>('/references/from-url', { urls }), [['references']]);
  const delRef = useAction((id: string) => api.del(`/references/${id}`), [['references']]);
  const generate = useAction((body: GenerateDesignsRequest) => api.post<{ batchId: string; jobIds: string[] }>('/designs/generate', body), [['designs']]);

  // Generate waits while an image is still arriving: sent too early, the job would be made without it.
  const whileAdding = async <T,>(fn: () => Promise<T>) => { setAdding(n => n + 1); try { return await fn(); } finally { setAdding(n => n - 1); } };
  const addRefs = (files: File[]) => run(() => whileAdding(async () => {
    const added = await uploadRefs.mutateAsync(files);
    setRefIds(ids => [...ids, ...added.map(r => r.id)]);
  }), `${plural(files.length, 'reference')} added`);
  const addLinks = (urls: string[]) => run(() => whileAdding(async () => {
    const out = await fromLinks.mutateAsync(urls);
    setRefIds(ids => [...ids, ...out.references.map(r => r.id)]);
    toast(`${plural(out.references.length, 'reference')} added${out.errors.length ? ` · ${out.errors.join(' · ')}` : ''}`, out.errors.length > 0);
    return out;
  }));
  const addLink = () => { const urls = link.split(/\s+/).filter(Boolean); if (urls.length) addLinks(urls).then(out => out && setLink('')); };
  const overlay = usePageDrop(addRefs, 'Drop to add references', 'Codex uses them for style, mood and subject. Images dragged from another tab work too.', addLinks);

  const ideaList = ideas.split('\n').map(s => s.trim()).filter(Boolean);
  const refCount = refIds.length + fromDesigns.length;
  const total = Math.max(1, ideaList.length) * (refCount ? (separate || exact ? refCount : 1) : 1) * count * placements.length;
  const why = exact && !refCount ? 'Add the reference to extract the design from' : !ideaList.length && !refCount ? (refs.length ? 'Write an idea, or click a reference in your library to use it' : 'Write an idea or add a reference first') : total > 100 ? `That is ${total} designs: keep it to 100 per batch` : '';
  const canSubmit = !why;

  const start = () => run(async () => {
    const out = await generate.mutateAsync({ ideas: ideaList, referenceIds: refIds, designIds: fromDesigns, separateReferences: separate || exact, placement: placements[0], placements, egyptian: egyptian && !exact, exact, count });
    setBatch(out.batchId); setPane(1);
    try { localStorage.setItem(BATCH_KEY, out.batchId); } catch { /* storage unavailable */ }
  }, `${plural(total, "design")} queued — about 2 minutes each`);
  const submit = async () => {
    const wording = ideaList.find(i => NEEDS_IMAGE.test(i));
    if (!refCount && wording && !(await ask({
      title: 'No reference image attached',
      body: `“${wording.length > 70 ? `${wording.slice(0, 67)}…` : wording}” needs an image to work from. With none attached, Codex asks for it and makes nothing. Add the reference first, or generate from the words alone.`,
      confirm: 'Generate anyway', cancel: 'Add a reference first', danger: true,
    }))) return;
    return start();
  };

  const { data: batchDesigns = [] } = useDesigns(batch ? { batch, status: 'all' } : { batch: '__none__' });
  const { data: active = [] } = useJobs('active');
  const batchPending = active.filter(j => j.batchId === batch);

  return (
    <>
      {overlay}
      <div className="page-head">
        <div><div className="eyebrow">Step 1 · Create · <span className="kiro">Kiro made this</span></div><h1>Generate designs</h1><p>Codex makes print-ready designs with a transparent background, using your ChatGPT subscription.</p></div>
      </div>
      <PaneSwitch value={pane} onChange={setPane} items={[[0, 'Create'], [1, `Latest batch${batchDesigns.length + batchPending.length ? ` · ${batchDesigns.length + batchPending.length}` : ''}`]]} />
      <div className="split" data-pane={pane}>
        <div className="stack">
          <div className="panel stack">
            <label className="field">
              <span>{exact ? <>Notes <span className="hint">— optional, for example “only the center emblem”</span></> : <>Ideas <span className="hint">— one per line, each becomes its own set</span></>}</span>
              <textarea className="textarea" rows={5} value={ideas} onChange={e => setIdeas(e.target.value)}
                placeholder={'Two hippie girls in peace-sign sunglasses, retro line art\nA flower-covered camper van at sunset, groovy colours\nA smiling sun with a peace sign, wavy 70s lettering'} />
            </label>
            {!exact && <Assist field="design" value={ideas} onChange={setIdeas} />}

            <div className="field">
              <span>References <span className="hint">— optional, for style & mood</span></span>
              {fromList.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="hint">From your designs:</span>
                  <div className="thumbs">{fromList.map(d => <div key={d.id} className="thumb on" title={d.title}><img src={d.thumbUrl} alt={d.title} loading="lazy" decoding="async" /></div>)}</div>
                </div>
              )}
              <DropZone onFiles={addRefs} onUrls={addLinks} title="Drop reference images" hint="or click to choose · PNG, JPG, WebP · or drag one in from another tab"
                touchTitle="Add reference images" touchHint="Tap to choose from your photos · PNG, JPG, WebP" />
              {adding > 0 && <p className="hint" role="status">Adding your reference…</p>}
              <div className="row">
                <input className="input" {...fieldUrl} style={{ flex: 1 }} value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === 'Enter' && addLink()}
                  placeholder="…or paste an image link (a page link works too)" aria-label="Reference image link" />
                <button className="btn sm" disabled={!link.trim() || fromLinks.isPending} title={link.trim() ? undefined : 'Paste an image or page address first'} onClick={addLink}>{fromLinks.isPending ? 'Adding…' : 'Add link'}</button>
              </div>
              {refs.length > 0 && (
                <>
                  <span className="hint">Your reference library — click to use:</span>
                  <div className="thumbs">
                    {refs.map(r => (
                      <div key={r.id} className={`thumb${refIds.includes(r.id) ? ' on' : ''}`} title={r.name}>
                        <button className="bare" aria-pressed={refIds.includes(r.id)} aria-label={`Use reference ${r.name}`}
                          onClick={() => setRefIds(ids => (ids.includes(r.id) ? ids.filter(i => i !== r.id) : [...ids, r.id]))}>
                          <img src={r.thumbUrl} alt="" loading="lazy" decoding="async" />
                        </button>
                        <button className="x" aria-label={`Delete reference ${r.name}`} title="Delete this reference"
                          onClick={async () => (await ask({ title: 'Delete this reference?', body: 'It is removed from your reference library. Designs already made from it, and ones still waiting in the queue, are not affected.', confirm: 'Delete', danger: true })) && run(async () => { await delRef.mutateAsync(r.id); setRefIds(ids => ids.filter(i => i !== r.id)); })}>✕</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {refCount > 1 && !exact && (
                <label className="check"><input type="checkbox" checked={separate} onChange={e => setSeparate(e.target.checked)} />
                  <span>Use each reference separately<br /><span className="hint">Off: all references are combined into each design.</span></span>
                </label>
              )}
            </div>

            <div className="field">
              <span>Print placement <span className="hint">— pick several to make a linked set</span></span>
              <div className="seg">{(['front', 'back', 'sleeve'] as const).map(p => (
                <button key={p} className={placements.includes(p) ? 'on' : ''} aria-pressed={placements.includes(p)}
                  onClick={() => setPlacements(ps => (ps.includes(p) ? (ps.length > 1 ? ps.filter(x => x !== p) : ps) : [...ps, p]))}>
                  {p === 'sleeve' ? 'Sleeve (long strip)' : p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}</div>
              {placements.length > 1 && <span className="hint">{exact ? 'Each print is extracted from the reference on its own, so the reference has to show that part. They stay linked, so you can put the whole set on one garment.' : 'Made one after another: the first print first, then the others designed to match it. They stay linked, so you can put the whole set on one garment.'}</span>}
            </div>

            <label className="check"><input type="checkbox" checked={exact} onChange={e => setExact(e.target.checked)} />
              <span>Extract the exact design<br /><span className="hint">Off: a reference only inspires a new design. On: Codex recreates the artwork in the reference exactly (same subject, layout and colors) on a transparent background, ready to print. Needs a reference.</span></span>
            </label>

            <label className="check"><input type="checkbox" checked={egyptian && !exact} disabled={exact} onChange={e => setEgyptian(e.target.checked)} />
              <span>Egyptian twist<br /><span className="hint">{exact ? 'Not used when extracting an exact design.' : "Off: your idea or reference decides the look. On: it is dressed in the store's Egyptian-mythology style."}</span></span>
            </label>

            <div className="field">
              <span>Variations of each <b>{count}</b></span>
              <input type="range" min={1} max={8} value={count} aria-label="Variations of each" onChange={e => setCount(+e.target.value)} />
              {exact && <span className="hint">Each one is another attempt at the same extraction. Keep the best.</span>}
            </div>

            <div className="row sticky-actions">
              <span className="hint">{adding > 0 ? 'Adding your reference… Generate unlocks when it is in.' : why || `= ${plural(total, 'design')} · ${refCount ? plural(refCount, 'reference') : 'no reference'}`}</span>
              <span className="spacer" />
              <button className="btn lime" disabled={!canSubmit || generate.isPending || adding > 0} title={adding > 0 ? 'Wait for your reference to finish adding' : why || undefined} onClick={submit}>Generate {plural(total, 'design')}</button>
            </div>
          </div>
          <p className="hint">Tip: each design takes about 2 minutes and uses your Codex limits. Jobs keep running if you close this page, and resume after a restart.</p>
        </div>

        <div className="panel">
          <div className="panel-title"><h2>Latest batch</h2><div className="row" style={{ gap: 6 }}>{batchDesigns.length > 0 && <button className="btn sm lime" title="Put every design of this batch on your garments" onClick={() => setMockupFor(batchDesigns.map(d => d.id))}>Make mockups with these {batchDesigns.length}</button>}{batch && <Link className="btn sm" to="/designs">Open library</Link>}</div></div>
          {!batchDesigns.length && !batchPending.length ? (
            <Empty title="Nothing generated yet">Results show up here as each design finishes.</Empty>
          ) : (
            <div className="grid masonry">
              {batchPending.map(j => <PendingCard key={j.id} job={j} />)}
              {batchDesigns.map(d => <DesignCard key={d.id} design={d} onOpen={() => nav(`/designs?open=${d.id}`)} />)}
            </div>
          )}
        </div>
      </div>
      {mockupFor && <QuickMockups designIds={mockupFor} onClose={() => setMockupFor(null)} />}
    </>
  );
}
