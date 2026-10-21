// Phone-only Back button support for sheets, drawers and dialogs (Android Back, iOS edge swipe).
//
// Without this, Back leaves the page while a sheet is open. While a sheet is open on a phone we keep ONE extra history entry for it: the same URL,
// plus a marker in `history.state`. Back then lands on the entry below and closes the sheet. Rules this file keeps:
//  - Moves between entries of the SAME page (a sheet opening or closing) never reach the router: its Pop handler would see a "navigation" to where
//    it already is (and a blocker such as the editor's unsaved-changes guard would answer it with history.go(0), a reload). A capture listener on
//    `window`, registered before the router's own, swallows them. This is why the module must be imported before `createBrowserRouter` runs.
//  - A sheet closed by the app (✕, backdrop, Esc, an action) takes its own entry away again (history.back), so Back afterwards still goes to the
//    previous page.
//  - A sheet that goes away because the page navigated (a link inside it) leaves its entry behind in the middle of the history. Going Back onto such a
//    "ghost" entry is skipped in the same gesture, so the user sees one step back, not two.
//  - On desktop (decided when the sheet opens: `(max-width: 900px)`) none of this runs.
import { useEffect, useRef } from 'react';

const KEY = '__sheet';
const PHONE = '(max-width: 900px)';
type Mark = { t: string; d: number }; // token (unique per sheet) and depth (1 = first sheet on this page entry)
type Item = { tok: string; depth: number; idx: number | null; close: () => void; popped: boolean; timer: number };
type Ent = { idx: number | null; tok: string | null; depth: number };

const read = (): Ent => {
  const s = history.state as { idx?: unknown; [KEY]?: Mark } | null;
  return { idx: typeof s?.idx === 'number' ? s.idx : null, tok: s?.[KEY]?.t ?? null, depth: s?.[KEY]?.d ?? 0 };
};

const w = window as unknown as { __hippiesSheets?: { dispose: () => void }; __sheetDebug?: () => unknown };
w.__hippiesSheets?.dispose(); // dev hot reload: replace the previous copy of this module

const live: Item[] = [];
const pending = new Set<Item>(); // sheets that unmounted this very tick: another sheet opening in the same commit takes over their entry
let cur = read(); // the history entry we are on (kept in sync by the wrappers below and by popstate)
let swallow = 0; // history.back() calls of our own: their popstate is not the router's business
let pass = false; // the next popstate is the second half of a ghost skip: the router has to see it
let routed = -1e9; // when the router last had to handle a Back/Forward between pages (see open())
let timers: number[] = [];
const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers = timers.filter(x => x !== t); fn(); }, ms); timers.push(t); };

// Keep `cur` exact: the router pushes and replaces entries without any popstate.
const push0 = history.pushState.bind(history), replace0 = history.replaceState.bind(history);
history.pushState = (...a: Parameters<History['pushState']>) => { push0(...a); cur = read(); };
history.replaceState = (...a: Parameters<History['replaceState']>) => { replace0(...a); cur = read(); };

/** Sheets that sit above the entry we landed on are gone: tell them to close. */
const closeAbove = (land: Ent) => {
  for (let i = live.length - 1; i >= 0; i--) {
    const it = live[i];
    if (it.idx === land.idx ? it.depth > land.depth : (it.idx ?? 0) > (land.idx ?? 0)) { it.popped = true; live.splice(i, 1); it.close(); }
  }
};

const onPop = (e: PopStateEvent) => {
  const prev = cur;
  const land = (cur = read());
  if (swallow > 0) { swallow--; e.stopImmediatePropagation(); return; }
  closeAbove(land);
  if (pass) { pass = false; routed = performance.now(); return; } // second half of a ghost skip
  if (prev.idx !== null && prev.idx === land.idx) { e.stopImmediatePropagation(); return; } // a sheet opened or closed on the same page: the router must not hear about it
  const ghost = !!land.tok && !live.some(i => i.tok === land.tok);
  if (ghost && prev.idx !== null && land.idx !== null && prev.idx > land.idx) { // Back from a later page onto a ghost: step over it
    e.stopImmediatePropagation();
    const below = Math.max(0, ...live.filter(i => i.idx === land.idx && i.depth < land.depth).map(i => i.depth));
    pass = true; later(() => { pass = false; }, 600);
    history.go(below - land.depth);
    return;
  }
  routed = performance.now();
};
window.addEventListener('popstate', onPop, true);

// Reload with a sheet open: the sheet is gone but its marker is still on the current entry. Make it an ordinary entry.
if (cur.tok) { const s = { ...(history.state as object) } as Record<string, unknown>; delete s[KEY]; history.replaceState(s, ''); }

w.__hippiesSheets = { dispose: () => { window.removeEventListener('popstate', onPop, true); history.pushState = push0; history.replaceState = replace0; timers.forEach(clearTimeout); } };
if (import.meta.env.DEV) w.__sheetDebug = () => ({ cur, live: live.map(i => `${i.depth}@${i.idx}${i.popped ? ' popped' : ''}`), swallow, pass, len: history.length });

/** A sheet opened: add its history entry (phones only). Returns null when nothing was added. */
function open(close: () => void): Item | null {
  if (!window.matchMedia(PHONE).matches) return null;
  // A dialog that opens right after the router handled a Back (the editor's "Leave without saving?" after a blocked Back) must not add an entry:
  // the router is about to run history.go(±1) relative to where it thinks it is, and a marker on top would make it land one entry short.
  if (performance.now() - routed < 1200) return null;
  for (const p of pending) if (!p.popped && cur.tok === p.tok) { clearTimeout(p.timer); pending.delete(p); p.close = close; return p; } // one dialog replacing another (a sheet closing as a "Leave without saving?" opens)
  const tok = Math.random().toString(36).slice(2, 10), depth = live.filter(i => i.idx === cur.idx).length + 1;
  try { push0({ ...(history.state as object), [KEY]: { t: tok, d: depth } satisfies Mark }, ''); } catch { return null; } // iOS rate-limits pushState
  const at = read(); cur = at;
  const it: Item = { tok, depth, idx: at.idx, close, popped: false, timer: 0 };
  live.push(it);
  return it;
}

/** A sheet went away. If the app closed it (not Back) and its entry is still the one we are on, remove that entry. */
function release(it: Item) {
  const i = live.indexOf(it);
  if (i >= 0) live.splice(i, 1);
  if (it.popped) return;
  const own = cur.tok === it.tok, orphan = cur.tok === null && cur.depth === 0 && cur.idx === it.idx; // orphan: a same-URL <Link> click replaced the marker
  if (own || orphan) { swallow++; later(() => { if (swallow) swallow--; }, 600); history.back(); }
  // otherwise the page navigated on top of it: the entry stays behind as a ghost and is skipped when the user comes back to it
}

/** Call from every `Modal` / `Drawer`: on phones, Back (or the iOS edge swipe) closes it instead of leaving the page. */
export function useSheetHistory(onClose: () => void) {
  const cb = useRef(onClose);
  cb.current = onClose;
  const me = useRef<Item | null>(null);
  useEffect(() => {
    if (!me.current) me.current = open(() => cb.current());
    const it = me.current;
    if (it) { clearTimeout(it.timer); pending.delete(it); } // React StrictMode runs effect, cleanup, effect on mount: keep the one entry
    return () => { if (it) { pending.add(it); it.timer = window.setTimeout(() => { pending.delete(it); release(it); if (me.current === it) me.current = null; }, 0); } };
  }, []);
}
