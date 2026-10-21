import { useEffect, useState } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { api, useAction, useJobs, useListings, useShopifyStatus, useShopifySync, useStats } from '../api.ts';
import { useGlobalShortcuts, useMedia } from './a11y.ts';
import { ShortcutsDialog } from './Shortcuts.tsx';
import { ConnectionBanner } from './connection.tsx';
import { Elapsed, Modal, niceLabel, useToast } from './ui.tsx';

/** Which kind of page the URL shows; sets the content width (see `main[data-page]` in styles.css) and the browser tab title. */
const pageOf = (path: string) => { const [a, b] = path.split('/').filter(Boolean); return a === 'mockups' && b ? 'editor' : a === 'products' && b ? 'product' : a || 'designs'; };
const TITLES: Record<string, string> = { designs: 'Designs', generate: 'Generate designs', mockups: 'Mockups', editor: 'Mockup editor', shoots: 'Photo shoots', products: 'Products', product: 'Product', shopify: 'Publish to Shopify', presets: 'Models, locations, studios & styles', queue: 'Queue' };

const STEPS = [
  { to: '/designs', label: 'Designs', step: '1', count: 'designs' as const },
  { to: '/generate', label: 'Generate', step: '+' },
  { to: '/mockups', label: 'Mockups', step: '2', count: 'mockups' as const },
  { to: '/shoots', label: 'Photo shoots', step: '3', count: 'shoots' as const },
  { to: '/products', label: 'Products', step: '4', count: 'listings' as const },
];
/** Phone tab bar (<= 900px): the five workflow steps. Everything else is under "More". */
const TABS = [
  { to: '/designs', label: 'Designs', step: '1' },
  { to: '/mockups', label: 'Mockups', step: '2' },
  { to: '/shoots', label: 'Shoots', step: '3' },
  { to: '/products', label: 'Products', step: '4' },
  { to: '/shopify', label: 'Shopify', step: '5' },
];
const MORE = [
  { to: '/generate', label: 'Generate designs', sub: 'Make new prints with Codex', step: '+' },
  { to: '/presets', label: 'Models & locations', sub: 'People, places and styles for photo shoots', step: '◎' },
  { to: '/queue', label: 'Queue', sub: 'Everything Codex is making', step: '≡' },
];

export function Layout() {
  const { data } = useStats();
  const { data: listings = [] } = useListings();
  const onShopify = listings.filter(l => l.shopify).length;
  const toast = useToast();
  const shopify = useShopifyStatus();
  useShopifySync(!!shopify.data?.configured && !shopify.data.error, r => {
    for (const c of r.changed) toast(c.change === 'deleted' ? `“${c.title}” was deleted in Shopify. You can push it again.` : `“${c.title}” is now ${(c.status ?? '').toLowerCase()} in Shopify.`);
  });
  const resume = useAction(() => api.post('/queue/resume'));
  const q = data?.queue;
  const active = q ? q.queued + q.running : 0;
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  const inMore = MORE.some(m => pathname.startsWith(m.to));
  const page = pageOf(pathname);
  useEffect(() => { document.title = `${TITLES[page] ?? 'Studio'} · Hippies Town Studio · made by Kiro`; }, [page]);
  // The sidebar shrinks to an icon rail on small windows (under 1200px), and on the editor below 1500px so the canvas gets the room.
  const small = useMedia('(min-width: 901px) and (max-width: 1199px)');
  const tight = useMedia('(min-width: 901px) and (max-width: 1499px)');
  const rail = small || (tight && page === 'editor');
  const [help, setHelp] = useState(false);
  useGlobalShortcuts(() => setHelp(true));
  const { data: working = [] } = useJobs('active', active > 0);
  const now = [...working].reverse().find(j => j.status === 'running') ?? working[working.length - 1]; // the job that has been going the longest (the list is newest first)
  const pill = (onClick?: () => void) => (
    <NavLink to="/queue" className={`queue-pill${q?.paused ? ' paused' : ''}`} onClick={onClick} title={q?.paused ? 'Codex is paused' : active ? `${q!.running} running, ${q!.queued} waiting` : 'Codex is idle'}>
      <strong>{active ? <span className="pulse" /> : <span className="idle-dot" />}<span className="lbl">{q?.paused ? 'Codex paused' : active ? `Codex working · ${q!.running} running` : 'Codex idle'}</span></strong>
      {active > 0 && <span className="pill-n">{active}</span>}
      {active > 0 && now && <div className="pill-job">{niceLabel(now.label)}{now.status === 'running' && <> · <Elapsed from={now.startedAt ?? now.createdAt} /></>}</div>}
      {active > 0 && <div className="pill-sub">{q!.queued} waiting · up to {q!.concurrency} at once</div>}
      {q?.lastError && <div className="err">Last error: {q.lastError}</div>}
    </NavLink>
  );
  const short = q?.paused ? 'Codex paused' : active ? `Codex · ${q!.running} running${q!.queued ? ` · ${q!.queued} queued` : ''}` : 'Codex idle';
  return (
    <div className={`shell${rail ? ' rail' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar" aria-label="Sidebar">
        <div className="brand" title="Hippies Town Studio · made by Kiro"><span className="mark rail-only" aria-hidden="true">H</span><div><img className="brand-logo" src="/logo.png" alt="Hippies Town" /><small>STUDIO · <span className="kiro">made by Kiro</span></small></div></div>
        <nav className="nav" aria-label="Workflow">
          <div className="nav-label" aria-hidden="true">WORKFLOW</div>
          {STEPS.map(s => (
            <NavLink key={s.to} to={s.to} title={s.label} aria-label={rail ? s.label : undefined}>
              <span className="step">{s.step}</span><span className="lbl">{s.label}</span>
              {s.count && data && <span className="count">{data.counts[s.count]}</span>}
            </NavLink>
          ))}
          <NavLink to="/shopify" title="Publish to Shopify" aria-label={rail ? 'Publish to Shopify' : undefined}><span className="step">5</span><span className="lbl">Publish to Shopify</span>{onShopify > 0 && <span className="count">{onShopify}</span>}</NavLink>
          <div className="nav-label" aria-hidden="true">LIBRARY</div>
          <NavLink to="/presets" title="Models & locations" aria-label={rail ? 'Models and locations' : undefined}><span className="step">◎</span><span className="lbl">Models &amp; locations</span></NavLink>
          <NavLink to="/queue" title="Queue" aria-label={rail ? 'Queue' : undefined}><span className="step">≡</span><span className="lbl">Queue</span>{active > 0 && <span className="count">{active}</span>}</NavLink>
        </nav>
        {pill()}
        <button className="side-help" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><kbd>?</kbd><span className="lbl">Keyboard shortcuts</span></button>
        <div className="side-foot lbl">Art Connect People · <span className="kiro">another Kiro masterpiece</span></div>
      </aside>

      <header className="topbar">
        <div className="brand"><span className="mark" aria-hidden="true">H</span><div><span className="brand-name">Hippies Town</span><small><span className="kiro">♥ by Kiro</span></small></div></div>
        <NavLink to="/queue" className="status-pill" aria-label={`${short}. Open the queue`}>
          {active ? <span className="pulse" /> : <span className="idle-dot" />}
          <span className="txt">{short.startsWith('Codex · ') ? <><span className="pre">Codex · </span>{short.slice(8)}</> : short}</span>
          {(q?.paused || q?.lastError) && <span className="warn-dot" />}
        </NavLink>
      </header>

      <main className="main" id="main" tabIndex={-1} data-page={page}>
        {q?.paused && <div role="alert" className="nextstep warn">
          <div><b>{q.paused.reason}</b> — queue paused until {new Date(q.paused.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Nothing new starts until then.</div>
          <button className="btn sm" disabled={resume.isPending} onClick={() => resume.mutate()}>Resume now</button>
        </div>}
        <ConnectionBanner />
        <Outlet />
      </main>
      <ScrollRestoration getKey={l => (l.key === 'default' ? `default:${l.pathname}` : l.key)} />

      <nav className="tabbar" aria-label="Main">
        {TABS.map(t => <NavLink key={t.to} to={t.to} className="tab"><span className="step">{t.step}</span><span>{t.label}</span></NavLink>)}
        <button className={`tab${inMore || more ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
          <span className="step">⋯{active > 0 && <i className="dot" />}</span><span>More</span>
        </button>
      </nav>
      {more && (
        <Modal title="More" onClose={() => setMore(false)}>
          <div className="more-list">
            {MORE.map(m => (
              <NavLink key={m.to} to={m.to} onClick={() => setMore(false)}>
                <span className="step">{m.step}</span>
                <span className="grow"><b>{m.label}</b><small>{m.to === '/queue' ? (active ? `${active} in progress` : 'Nothing running') : m.sub}</small></span>
                {m.to === '/queue' && active > 0 && <span className="count">{active}</span>}
                <span className="chev" aria-hidden="true">›</span>
              </NavLink>
            ))}
          </div>
          {pill(() => setMore(false))}
        </Modal>
      )}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
    </div>
  );
}
