import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Job, Listing, ListingDetail, ListingMedia } from '../../shared/types.ts';
import { api, useAction, useJobs, useListing, useListings, useShoots, useShopifyStatus } from '../api.ts';
import { usePreload, useSelectionKeys } from '../components/a11y.ts';
import { GridSkeleton, QueryError, SplitSkeleton } from '../components/states.tsx';
import { Drawer, Empty, Modal, PaneSwitch, plural, timeAgo, useConfirm, useRun, useSelection, useToast } from '../components/ui.tsx';
import { fieldNumber, fieldText } from '../components/fields.ts';

/** The colour of a note line on the card: "no" or "nope" (any case) is red, "rdy" green, anything else purple. */
const noteTone = (line: string) => (/\b(no|nope)\b/i.test(line) ? 'no' : /\brdy\b/i.test(line) ? 'rdy' : undefined);
const ready = (l: Listing) => l.checks.filter(c => c.ok).length;
const lacks = (l: Listing, key: string) => l.checks.some(c => c.key === key && !c.ok);
/** Where a product stands, and the one thing to do next (the first missing step: photos, then details, then the rest). */
type Stage = 'photos' | 'details' | 'other' | 'ready' | 'shopify';
const stageOf = (l: Listing): Stage => (l.shopify ? 'shopify' : lacks(l, 'photos') ? 'photos' : lacks(l, 'description') || !l.tags.length ? 'details' : ready(l) < l.checks.length ? 'other' : 'ready');
const STAGES: [Stage | '', string][] = [['', 'All'], ['photos', 'Needs photos'], ['details', 'Needs details'], ['other', 'Other gaps'], ['ready', 'Ready for Shopify'], ['shopify', 'On Shopify']];

export function ProductsPage() {
  const { data: listings = [], isPending: isLoading, isError, error, refetch } = useListings();
  const readyToPush = listings.filter(l => ready(l) === l.checks.length && !l.shopify && !l.shopifyRemovedAt).length; // everything on the checklist done, not on Shopify yet
  const sel = useSelection();
  const ids = useMemo(() => listings.map(l => l.id), [listings]);
  useSelectionKeys(sel, ids); // Esc clears, Cmd/Ctrl+A selects every product shown
  const { data: allShoots = [] } = useShoots();
  const photosOf = useMemo(() => { const m: Record<string, number> = {}; for (const x of allShoots) if (x.listingId) m[x.listingId] = (m[x.listingId] ?? 0) + 1; return m; }, [allShoots]);
  const [deleting, setDeleting] = useState(false);
  const [stage, setStage] = useState<Stage | ''>('');
  const stageCount = useMemo(() => { const c: Record<string, number> = {}; for (const l of listings) c[stageOf(l)] = (c[stageOf(l)] ?? 0) + 1; return c; }, [listings]);
  const shown = stage ? listings.filter(l => stageOf(l) === stage) : listings;
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Step 4 · <span className="kiro">made by Kiro</span></div><h1>Products</h1>
          <p>One design on one garment style. Every color mockup is a variant, and the photos you shoot land here, ready for Shopify.</p></div>
      </div>
      {readyToPush > 0 && (
        <div className="nextstep">
          <div><b>{readyToPush === 1 ? '1 product is' : `${readyToPush} products are`} ready for Shopify.</b> Every checklist item is done. Push {readyToPush === 1 ? 'it' : 'them'} as drafts from the Publish page.</div>
          <Link className="btn lime" to="/shopify">Publish to Shopify →</Link>
        </div>
      )}
      {listings.length > 0 && (
        <div className="toolbar"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {STAGES.filter(([k]) => !k || stageCount[k]).map(([k, label]) => <button key={k} className={`chip${stage === k ? ' on' : ''}`} aria-pressed={stage === k} onClick={() => setStage(k)}>{label} · {k ? stageCount[k] : listings.length}</button>)}
        </div></div>
      )}
      {sel.size > 0 && (
        <div className="selection-bar">
          <strong>{sel.size} selected</strong><span className="spacer" />
          <Link className="btn lime" to={`/shoots?mockups=${listings.filter(l => sel.has(l.id)).flatMap(l => l.colors.map(c => c.mockupId)).join(',')}`} title="Open Photo shoots with every color of the selected products">Shoot photos</Link>
          <button className="btn danger" onClick={() => setDeleting(true)}>Delete</button>
          <button className="btn ghost" title="Clear the selection (Esc)" aria-label="Clear selection" onClick={sel.clear}>✕</button>
        </div>
      )}
      {deleting && <DeleteProductsModal listings={listings.filter(l => sel.has(l.id))} photos={photosOf} onClose={() => setDeleting(false)} onDone={() => { setDeleting(false); sel.clear(); }} />}
      {isError && !listings.length ? <QueryError what="your products" error={error} onRetry={() => refetch()} />
        : isLoading ? <GridSkeleton kind="product" count={5} />
        : !listings.length ? (
        <Empty title="No products yet" actions={<Link className="btn lime" to="/designs">Go to designs</Link>}>Products are created automatically when you make a mockup with a design on it.</Empty>
      ) : (
        <div className="grid lg">
          {shown.map(l => (
            <div key={l.id} className={`card${sel.has(l.id) ? ' selected' : ''}`}>
              <button className="select-box" onClick={e => sel.pick(l.id, e.shiftKey, shown.map(x => x.id))} aria-pressed={sel.has(l.id)} aria-label={`Select ${l.title}`} title="Select (Shift-click selects a range)">{sel.has(l.id) ? '✓' : ''}</button>
              <Link to={`/products/${l.id}`} className="media photo tall" aria-label={`Open ${l.title}`} style={{ color: 'inherit', textDecoration: 'none' }}>{l.coverUrl ? <img src={l.coverUrl} alt="" loading="lazy" decoding="async" /> : <span className="hint">No photos yet</span>}</Link>
              <div className="body stack" style={{ gap: 6 }}>
                <Link to={`/products/${l.id}`} className="title" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>{l.title}</Link>
                <div className="hint">{plural(l.colors.length, 'color')} · {plural(l.photoCount, 'photo')}{l.price ? ` · ${l.price} EGP` : ''}</div>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`badge ${ready(l) === l.checks.length ? 'ok' : 'warn'}`} title={l.checks.filter(c => !c.ok).map(c => c.label).join(' · ') || undefined}>{ready(l) === l.checks.length ? 'Ready for Shopify' : `${ready(l)}/${l.checks.length} ready`}</span>
                  {l.status === 'ready' && <span className="badge marked">Marked ready</span>}
                  {l.shopify && <span className="badge ok">On Shopify · {l.shopify.status.toLowerCase()}</span>}
                  {!l.shopify && l.shopifyRemovedAt && <span className="badge warn">Deleted from Shopify</span>}
                </div>
                {l.note && (
                  <Link to={`/products/${l.id}`} className="card-note" title={l.note}>
                    {l.note.split('\n').map(t => t.trim()).filter(Boolean).slice(0, 4).map((t, i) => <span key={i} className={noteTone(t)}>{t}</span>)}
                  </Link>
                )}
                {stageOf(l) === 'photos' && <Link className="btn sm lime" to={`/shoots?mockups=${l.colors.map(c => c.mockupId).join(',')}`}>Shoot photos →</Link>}
                {stageOf(l) === 'details' && <Link className="btn sm lime" to={`/products/${l.id}`}>Write the details →</Link>}
                {stageOf(l) === 'other' && <div className="hint">Missing: {l.checks.filter(c => !c.ok).map(c => c.label).join(', ')}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function ProductPage() {
  const { id } = useParams();
  const { data: listing, isError } = useListing(id);
  if (isError) return <Empty title="Product not found"><Link to="/products">Back to products</Link></Empty>;
  if (!listing) return <SplitSkeleton />;
  return <ProductEditor key={listing.id} listing={listing} />;
}

/** Keeps a field in step with the server without trampling what you are typing: a new server value (Codex wrote it) replaces the field only if you had not changed it. */
function useSynced(server: string, local: string, setLocal: (v: string) => void) {
  const last = useRef(server);
  useEffect(() => {
    if (server === last.current) return;
    if (local === last.current) setLocal(server);
    last.current = server;
  }, [server]); // only a change on the server matters; `local` is read as it is at that moment
}
const slugOf = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function ProductEditor({ listing }: { listing: ListingDetail }) {
  const run = useRun();
  const toast = useToast();
  const qc = useQueryClient();
  const ask = useConfirm();
  const navigate = useNavigate();
  const save = useAction((body: Record<string, unknown>) => api.patch<ListingDetail>(`/listings/${listing.id}`, body), [['listing', listing.id], ['listings']]);
  const [deleting, setDeleting] = useState(false);
  const { data: myShoots = [] } = useShoots({ listing: listing.id });
  const shopify = useShopifyStatus();
  const keys = [['listing', listing.id], ['listings']];
  const push = useAction(() => api.post(`/listings/${listing.id}/shopify/push`), keys);
  const fill = useAction(() => api.post(`/listings/${listing.id}/shopify/autofill`), keys);
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(listing.price?.toString() ?? '');
  const [compareAt, setCompareAt] = useState(listing.compareAt?.toString() ?? '');
  const [tags, setTags] = useState(listing.tags.join(', '));
  const [seoTitle, setSeoTitle] = useState(listing.seoTitle);
  const [seoDescription, setSeoDescription] = useState(listing.seoDescription);
  const [note, setNote] = useState(listing.note);
  useSynced(listing.title, title, setTitle);
  useSynced(listing.description, description, setDescription);
  useSynced(listing.price?.toString() ?? '', price, setPrice);
  useSynced(listing.compareAt?.toString() ?? '', compareAt, setCompareAt);
  useSynced(listing.tags.join(', '), tags, setTags);
  useSynced(listing.seoTitle, seoTitle, setSeoTitle);
  useSynced(listing.seoDescription, seoDescription, setSeoDescription);
  useSynced(listing.note, note, setNote);

  // Codex writes the details as a job in the queue; when it finishes, the fields above pick up what it wrote.
  const { data: activeJobs = [] } = useJobs('active');
  const writing = activeJobs.some(j => j.type === 'copy' && j.input.listingId === listing.id);
  const wasWriting = useRef(false);
  useEffect(() => {
    if (wasWriting.current && !writing) {
      void (async () => {
        await Promise.all([qc.invalidateQueries({ queryKey: ['listing', listing.id] }), qc.invalidateQueries({ queryKey: ['listings'] })]);
        const mine = (await api.get<Job[]>('/jobs?limit=30')).find(j => j.type === 'copy' && j.input.listingId === listing.id);
        if (mine?.status === 'error') toast(`Codex could not write the details: ${mine.error ?? 'unknown error'}`, true);
        else if (mine?.status === 'done') toast(mine.result?.notes?.length ? 'Details written. Read them over: a few things need a look.' : 'Product details written by Codex');
      })().catch(() => {});
    }
    wasWriting.current = writing;
  }, [writing]);
  const write = useAction((rewrite: boolean) => api.post(`/listings/${listing.id}/write`, { rewrite }), []);
  const unwritten = listing.checks.some(c => c.key === 'description' && !c.ok) || !listing.tags.length || !listing.seoDescription;
  const startWrite = async (rewrite: boolean) => {
    if (rewrite && !(await ask({ title: 'Rewrite the details with Codex?', body: 'Codex writes the title, description, tags and search listing again and replaces what is there now. The price and sizes stay as they are.', confirm: 'Rewrite', danger: true }))) return;
    void run(() => write.mutateAsync(rewrite), 'Codex is writing the details. It takes about a minute.');
  };
  const writeBusy = writing || write.isPending;
  const [drag, setDrag] = useState<string | null>(null);
  const [order, setOrder] = useState(listing.media.map(m => m.key));
  const [pane, setPane] = useState(0); // phones show the details or the photos, one at a time
  useEffect(() => setOrder(listing.media.map(m => m.key)), [listing.media]);

  const patch = (body: Record<string, unknown>) => void run(() => save.mutateAsync(body));
  const blurSave = (field: string, value: unknown, current: unknown) => { if (value !== current) patch({ [field]: value }); };
  const byKey = Object.fromEntries(listing.media.map(m => [m.key, m]));
  const media = order.map(k => byKey[k]).filter(Boolean);
  const hidden = listing.media.filter(m => m.hidden).map(m => m.key);
  const toggleHidden = (key: string) => patch({ hidden: hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key] });
  const drop = (target: string) => {
    if (!drag || drag === target) return;
    const next = order.filter(k => k !== drag);
    next.splice(next.indexOf(target), 0, drag);
    setOrder(next); setDrag(null); patch({ media: next });
  };
  // Touch has no drag and drop: the Earlier / Later / Make cover buttons do the same thing.
  const move = (key: string, to: number) => { const next = order.filter(k => k !== key); next.splice(Math.max(0, Math.min(next.length, to)), 0, key); setOrder(next); patch({ media: next }); };
  const makeCover = (key: string) => { const next = [key, ...order.filter(k => k !== key)]; setOrder(next); patch(hidden.includes(key) ? { media: next, hidden: hidden.filter(k => k !== key) } : { media: next }); };
  const coverKey = media.find(m => !m.hidden)?.key;
  const allReady = listing.checks.every(c => c.ok);
  const mockupIds = listing.colors.map(c => c.mockupId).join(',');
  const undone = listing.checks.filter(c => !c.ok);
  const pushed = !!listing.shopify;
  const [viewKey, setViewKey] = useState<string | null>(null); // the photo open in the viewer
  const at = viewKey ? media.findIndex(m => m.key === viewKey) : -1;
  const prev = at > 0 ? media[at - 1] : undefined, next = at >= 0 && at < media.length - 1 ? media[at + 1] : undefined;
  usePreload([prev?.url, next?.url]);

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow"><Link to="/products">Products</Link> · {listing.style}</div><h1>{listing.title}</h1>
          <p>Updated {timeAgo(listing.updatedAt)} · changes save automatically.</p></div>
        <div className="row">
          <Link className="btn" to={`/shoots?mockups=${mockupIds}`}>Shoot more photos</Link>
          <button className={`btn${unwritten && !writeBusy ? ' lime' : ''}`} disabled={writeBusy} onClick={() => startWrite(!unwritten)}
            title={writeBusy ? 'Codex is writing this product now' : unwritten ? "Codex writes the title, description, tags and search listing the way your store's own pages are written" : 'Replace the title, description, tags and search listing with a fresh version from Codex'}>
            {writeBusy ? 'Codex is writing…' : unwritten ? 'Write with Codex' : 'Rewrite with Codex'}</button>
          {/* lime only when pushing is the next step; once it is on Shopify the next step is in the store (the banner below) */}
          <button className={`btn${allReady && !pushed ? ' lime' : ''}`} disabled={!shopify.data?.configured || push.isPending} title={shopify.data?.configured ? (allReady || pushed ? 'Creates the product as a draft in your Shopify store' : `Not everything is done yet (${undone.map(c => c.label).join(', ')}), but you can still push a draft`) : 'Add SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN to studio/.env first'}
            onClick={() => run(() => push.mutateAsync(), listing.shopify ? 'Updated on Shopify' : 'Pushed to Shopify as a draft')}>
            {push.isPending ? 'Pushing…' : listing.shopify ? 'Update on Shopify' : listing.shopifyRemovedAt ? 'Push again (draft)' : 'Push to Shopify (draft)'}</button>
        </div>
      </div>
      {pushed ? (
        <div className="nextstep"><div><b>On Shopify as a {listing.shopify!.status.toLowerCase()}.</b> Check it in your store, add stock, then activate it there. “Update on Shopify” sends later changes to the text, variants and prices.</div>
          <a className="btn lime" href={listing.shopify!.adminUrl} target="_blank" rel="noreferrer">Open in Shopify ↗</a></div>
      ) : allReady ? (
        <div className="nextstep"><div><b>Ready for Shopify.</b> Every checklist item is done. Push it as a draft, then finish it in your store.</div><Link className="btn" to="/shopify">Publish page →</Link></div>
      ) : (
        <div className="nextstep warn"><div><b>{undone.length === 1 ? '1 thing' : `${undone.length} things`} left before Shopify:</b> {undone.map(c => c.label).join(' · ')}</div>
          {undone.some(c => c.key === 'description') && <button className="btn lime" disabled={writeBusy} onClick={() => startWrite(false)}>{writeBusy ? 'Codex is writing…' : 'Write with Codex'}</button>}
          {undone.some(c => c.key === 'photos') && <Link className="btn lime" to={`/shoots?mockups=${mockupIds}`}>Shoot more photos</Link>}</div>
      )}
      <PaneSwitch value={pane} onChange={setPane} items={[[0, 'Details'], [1, `Photos · ${listing.photoCount}`]]} />
      <div className="split" data-pane={pane}>
        <div className="stack">
          <label className="panel note-panel field"><span>Note <span className="hint">— only for you; shows on the product card, never sent to Shopify</span></span>
            <textarea className="textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} onBlur={() => blurSave('note', note.trim(), listing.note)}
              placeholder="A to-do or a reminder, e.g. “reshoot the back photo”, “price for Ramadan”" /></label>
          <div className="panel stack">
            <label className="field"><span>Title</span>
              <input className="input" {...fieldText} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && blurSave('title', title.trim(), listing.title)} /></label>
            <label className="field"><span>Description{listing.copyAt && <span className="hint"> · written by Codex {timeAgo(listing.copyAt)}, read it over before you push</span>}</span>
              <textarea className="textarea" rows={9} value={description} onChange={e => setDescription(e.target.value)} onBlur={() => blurSave('description', description, listing.description)}
                placeholder={'Three short paragraphs, with a blank line between them:\n1. the hook: what is on the garment\n2. about the design\n3. who it is for\nFabric, care, shipping and links are added for you.'} /></label>
            <div className="row" style={{ alignItems: 'start' }}>
              <label className="field" style={{ flex: 1 }}><span>Price (EGP)</span>
                <input className="input" {...fieldNumber} type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} onBlur={() => blurSave('price', price === '' ? null : Number(price), listing.price)} /></label>
              <label className="field" style={{ flex: 1 }}><span>Compare-at <span className="hint">— optional</span></span>
                <input className="input" {...fieldNumber} type="number" min={0} value={compareAt} onChange={e => setCompareAt(e.target.value)} onBlur={() => blurSave('compareAt', compareAt === '' ? null : Number(compareAt), listing.compareAt)} /></label>
            </div>
            <div className="field"><span>Sizes</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{listing.sizeOptions.map(s => {
                const on = listing.sizes.includes(s);
                return <button key={s} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => patch({ sizes: on ? listing.sizes.filter(x => x !== s) : listing.sizeOptions.filter(x => x === s || listing.sizes.includes(x)) })}>{s}</button>;
              })}</div>
            </div>
            <label className="field"><span>Tags <span className="hint">— comma separated; they decide which store collections it joins</span></span>
              <input className="input" {...fieldText} value={tags} onChange={e => setTags(e.target.value)} placeholder="Floral, Retro, Ancient Egyptian"
                onBlur={() => { const next = tags.split(',').map(t => t.trim()).filter(Boolean); if (next.join() !== listing.tags.join()) patch({ tags: next }); }} /></label>
          </div>

          <div className="panel stack">
            <div className="panel-title" style={{ marginBottom: 0 }}><h2>Search listing</h2><span className="hint">How it can look on Google</span></div>
            <div className="serp" aria-label="Preview of the search result">
              <div className="serp-url">bhippie.com › products › {(listing.shopify && listing.shopify.status !== 'DRAFT' ? listing.shopify.handle : slugOf(title)) || 'your-product'}</div>
              <div className="serp-title">{seoTitle || (title ? `${title} | Hippies Town` : 'Page title')}</div>
              <div className="serp-desc">{seoDescription || 'Not written yet. Until then Shopify gets a short line made from your description.'}</div>
            </div>
            <label className="field"><span>Page title <span className={`hint count${seoTitle.length > 60 ? ' over' : ''}`}>{seoTitle.length} / 60</span></span>
              <input className="input" {...fieldText} value={seoTitle} onChange={e => setSeoTitle(e.target.value)} placeholder={`${title} | Hippies Town`} onBlur={() => blurSave('seoTitle', seoTitle.trim(), listing.seoTitle)} /></label>
            <label className="field"><span>Meta description <span className={`hint count${seoDescription.length > 158 ? ' over' : ''}`}>{seoDescription.length} / 158</span></span>
              <textarea className="textarea" rows={3} value={seoDescription} onChange={e => setSeoDescription(e.target.value)} onBlur={() => blurSave('seoDescription', seoDescription.trim(), listing.seoDescription)}
                placeholder="What is on it, what it is made of, the fit, then Made in Egypt." /></label>
          </div>

          <div className="panel stack" style={{ gap: 10 }}>
            <div className="panel-title" style={{ marginBottom: 0 }}><h2>Shopify checklist</h2><span className={`badge ${allReady ? 'ok' : 'warn'}`}>{ready(listing)}/{listing.checks.length}</span></div>
            {listing.checks.map(c => <div key={c.key} className="row" style={{ gap: 8, fontSize: 13.5 }}><span className={`badge ${c.ok ? 'ok' : 'warn'}`}>{c.ok ? '✓' : '•'}</span>{c.label}</div>)}
            <label className="check" title={!allReady && listing.status !== 'ready' ? 'Finish the checklist above first' : undefined}><input type="checkbox" checked={listing.status === 'ready'} disabled={!allReady && listing.status !== 'ready'}
              onChange={e => patch({ status: e.target.checked ? 'ready' : 'draft' })} /><span>Mark as ready to publish{!allReady && listing.status !== 'ready' && <span className="hint"> — finish the checklist first</span>}</span></label>
          </div>
          <div className="panel stack" style={{ gap: 10 }}>
            <div className="panel-title" style={{ marginBottom: 0 }}><h2>Shopify</h2>
              {listing.shopify ? <span className="badge ok">On Shopify · {listing.shopify.status.toLowerCase()}</span> : listing.shopifyRemovedAt ? <span className="badge warn">Deleted from Shopify</span> : <span className="badge">Not pushed yet</span>}</div>
            {listing.profile && (
              <p className="hint">Set up like the store's {listing.profile.label.toLowerCase()}s: product type “{listing.profile.productType}”, {plural(listing.profile.sizes.length, 'size')} ({listing.profile.sizes.join(', ')}),
                {' '}{listing.profile.price} EGP{listing.profile.compareAt ? ` (was ${listing.profile.compareAt})` : ''}{listing.profile.morePrintsPrice ? `, ${listing.profile.morePrintsPrice} with extra print areas` : ''}, SKUs {listing.profile.skuPrefix}…, keeps selling at zero stock.</p>
            )}
            {listing.shopify && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <a className="btn sm" href={listing.shopify.adminUrl} target="_blank" rel="noreferrer">Open in Shopify</a>
                <span className="hint">pushed {timeAgo(listing.shopify.pushedAt)} · {plural(listing.shopify.variantCount, 'variant')} · {plural(listing.shopify.imageCount, 'photo')}</span>
              </div>
            )}
            {!listing.shopify && listing.shopifyRemovedAt && <p className="hint">This product was deleted in Shopify {timeAgo(listing.shopifyRemovedAt)}. Push it again to recreate it as a draft (its SKUs are reused).</p>}
            {listing.shopify?.warnings.map(w => <div key={w} className="hint">• {w}</div>)}
            <button className="btn" disabled={fill.isPending} onClick={() => run(() => fill.mutateAsync(), 'Sizes and price filled in from the store')}>Fill sizes &amp; price from the store</button>
            <p className="hint">Products are created as <b>drafts</b>, never live. Stock isn't set from here: add quantities in Shopify before you activate one.</p>
          </div>
          <button className="btn ghost danger" onClick={() => setDeleting(true)}>Delete product…</button>
          {deleting && <DeleteProductsModal listings={[listing]} photos={{ [listing.id]: myShoots.length }} onClose={() => setDeleting(false)} onDone={() => navigate('/products')} />}
        </div>

        <div className="stack">
          <div className="panel">
            <div className="panel-title"><h2>Colors · {listing.colors.length}</h2><span className="hint">Each color is a Shopify variant (× {plural(listing.sizes.length, 'size')})</span></div>
            <div className="grid sm">
              {listing.colors.map(c => (
                <Link key={c.mockupId} to={`/mockups/${c.mockupId}`} className="card" style={{ color: 'inherit', textDecoration: 'none' }} title="Open mockup">
                  <div className="media">{c.thumbUrl ? <img src={c.thumbUrl} alt="" loading="lazy" decoding="async" /> : null}</div>
                  <div className="body"><div className="title" style={{ fontSize: 13 }}>{c.color}</div></div>
                </Link>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-title"><h2>Photos · {listing.photoCount}</h2><span className="hint"><span className="desk">Drag to reorder</span><span className="touch">Use the buttons under a photo to reorder</span> · the first one is the cover · hide what you don't want on Shopify</span></div>
            {!media.length ? <Empty title="No photos yet">Shoot photos from this product's mockups and they show up here.</Empty> : (
              <div className="grid">
                {media.map((m, i) => (
                  <div key={m.key} className="card" draggable onDragStart={() => setDrag(m.key)} onDragEnd={() => setDrag(null)}
                    onDragOver={e => e.preventDefault()} onDrop={() => drop(m.key)}
                    style={{ opacity: m.hidden ? 0.4 : drag === m.key ? 0.5 : 1, cursor: 'grab' }}>
                    <button className="media photo tall" onClick={() => setViewKey(m.key)} aria-label={`Open ${m.label}, ${m.color}`} draggable={false}>
                      <img src={m.thumbUrl} alt="" loading="lazy" decoding="async" draggable={false} />
                      {m.key === coverKey && <span className="badge ok" style={{ position: 'absolute', top: 8, left: 8 }}>Cover</span>}
                    </button>
                    <div className="body row" style={{ gap: 6 }}>
                      <div style={{ minWidth: 0, flex: 1 }}><div className="title" style={{ fontSize: 13 }}>{m.label}</div><div className="hint">{m.color}</div></div>
                      <button className="btn sm" title={m.hidden ? 'Include this photo on Shopify again' : 'Keep this photo off Shopify'} onClick={() => toggleHidden(m.key)}>{m.hidden ? 'Show' : 'Hide'}</button>
                    </div>
                    <div className="reorder">
                      <button className="btn sm" disabled={i === 0} onClick={() => move(m.key, i - 1)} aria-label="Move earlier">‹ Earlier</button>
                      <button className="btn sm" disabled={i === media.length - 1} onClick={() => move(m.key, i + 1)} aria-label="Move later">Later ›</button>
                      <button className="btn sm" disabled={m.key === coverKey} onClick={() => makeCover(m.key)}>{m.key === coverKey ? 'Is cover' : 'Make cover'}</button>
                      <button className="btn sm" onClick={() => toggleHidden(m.key)}>{m.hidden ? 'Show' : 'Hide'}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {viewKey && media[at] && <PhotoViewer m={media[at]} index={at} total={media.length} cover={media[at].key === coverKey}
        onClose={() => setViewKey(null)} onPrev={prev && (() => setViewKey(prev.key))} onNext={next && (() => setViewKey(next.key))}
        onCover={() => makeCover(media[at].key)} onHide={() => toggleHidden(media[at].key)} onMove={dir => move(media[at].key, at + dir)} />}
    </>
  );
}

/** Full-size look at one product photo (check the print before it goes to the store), with previous/next through the gallery. */
function PhotoViewer({ m, index, total, cover, onClose, onPrev, onNext, onCover, onHide, onMove }: { m: ListingMedia; index: number; total: number; cover: boolean; onClose: () => void; onPrev?: () => void; onNext?: () => void; onCover: () => void; onHide: () => void; onMove: (dir: -1 | 1) => void }) {
  return (
    <Drawer onClose={onClose} onPrev={onPrev} onNext={onNext} position={`${index + 1} of ${total}`} label={m.label} photo viewer={<img src={m.url} alt={`${m.label}, ${m.color}`} decoding="async" />}>
      <h2>{m.label}</h2>
      <dl className="kv">
        <dt>Color</dt><dd>{m.color}</dd>
        <dt>Kind</dt><dd>{m.kind === 'shoot' ? 'Photo shoot' : 'Mockup render'}</dd>
        <dt>On Shopify</dt><dd>{m.hidden ? <span className="badge warn">Hidden</span> : cover ? <span className="badge ok">Cover</span> : 'Included'}</dd>
      </dl>
      <div className="row">
        <button className="btn sm" disabled={cover} title={cover ? 'This photo is already the cover' : 'Make this the first photo in the store'} onClick={onCover}>{cover ? 'Is the cover' : 'Make cover'}</button>
        <button className="btn sm" onClick={onHide}>{m.hidden ? 'Show on Shopify' : 'Hide from Shopify'}</button>
        <a className="btn sm" href={m.url} target="_blank" rel="noreferrer">Open full size ↗</a>
      </div>
      <div className="row">
        <span className="hint">Order in the store:</span>
        <button className="btn sm" disabled={index === 0} title={index === 0 ? 'Already first' : 'Move this photo one place earlier'} onClick={() => onMove(-1)}>‹ Earlier</button>
        <button className="btn sm" disabled={index === total - 1} title={index === total - 1 ? 'Already last' : 'Move this photo one place later'} onClick={() => onMove(1)}>Later ›</button>
      </div>
      <p className="hint">Check the print closely: AI can change small details. Hide any photo you don't want in the store.</p>
    </Drawer>
  );
}

/** Delete products for real: with their color mockups and, your choice, the photos made from them. Nothing is ever deleted in Shopify from here. */
function DeleteProductsModal({ listings, photos, onClose, onDone }: { listings: Listing[]; photos: Record<string, number>; onClose: () => void; onDone: () => void }) {
  const run = useRun();
  const [alsoPhotos, setAlsoPhotos] = useState(true);
  const one = listings.length === 1;
  const colors = listings.reduce((n, l) => n + l.colors.length, 0);
  const photoCount = listings.reduce((n, l) => n + (photos[l.id] ?? 0), 0);
  const onShopify = listings.filter(l => l.shopify).length;
  const del = useAction(async () => { for (const l of listings) await api.del(`/listings/${l.id}?mockups=1${alsoPhotos ? '&photos=1' : ''}`); }, [['listings'], ['listing'], ['mockups'], ['shoots']]);
  return (
    <Modal title={one ? 'Delete this product?' : `Delete ${listings.length} products?`} onClose={onClose}>
      <div className="stack">
        <p className="confirm-body">{one ? `“${listings[0].title}”` : plural(listings.length, 'product')} will be deleted{colors ? ` with ${plural(colors, 'color')} (the mockups)` : ''}. Your designs stay in the library. This can’t be undone.</p>
        {photoCount > 0 && (
          <label className="check"><input type="checkbox" checked={alsoPhotos} onChange={e => setAlsoPhotos(e.target.checked)} />
            <span>Also delete {plural(photoCount, 'photo')}<br /><span className="hint">Off: the photos stay in Photo shoots, under “Not in a product”.</span></span>
          </label>
        )}
        {onShopify > 0 && (
          <p className="hint">{one ? 'This product is on Shopify.' : `${onShopify} of these ${onShopify === 1 ? 'is' : 'are'} on Shopify.`} Deleting here does not touch your store: delete {one ? 'it' : 'them'} in Shopify too if you want {one ? 'it' : 'them'} gone. The Studio forgets the link, so pushing a new version later creates a new draft.</p>
        )}
        <div className="row"><span className="spacer" />
          <button className="btn" data-autofocus onClick={onClose}>Cancel</button>
          <button className="btn danger-solid" disabled={del.isPending} onClick={() => run(async () => { await del.mutateAsync(); onDone(); }, one ? 'Product deleted' : `${plural(listings.length, 'product')} deleted`)}>{del.isPending ? 'Deleting…' : one ? 'Delete product' : `Delete ${listings.length} products`}</button>
        </div>
      </div>
    </Modal>
  );
}
