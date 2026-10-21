import { useEffect, useState } from 'react';
import { PERSONAS } from '../assist/personas.ts';
import { MODEL_PHOTOS, MODEL_VIEWS, type ModelPhoto, type ModelView, type Preset, type PresetKind } from '../../shared/types.ts';
import { Link } from 'react-router-dom';
import { api, claude, useAction, useJobs, usePresets, useShoots, type ModelRanking } from '../api.ts';
import { usePreload } from '../components/a11y.ts';
import { GridSkeleton, QueryError } from '../components/states.tsx';
import { Drawer, DropZone, Empty, FileButton, PaneSwitch, useConfirm, useRun } from '../components/ui.tsx';
import { Assist, SparkIcon } from '../components/Assist.tsx';
import { fieldText } from '../components/fields.ts';
import { useUrlParams } from '../components/urlState.ts';

const KINDS: { key: PresetKind; label: string; placeholder: string; help: string }[] = [
  { key: 'model', label: 'Models', placeholder: 'Egyptian woman, mid-20s, long dark curly hair, warm olive skin, slim build, natural makeup, gold hoop earrings',
    help: 'A saved model keeps the same face and look across all your shoots. Upload a photo or let Codex create one from the description.' },
  { key: 'location', label: 'Locations', placeholder: 'Cairo rooftop at golden hour, old city skyline with minarets, warm stone walls',
    help: 'Places for lifestyle shoots. A reference photo makes every shot match. The backdrops for the studio photos are in the Studios tab.' },
  { key: 'studio', label: 'Studios', placeholder: 'Seamless paper backdrop in muted terracotta (#B8664A) curving down to a pale concrete floor',
    help: 'Backdrops for the studio photos on a model (front and back). Choose one when you shoot; its photo keeps the backdrop colour exact. Without one the studio photos use a grey backdrop.' },
  { key: 'style', label: 'Styles', placeholder: 'Warm 35mm film look, soft grain, golden tones, natural light, editorial but candid',
    help: 'Lighting, color grading and mood applied to any shoot.' },
];

const VIEW_LABEL: Record<ModelPhoto, string> = { face: 'Close-up', body: 'Full body', back: 'Back', sheet: 'Character sheet' };

/** What to look for when choosing one of the options, from the course's review step. */
const REVIEW_TIPS = 'Keep the one that looks most like a real, clean person: clear even skin with fine pores, a natural face, hair with a few loose strands, matte skin. Skip glossy, plastic or airbrushed faces, and any that look blotchy or tired.';

export function PresetsPage() {
  const [params, setParams] = useUrlParams(); // the tab (models, locations, styles) lives in the address
  const kind: PresetKind = KINDS.find(k => k.key === params.get('kind'))?.key ?? 'model';
  const setKind = (k: PresetKind) => setParams({ kind: k === 'model' ? null : k });
  const meta = KINDS.find(k => k.key === kind)!;
  const { data: presets = [], isPending: isLoading, isError, error, refetch } = usePresets(kind);
  // One viewer for every card, so it can step to the next model or location.
  const [viewing, setViewing] = useState<{ id: string; view: 'main' | ModelPhoto } | null>(null);
  const withPhoto = presets.filter(p => p.url);
  const saved = presets.filter(p => !p.groupId);
  const optionGroups = [...presets.filter(p => p.groupId).reduce((g, p) => g.set(p.groupId!, [...(g.get(p.groupId!) ?? []), p]), new Map<string, Preset[]>())];
  const vAt = viewing ? withPhoto.findIndex(p => p.id === viewing.id) : -1;
  const vPrev = vAt > 0 ? withPhoto[vAt - 1] : undefined, vNext = vAt >= 0 && vAt < withPhoto.length - 1 ? withPhoto[vAt + 1] : undefined;
  usePreload([vPrev?.url, vNext?.url]);
  const { data: active = [] } = useJobs('active');
  const generating = new Set(active.filter(j => j.type === 'preset').map(j => String(j.input.presetId)));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [generate, setGenerate] = useState(true);
  const [idea, setIdea] = useState(''); // models: a rough idea that Claude turns into the description
  const [how, setHow] = useState<'options' | 'one' | 'own'>('options'); // models: several options to choose from, or one photo
  const [optionCount, setOptionCount] = useState(4);
  const [pane, setPane] = useState(1); // phones show the library (1) or the new-preset form (0), one at a time
  const run = useRun();

  const describe = useAction(() => claude.describeModel(idea), []);
  const readPhoto = useAction((f: File) => claude.readPhoto(f), []);
  const options = useAction(() => api.post<{ groupId: string; ids: string[] }>('/presets/options', { name, description, count: optionCount }), [['presets']]);
  const create = useAction(() => {
    const form = new FormData();
    form.append('kind', kind); form.append('name', name); form.append('description', description);
    form.append('generate', String(!file && (kind === 'model' ? how === 'one' : generate)));
    if (kind === 'model') form.append('sheet', 'true'); // the course's next step: the character sheet follows the photo, made or uploaded
    if (file) form.append('image', file);
    return api.post<{ preset: Preset; jobId: string | null }>('/presets', form);
  }, [['presets']]);

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Library · <span className="kiro">Kiro made this</span></div><h1>Models, locations, studios &amp; styles</h1><p>Reusable building blocks for photo shoots.</p></div>
        <div className="seg" role="group" aria-label="Kind">{KINDS.map(k => <button key={k.key} className={kind === k.key ? 'on' : ''} aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>)}</div>
      </div>
      <PaneSwitch value={pane} onChange={setPane} items={[[1, `${meta.label} · ${presets.length}`], [0, `Add ${meta.label.toLowerCase().slice(0, -1)}`]]} />
      <div className="split" data-pane={pane}>
        <div className="panel stack">
          <h2>New {meta.label.toLowerCase().slice(0, -1)}</h2>
          <p className="hint">{meta.help}</p>
          <label className="field"><span>Name</span><input className="input" {...fieldText} value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'model' ? 'Nour' : kind === 'location' ? 'Cairo rooftop' : kind === 'studio' ? 'Terracotta paper' : 'Warm film'} /></label>
          {kind === 'model' && <ModelBuilder onWrite={setDescription} />}
          <label className="field"><span>Description{kind === 'model' && <span className="hint"> — a rough idea is enough, press Improve</span>}</span><textarea className="textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder={meta.placeholder} /></label>
          <Assist field={kind} value={description} onChange={setDescription} />
          {(kind === 'location' || kind === 'style') && (
            <FileButton className="btn sm" title="Claude reads a photo you like (Pinterest, say) and writes the words for it. The photo itself is not kept." disabled={readPhoto.isPending}
              onFiles={f => run(async () => { const r = await readPhoto.mutateAsync(f[0]); setDescription(kind === 'location' ? r.place : r.look); }, kind === 'location' ? 'Place written from the photo, edit it if you like' : 'Look written from the photo, edit it if you like')}>
              <SparkIcon /> {readPhoto.isPending ? 'Reading the photo…' : 'Fill from a photo'}
            </FileButton>
          )}
          {kind === 'model' ? (
            <div className="field"><span>Photos</span>
              <div className="seg" role="group" aria-label="How to make the photo">
                {([['options', 'Make options'], ['one', 'Make one'], ['own', 'My own photo']] as const).map(([v, l]) => <button key={v} className={how === v ? 'on' : ''} aria-pressed={how === v} onClick={() => setHow(v)}>{l}</button>)}
              </div>
              {how === 'options' && (
                <>
                  <span className="hint">Codex makes the same description several times, you keep the best face (Claude can compare them), and its character sheet is made for you.</span>
                  <div className="field"><span>Options <b>{optionCount}</b></span><input type="range" min={2} max={6} value={optionCount} aria-label="Number of options" onChange={e => setOptionCount(+e.target.value)} /></div>
                </>
              )}
              {how === 'one' && <span className="hint">One photo, then its character sheet (five angles) is made right after.</span>}
              {how === 'own' && (file
                ? <div className="row"><span className="badge ok">Photo: {file.name}</span><button className="btn ghost sm" onClick={() => setFile(null)}>Remove</button></div>
                : <DropZone onFiles={f => setFile(f[0])} multiple={false} title="Photo of the person" hint="Drop or click" touchHint="Tap to choose a photo" />)}
            </div>
          ) : file ? (
            <div className="row"><span className="badge ok">Photo: {file.name}</span><button className="btn ghost sm" onClick={() => setFile(null)}>Remove</button></div>
          ) : (
            <>
              <DropZone onFiles={f => setFile(f[0])} multiple={false} title="Reference photo (optional)" hint="Drop or click — or let Codex create one below" touchHint="Tap to choose a photo — or let Codex create one below" />
              <label className="check"><input type="checkbox" checked={generate} onChange={e => setGenerate(e.target.checked)} /><span>Generate a reference photo with Codex from the description</span></label>
            </>
          )}
          {(() => {
            const makeOptions = kind === 'model' && how === 'options', own = kind === 'model' ? how === 'own' : !!file, wantsPhoto = kind === 'model' ? how !== 'own' : !file && generate;
            const missing = !name.trim() ? 'Give it a name first' : (wantsPhoto || makeOptions) && !description.trim() ? 'Describe it so Codex can create the photo, or add your own photo' : kind === 'model' && how === 'own' && !file ? 'Choose a photo first' : '';
            const label = makeOptions ? `Make ${optionCount} options` : `Save ${meta.label.toLowerCase().slice(0, -1)}`;
            return (
              <div className="row sticky-actions">{missing && <span className="hint">{missing}</span>}<button className="btn primary" disabled={!!missing || create.isPending || options.isPending} title={missing || undefined}
                onClick={() => run(async () => {
                  if (makeOptions) await options.mutateAsync(); else await create.mutateAsync();
                  setName(''); setDescription(''); setFile(null); setPane(1);
                }, makeOptions ? `Codex is making ${optionCount} options, about 2 minutes` : wantsPhoto && !own ? 'Saved — Codex is creating the reference photo' : 'Saved')}>
                {label}
              </button></div>
            );
          })()}
        </div>
        <div>
          {isError && !presets.length ? <QueryError what={meta.label.toLowerCase()} error={error} onRetry={() => refetch()} />
            : isLoading ? <GridSkeleton kind="photo" className="grid lg presets" count={4} />
            : !presets.length ? <Empty title={`No ${meta.label.toLowerCase()} yet`}>Create one <span className="desk">on the left</span><span className="touch">in “Add {meta.label.toLowerCase().slice(0, -1)}”</span>.</Empty> : (
            <div className="stack">
              {optionGroups.map(([gid, list]) => <OptionGroup key={gid} id={gid} list={list} generating={generating} onOpen={(pid, view) => setViewing({ id: pid, view })} />)}
              {saved.length > 0 && <div className="grid lg presets">{saved.map(p => <PresetCard key={p.id} preset={p} generating={generating.has(p.id)} onOpen={view => setViewing({ id: p.id, view })} />)}</div>}
            </div>
          )}
        </div>
      </div>
      {viewing && withPhoto[vAt] && <PhotoDrawer preset={withPhoto[vAt]} initial={viewing.view} onClose={() => setViewing(null)}
        onPrev={vPrev && (() => setViewing({ id: vPrev.id, view: 'main' }))} onNext={vNext && (() => setViewing({ id: vNext.id, view: 'main' }))} position={`${vAt + 1} of ${withPhoto.length}`} />}
    </>
  );
}

function PresetCard({ preset, generating, onOpen }: { preset: Preset; generating: boolean; onOpen: (view: 'main' | ModelPhoto) => void }) {
  const run = useRun();
  const ask = useConfirm();
  const [description, setDescription] = useState(preset.description);
  const save = useAction((body: FormData) => api.patch<Preset>(`/presets/${preset.id}`, body), [['presets']]);
  const regen = useAction(() => api.post(`/presets/${preset.id}/generate`), [['presets']]);
  const del = useAction(() => api.del(`/presets/${preset.id}`), [['presets']]);
  const views = useAction(() => api.post(`/presets/${preset.id}/views`), [['presets']]);
  const makeSheet = useAction(() => api.post(`/presets/${preset.id}/sheet`), [['presets']]);
  const { data: feed = [] } = useShoots(preset.kind === 'model' ? { model: preset.id } : { model: '__none__' });
  const form = (fields: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };

  return (
    <div className="card">
      {preset.url
        ? <button className="media photo tall" onClick={() => onOpen('main')} aria-label={`Open ${preset.name}`}><img src={preset.thumbUrl!} alt={preset.name} loading="lazy" decoding="async" /></button>
        : <div className="media photo tall"><div className={`placeholder-card${generating ? ' running' : ''}`} style={{ width: '100%', height: '100%', aspectRatio: 'auto', borderRadius: 0 }}>{generating ? 'Codex is creating the photo…' : 'No reference photo'}</div></div>}
      <div className="body stack" style={{ gap: 8 }}>
        <div className="row"><div className="title">{preset.name}</div><span className="spacer" />{preset.kind === 'model' && feed.length > 0 && <Link className="btn ghost sm" to={`/shoots?model=${preset.id}`} title="Every photo made with this model">{feed.length} {feed.length === 1 ? 'photo' : 'photos'} →</Link>}</div>
        {preset.kind === 'model' && preset.url && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              {MODEL_VIEWS.map(v => {
                const photo = preset.views[v];
                const box = { flex: 1, aspectRatio: '3 / 4', borderRadius: 6, overflow: 'hidden', background: '#f1f2f4', display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--muted)', padding: 0, border: 0 } as const;
                return photo
                  ? <button key={v} title={`Open ${VIEW_LABEL[v]}`} onClick={() => onOpen(v)} style={{ ...box, cursor: 'zoom-in' }}><img src={photo.thumbUrl} alt={`${preset.name} · ${VIEW_LABEL[v]}`} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></button>
                  : <div key={v} title={VIEW_LABEL[v]} style={box}>{VIEW_LABEL[v]}</div>;
              })}
            </div>
            <button className="btn sm" disabled={generating} onClick={() => run(() => views.mutateAsync(), 'Codex is creating the close-up, full-body and back photos')}>
              {generating ? 'Creating…' : MODEL_VIEWS.some(v => preset.views[v]) ? 'Redo close-up, full body & back' : 'Create close-up, full body & back'}
            </button>
            {preset.views.sheet
              ? <button className="sheet-thumb" onClick={() => onOpen('sheet')} title="Open the character sheet" aria-label={`Open the character sheet of ${preset.name}`}><img src={preset.views.sheet.thumbUrl} alt={`${preset.name} · character sheet`} loading="lazy" decoding="async" /></button>
              : <div className="sheet-thumb empty">No character sheet yet</div>}
            <button className="btn sm" disabled={generating} title="One picture of the same person from the front, the side, three-quarter, behind and full length. Shoots send it as the only photo of the model, so the face and the back of the hair stay the same."
              onClick={() => run(() => makeSheet.mutateAsync(), 'Codex is creating the character sheet, about 2 minutes')}>
              {generating ? 'Creating…' : preset.views.sheet ? 'Redo character sheet' : 'Create character sheet'}
            </button>
          </div>
        )}
        <textarea className="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)}
          onBlur={() => description !== preset.description && save.mutate(form({ description }))} aria-label="Description" style={{ fontSize: 13 }} />
        <Assist flush field={preset.kind} value={description} onChange={setDescription} onCommit={v => v !== preset.description && save.mutate(form({ description: v }))} />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" disabled={generating || !description.trim()} title={generating ? 'Codex is already making a photo for this' : !description.trim() ? 'Write a description first: Codex makes the photo from it' : undefined} onClick={() => run(() => regen.mutateAsync(), 'Codex is creating a new photo')}>{preset.url ? 'New photo' : 'Generate photo'}</button>
          <FileButton className="btn sm" title="Use your own photo instead" onFiles={f => run(() => save.mutateAsync(form({ image: f[0] })), 'Photo replaced')}>Upload</FileButton>
          <span className="spacer" />
          <button className="btn sm danger" onClick={async () => (await ask({ title: `Delete ${preset.name}?`, body: 'Photo shoots that already used it keep their photos.', confirm: 'Delete', danger: true })) && run(() => del.mutateAsync(), 'Deleted')}>Delete</button>
        </div>
      </div>
    </div>
  );
}

/** Full-size viewer for a preset's photos; a model's close-up, full-body and back photos are one click away. */
function PhotoDrawer({ preset, initial, onClose, onPrev, onNext, position }: { preset: Preset; initial: 'main' | ModelPhoto; onClose: () => void; onPrev?: () => void; onNext?: () => void; position?: string }) {
  const [shown, setShown] = useState(initial);
  useEffect(() => setShown(initial), [preset.id, initial]); // another model or location starts on its main photo
  const photos = [
    { key: 'main' as 'main' | ModelPhoto, label: 'Main', url: preset.url!, thumbUrl: preset.thumbUrl! },
    ...MODEL_PHOTOS.filter(v => preset.views[v]).map(v => ({ key: v as 'main' | ModelPhoto, label: VIEW_LABEL[v], ...preset.views[v]! })),
  ];
  const cur = photos.find(p => p.key === shown) ?? photos[0];
  return (
    <Drawer onClose={onClose} onPrev={onPrev} onNext={onNext} position={position} label={preset.name} photo viewer={<img src={cur.url} alt={`${preset.name} · ${cur.label}`} decoding="async" />}>
      <h2>{preset.name}</h2>
      {photos.length > 1 && (
        <div className="row" style={{ gap: 6 }}>
          {photos.map(p => (
            <button key={p.key} className={`preset-opt${p.key === cur.key ? ' on' : ''}`} style={{ flex: 1 }} onClick={() => setShown(p.key)} aria-pressed={p.key === cur.key}>
              <span className="pic"><img src={p.thumbUrl} alt="" decoding="async" /></span><span className="name">{p.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <a className="btn sm" href={cur.url} target="_blank" rel="noreferrer">Open full size</a>
        <a className="btn sm" href={cur.url} download={`${preset.name}-${cur.label}.png`}>Download</a>
      </div>
      {preset.description && <p className="hint">{preset.description}</p>}
    </Drawer>
  );
}

/** The course's custom-avatar form: a few choices become a rough idea, and Claude writes the detailed description from it. */
const GENDERS = ['woman', 'man'], AGES = ['18 to 24', '25 to 34', '35 to 44', '45 to 60'], BUILDS = ['slim', 'athletic', 'average', 'curvy', 'broad'];
function ModelBuilder({ onWrite }: { onWrite: (text: string) => void }) {
  const run = useRun();
  const [v, setV] = useState({ gender: 'woman', age: '25 to 34', build: 'athletic', origin: 'Egyptian', hair: '', eyes: '', vibe: '' });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(p => ({ ...p, [k]: e.target.value }));
  const write = useAction(() => {
    const idea = [`${v.origin.trim() || 'Egyptian'} ${v.gender}`, `${v.age} years old`, `${v.build} build`, v.hair.trim() && `${v.hair.trim()} hair`, v.eyes.trim() && `${v.eyes.trim()} eyes`, v.vibe.trim()].filter(Boolean).join(', ');
    return claude.describeModel(idea, v.gender, v.age);
  }, []);
  return (
    <>
    <div className="field"><span>Ready-made types <span className="hint">— click one to fill the description, then make the photos</span></span>
      <div className="row" style={{ gap: 6 }}>
        {PERSONAS.map(p => <button key={p.key} type="button" className="chip" title={p.text} onClick={() => onWrite(p.text)}>{p.label} <span className="hint">{p.who}</span></button>)}
      </div>
    </div>
    <details className="builder">
      <summary>Or describe with a few choices</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Gender</span><select className="input" value={v.gender} onChange={set('gender')}>{GENDERS.map(g => <option key={g}>{g}</option>)}</select></label>
          <label className="field" style={{ flex: 1 }}><span>Age</span><select className="input" value={v.age} onChange={set('age')}>{AGES.map(g => <option key={g}>{g}</option>)}</select></label>
          <label className="field" style={{ flex: 1 }}><span>Build</span><select className="input" value={v.build} onChange={set('build')}>{BUILDS.map(g => <option key={g}>{g}</option>)}</select></label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ flex: 1 }}><span>Origin</span><input className="input" {...fieldText} value={v.origin} onChange={set('origin')} placeholder="Egyptian, Cairo" /></label>
          <label className="field" style={{ flex: 1 }}><span>Hair</span><input className="input" {...fieldText} value={v.hair} onChange={set('hair')} placeholder="long dark curly" /></label>
          <label className="field" style={{ flex: 1 }}><span>Eyes</span><input className="input" {...fieldText} value={v.eyes} onChange={set('eyes')} placeholder="brown" /></label>
        </div>
        <label className="field"><span>Vibe <span className="hint">— optional</span></span><input className="input" {...fieldText} value={v.vibe} onChange={set('vibe')} placeholder="calm streetwear creator, relaxed and friendly" /></label>
        <button type="button" className="btn sm" disabled={write.isPending} onClick={() => run(async () => onWrite((await write.mutateAsync()).description), 'Description written. Edit it if you like, then make the photos.')}>
          <SparkIcon /> {write.isPending ? 'Claude is writing…' : 'Write the description with Claude'}
        </button>
      </div>
    </details>
    </>
  );
}

/** Options made together from one description. Pick the most natural, and Claude can compare them first. */
function OptionGroup({ id, list, generating, onOpen }: { id: string; list: Preset[]; generating: Set<string>; onOpen: (presetId: string, view: 'main' | ModelPhoto) => void }) {
  const run = useRun();
  const ask = useConfirm();
  const [rank, setRank] = useState<ModelRanking | null>(null);
  const name = list[0].name.replace(/ · option \d+$/, '');
  const ready = list.filter(p => p.url);
  const compare = useAction(() => claude.compareOptions(id), []);
  const keep = useAction((pid: string) => api.post(`/presets/${pid}/keep`), [['presets']]);
  const discard = useAction(() => Promise.all(list.map(p => api.del(`/presets/${p.id}`))), [['presets']]);
  const score = (pid: string) => rank?.ranking.find(r => r.id === pid);
  return (
    <section className="panel stack option-group" aria-label={`Options for ${name}`}>
      <div className="row">
        <h2 className="h-sm" style={{ margin: 0 }}>Choose a model for “{name}”</h2>
        <span className="hint">{ready.length} of {list.length} photos ready</span>
        <span className="spacer" />
        <button className="btn sm" disabled={ready.length < 2 || compare.isPending} title={ready.length < 2 ? 'Wait until at least two photos are ready' : 'Claude looks at the photos side by side and says which one reads as a real person'}
          onClick={() => run(async () => setRank(await compare.mutateAsync()))}>
          <SparkIcon /> {compare.isPending ? 'Claude is comparing…' : rank ? 'Compare again' : 'Compare with Claude'}
        </button>
        <button className="btn sm danger" onClick={async () => (await ask({ title: `Throw away these ${list.length} options?`, body: 'Nothing is saved as a model.', confirm: 'Throw away', danger: true })) && run(() => discard.mutateAsync(), 'Options removed')}>Throw away</button>
      </div>
      <p className="hint">{REVIEW_TIPS}</p>
      <div className="grid presets">
        {list.map(p => {
          const r = score(p.id), best = rank?.best === p.id;
          return (
            <div key={p.id} className={`card${best ? ' selected' : ''}`}>
              {p.url
                ? <button className="media photo tall" onClick={() => onOpen(p.id, 'main')} aria-label={`Open ${p.name}`}><img src={p.thumbUrl!} alt={p.name} loading="lazy" decoding="async" /></button>
                : <div className="media photo tall"><div className={`placeholder-card${generating.has(p.id) ? ' running' : ''}`} style={{ width: '100%', height: '100%', aspectRatio: 'auto', borderRadius: 0 }}>{generating.has(p.id) ? 'Codex is creating the photo…' : 'Waiting in the queue'}</div></div>}
              <div className="body stack" style={{ gap: 6 }}>
                <div className="row"><div className="title">{p.name.match(/option \d+$/)?.[0] ?? p.name}</div><span className="spacer" />{r && <span className={`badge ${r.score >= 7 ? 'ok' : ''}`} title="Claude's score: 10 is indistinguishable from a real photo">{r.score}/10{best ? ' · best' : ''}</span>}</div>
                {r && (
                  <ul className="notes">
                    {r.good.map(t => <li key={t} className="good">{t}</li>)}
                    {r.problems.map(t => <li key={t} className="bad">{t}</li>)}
                  </ul>
                )}
                <button className="btn sm primary" disabled={!p.url || keep.isPending} title={p.url ? undefined : 'Wait until this photo is ready'} onClick={() => run(() => keep.mutateAsync(p.id), `${name} saved. Its character sheet is being made.`)}>Keep this one</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
