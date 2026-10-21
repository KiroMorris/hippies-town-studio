import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Listing, ShopifySyncResult } from '../../shared/types.ts';
import { api, useListings, useShopifyProfiles, useShopifyStatus } from '../api.ts';
import { QueryError, RowSkeleton } from '../components/states.tsx';
import { Empty, plural, timeAgo, useToast } from '../components/ui.tsx';

/** The sizes a push will use: the product's own choice among the store's sizes, or all of the store's sizes. */
const sizesOf = (l: Listing) => {
  if (!l.profile) return l.sizes;
  const chosen = l.profile.sizes.filter(s => l.sizes.includes(s));
  return chosen.length ? chosen : l.profile.sizes;
};
const variantsOf = (l: Listing) => {
  const colors = new Set(l.colors.map(c => c.color)).size;
  return (colors > 1 ? colors : 1) * sizesOf(l).length;
};

export function ShopifyPage() {
  const status = useShopifyStatus();
  const profiles = useShopifyProfiles();
  const { data: listings = [], isPending: isLoading, isError, error, refetch } = useListings();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string[]>([]);
  const connected = !!status.data?.configured && !status.data.error;
  const families = profiles.data && 'families' in profiles.data ? profiles.data : null;
  const waitingToPush = listings.filter(l => !l.shopify && !l.shopifyRemovedAt && l.profile); // products you deleted in Shopify are never pushed back unasked
  const todo = waitingToPush.filter(l => l.checks.every(c => c.ok)); // "Push all" sends only finished products: a draft with no photos or story would just have to be fixed in the store
  const unfinished = waitingToPush.length - todo.length;
  const pushed = listings.filter(l => l.shopify).length;
  const needsWriting = listings.filter(l => l.checks.some(c => c.key === 'description' && !c.ok) || !l.tags.length);
  const [asking, setAsking] = useState(false);
  const writeMissing = async () => {
    setAsking(true);
    try {
      const r = await api.post<{ jobIds: string[] }>('/listings/write-missing');
      qc.invalidateQueries({ queryKey: ['jobs'] });
      toast(r.jobIds.length ? `Codex is writing the details for ${plural(r.jobIds.length, 'product')}. Watch the Queue; each takes about a minute.` : 'Every product already has its details');
    } catch (e) { toast(e instanceof Error ? e.message : String(e), true); } finally { setAsking(false); }
  };

  const pushOne = async (l: Listing) => {
    setBusy(l.id);
    try {
      await api.post(`/listings/${l.id}/shopify/push`);
      toast(l.shopify ? `Updated “${l.title}” on Shopify` : `Pushed “${l.title}” to Shopify as a draft`);
      return true;
    } catch (e) {
      toast(`${l.title}: ${e instanceof Error ? e.message : String(e)}`, true);
      return false;
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: ['listing', l.id] });
    }
  };
  const pushAll = async () => {
    setWaiting(todo.map(l => l.id));
    let ok = 0;
    for (const l of todo) { if (await pushOne(l)) ok++; setWaiting(w => w.filter(id => id !== l.id)); }
    toast(`${ok} of ${todo.length} pushed as drafts`, ok < todo.length);
  };
  const [checking, setChecking] = useState(false);
  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api.post<ShopifySyncResult>('/shopify/sync');
      qc.invalidateQueries({ queryKey: ['listings'] });
      toast(r.changed.length ? r.changed.map(c => (c.change === 'deleted' ? `“${c.title}” was deleted in Shopify` : `“${c.title}” is now ${(c.status ?? '').toLowerCase()}`)).join(' · ') : `Checked ${plural(r.checked, 'product')}: everything matches Shopify`);
    } catch (e) { toast(e instanceof Error ? e.message : String(e), true); } finally { setChecking(false); }
  };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Step 5 · <span className="kiro">♥ by Kiro</span></div><h1>Publish to Shopify</h1>
          <p>Products are created in your store as <b>drafts</b>, set up like your existing products of the same type. Review them in Shopify, add stock, then activate.</p></div>
        <div className="row">
          {needsWriting.length > 0 && <button className="btn" disabled={asking} onClick={writeMissing}
            title="Codex writes the title, description, tags and search listing for every product that has none yet. Anything you wrote yourself is left alone.">{asking ? 'Asking…' : `Write details for ${plural(needsWriting.length, 'product')}`}</button>}
          <button className="btn lime" disabled={!connected || !todo.length || !!busy} onClick={pushAll}
            title={!connected ? 'Shopify is not connected yet (see below)' : busy ? 'A push is running' : !todo.length ? (unfinished ? `${plural(unfinished, 'product')} still miss photos or details: finish them first, or push one by one` : 'Every product that can be pushed is already on Shopify') : `Creates ${plural(todo.length, 'draft')} in your store, one after the other${unfinished ? `. ${plural(unfinished, 'unfinished product')} left out.` : ''}`}>
            {busy && waiting.length ? `Pushing… ${waiting.length} left` : todo.length ? `Push ${plural(todo.length, 'finished product')} to Shopify` : unfinished ? `${plural(unfinished, 'product')} not finished yet` : listings.some(l => !l.shopify) ? 'Nothing new to push' : 'Everything is on Shopify'}
          </button>
        </div>
      </div>

      <div className="panel stack" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 10 }}>
          <span className={`badge ${connected ? 'ok' : 'warn'}`}>{connected ? 'Connected' : 'Not connected'}</span>
          <strong>{status.data?.shop ?? status.data?.domain ?? 'Shopify'}</strong>
          {status.data?.domain && <span className="hint">{status.data.domain}</span>}
          <span className="spacer" />
          <span className="hint">{plural(pushed, 'product')} on Shopify · {plural(listings.length - pushed, 'product')} not</span>
          <button className="btn sm" disabled={!connected || checking} title={connected ? 'Asks Shopify whether the pushed products still exist and what status they have' : 'Shopify is not connected yet'} onClick={checkNow}>{checking ? 'Checking…' : 'Check Shopify now'}</button>
        </div>
        {!status.isLoading && !connected && <p className="hint">{status.data?.error ?? 'Add SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN to studio/.env and restart the server to connect.'}</p>}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-title"><h2>Your products · {listings.length}</h2><span className="hint">Open a product to change its title, description, price or photos</span></div>
        {isError && !listings.length ? <QueryError what="your products" error={error} onRetry={() => refetch()} />
          : isLoading ? <RowSkeleton count={4} />
          : !listings.length ? <Empty title="No products yet">Products are created automatically when you make a mockup with a design on it.</Empty> : listings.map(l => {
          const colors = new Set(l.colors.map(c => c.color)).size;
          const ok = l.checks.filter(c => c.ok).length, missing = l.checks.filter(c => !c.ok).map(c => c.label).join(', ');
          const price = l.price ?? l.profile?.price;
          const mine = busy === l.id, queued = waiting.includes(l.id) && !mine;
          return (
            <div key={l.id} className="prow">
              <div style={{ width: 64, height: 80, borderRadius: 8, overflow: 'hidden', background: 'var(--soft)' }}>
                {l.coverUrl && <img src={l.coverUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div className="stack" style={{ gap: 5, minWidth: 0 }}>
                <Link to={`/products/${l.id}`} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none' }}>{l.title}</Link>
                <div className="hint">
                  {l.profile ? `${l.profile.productType} · ${l.profile.templateSuffix ?? 'default template'}` : 'No store profile for this garment yet'}
                  {' · '}{plural(variantsOf(l), 'variant')}{colors > 1 ? ` (${plural(colors, 'color')} × ${plural(sizesOf(l).length, 'size')})` : ` (${sizesOf(l).join(', ')})`}
                  {price ? ` · ${price} EGP` : ''}{' · '}{plural(l.photoCount, 'photo')}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {l.shopify ? <span className="badge ok">On Shopify · {l.shopify.status.toLowerCase()}</span> : l.shopifyRemovedAt ? <span className="badge warn">Deleted from Shopify</span> : <span className="badge">Not on Shopify yet</span>}
                  <span className={`badge ${ok === l.checks.length ? 'ok' : 'warn'}`} title={missing ? `Missing: ${missing}` : 'Everything on the checklist is done'}>{ok}/{l.checks.length} checklist</span>
                  {!l.shopify && l.shopifyRemovedAt && <span className="hint">deleted {timeAgo(l.shopifyRemovedAt)} · not in your store any more</span>}
                  {l.shopify && <span className="hint">pushed {timeAgo(l.shopify.pushedAt)} · {plural(l.shopify.variantCount, 'variant')} · {plural(l.shopify.imageCount, 'photo')}</span>}
                </div>
                {!l.shopify && !l.shopifyRemovedAt && ok < l.checks.length && <div className="hint">Not finished: {missing}. {l.checks.some(c => c.key === 'photos' && !c.ok) ? <Link to={`/shoots?mockups=${l.colors.map(c => c.mockupId).join(',')}`}>Shoot photos</Link> : <Link to={`/products/${l.id}`}>Open the product</Link>}</div>}
                {l.shopify?.warnings.map(w => <div key={w} className="hint">• {w}</div>)}
              </div>
              <div className="row" style={{ gap: 6 }}>
                {l.shopify && <a className="btn sm" href={l.shopify.adminUrl} target="_blank" rel="noreferrer">Open in Shopify</a>}
                <button className={`btn sm${l.shopify ? '' : ' lime'}`} disabled={!connected || !l.profile || !!busy} onClick={() => pushOne(l)}
                  title={!connected ? 'Shopify is not connected yet' : !l.profile ? 'There is no store profile for this garment yet, so a push would not know how to set it up' : busy && !mine ? 'Another push is running' : undefined}>
                  {mine ? 'Pushing…' : queued ? 'Waiting…' : l.shopify ? 'Update' : l.shopifyRemovedAt ? 'Push again' : 'Push as draft'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <details className="panel" style={{ marginTop: 14 }}>
        <summary className="panel-title" style={{ cursor: 'pointer', marginBottom: 0 }}><h2>How your store sets each type up</h2>
          {families && <span className="hint">read from {plural(families.store.productCount, 'product')} in {families.store.name} · {timeAgo(families.generatedAt)}</span>}</summary>
        {!families ? <p className="hint" style={{ marginTop: 10 }}>Not read yet. Ask Claude to read your store settings (scripts/shopify-profiles.mjs).</p> : (
          <>
            <p className="hint" style={{ margin: '10px 0' }}>A push copies these settings so new products look like the ones you already sell. Active products sit on {families.channels.length} sales channels ({families.channels.join(', ')}); drafts stay hidden until you activate them.</p>
            <div className="table-wrap">
              <table className="conv">
                <thead><tr>{['Garment in the Studio', 'Store product type', 'Template', 'Sizes', 'Price (EGP)', 'SKUs', 'At zero stock'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {families.families.map(f => (
                    <tr key={f.key}>
                      <td><strong>{f.label}</strong><div className="hint">{f.styles.join(', ') || '—'}</div></td>
                      <td data-label="Product type">{f.productType}</td>
                      <td data-label="Template">{f.template ?? 'default'}</td>
                      <td data-label="Sizes"><div><b>{plural(f.sizes.length, 'size')}</b><div className="hint">{f.optionName}: {f.sizes.join(', ')}</div></div></td>
                      <td data-label="Price (EGP)"><div>{f.price}{f.compareAt ? <span className="hint"> (was {f.compareAt})</span> : ''}{f.morePrintsPrice ? <div className="hint">{f.morePrintsPrice} with extra prints</div> : null}</div></td>
                      <td data-label="SKUs">{f.skuPrefix}…</td>
                      <td data-label="At zero stock">Keeps selling</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </details>
    </>
  );
}
