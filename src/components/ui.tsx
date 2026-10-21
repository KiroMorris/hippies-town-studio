import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useDialog } from './a11y.ts';
import { useSheetHistory } from './sheets.ts';
import { useViewerGestures } from './gestures.ts';

// ---------- toasts ----------
export type ToastAction = { label: string; run: () => void };
type Toast = { id: number; text: string; error?: boolean; n: number; action?: ToastAction };
const ToastCtx = createContext<(text: string, error?: boolean, action?: ToastAction) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// ---------- confirm dialog (replaces the browser's confirm(), which looks foreign and blocks the page) ----------
export type ConfirmOpts = { title: string; body?: ReactNode; confirm?: string; cancel?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(() => Promise.resolve(false));
/** `const ask = useConfirm(); if (await ask({ title: 'Delete it?', danger: true })) …` */
export const useConfirm = () => useContext(ConfirmCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const list = useRef<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const commit = (next: Toast[]) => { list.current = next; setToasts(next); };
  const dismiss = useCallback((id: number) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); commit(list.current.filter(x => x.id !== id)); }, []);
  const arm = useCallback((id: number, ms: number) => { clearTimeout(timers.current.get(id)); timers.current.set(id, setTimeout(() => dismiss(id), ms)); }, [dismiss]);
  const push = useCallback((text: string, error = false, action?: ToastAction) => {
    const dup = list.current.find(x => x.text === text && !!x.error === error); // the same message again counts up instead of stacking
    const id = dup ? dup.id : Date.now() + Math.random();
    commit(dup ? list.current.map(x => (x.id === id ? { ...x, n: x.n + 1, action: action ?? x.action } : x)) : [...list.current.slice(-3), { id, text, error, n: 1, action }]);
    arm(id, error || action ? 8000 : 4000);
  }, [arm]);
  const [ask, setAsk] = useState<(ConfirmOpts & { done: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>(done => setAsk({ ...o, done })), []);
  const answer = (ok: boolean) => { ask?.done(ok); setAsk(null); };
  const item = (t: Toast) => (
    <div key={t.id} className={`toast${t.error ? ' error' : ''}`} onMouseEnter={() => clearTimeout(timers.current.get(t.id))} onMouseLeave={() => arm(t.id, 2500)}>
      <span>{t.text}{t.n > 1 && <b className="toast-n"> ×{t.n}</b>}</span>
      {t.action && <button className="toast-act" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
      <button className="toast-x" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(t.id)}>✕</button>
    </div>
  );
  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <div className="toasts">
          <div className="toast-list" role="status" aria-live="polite">{toasts.filter(t => !t.error).map(item)}</div>
          <div className="toast-list" role="alert">{toasts.filter(t => t.error).map(item)}</div>
        </div>
        {ask && (
          <Modal title={ask.title} onClose={() => answer(false)}>
            <div className="stack">
              {ask.body && <p className="confirm-body">{ask.body}</p>}
              <div className="row"><span className="spacer" />
                <button className="btn" data-autofocus={ask.danger || undefined} onClick={() => answer(false)}>{ask.cancel ?? 'Cancel'}</button>
                <button className={`btn ${ask.danger ? 'danger-solid' : 'primary'}`} data-autofocus={!ask.danger || undefined} onClick={() => answer(true)}>{ask.confirm ?? (ask.danger ? 'Delete' : 'OK')}</button>
              </div>
            </div>
          </Modal>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

/** Run an async action and toast its error message. */
export function useRun() {
  const toast = useToast();
  return useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    try { const out = await fn(); if (success) toast(success); return out; }
    catch (e) { toast(e instanceof Error ? e.message : String(e), true); return undefined; }
  }, [toast]);
}

// ---------- overlays ----------
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  // On phones the modal is a bottom sheet: dragging its header down dismisses it (touch and pen only; a mouse keeps the ✕ button).
  const sheet = useRef<HTMLDivElement>(null);
  useDialog(sheet, { onClose }); // focus trap, Esc (top dialog only), focus back to the opener
  useSheetHistory(onClose); // phones: Back closes the sheet
  const swipe = useRef<{ y: number; on: boolean } | null>(null);
  const down = (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') swipe.current = { y: e.clientY, on: false }; };
  const move = (e: React.PointerEvent) => {
    const s = swipe.current;
    if (!s || !sheet.current) return;
    if (!s.on && Math.abs(e.clientY - s.y) > 8) { s.on = true; e.currentTarget.setPointerCapture(e.pointerId); } // capture only once it is a drag, so taps on ✕ still click
    if (s.on) sheet.current.style.transform = `translateY(${Math.max(0, e.clientY - s.y)}px)`;
  };
  const up = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s?.on || !sheet.current) return;
    sheet.current.style.transform = '';
    if (e.type === 'pointerup' && e.clientY - s.y > 90) onClose();
  };
  return (
    <div className="backdrop center" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={sheet} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

/**
 * Viewer + details. `onPrev`/`onNext` (when the viewer is one of a list) add previous/next buttons and make the Left/Right arrow keys work;
 * leave one undefined at either end of the list. `position` is the "3 of 14" hint. Touch gestures can call the same two props.
 */
export function Drawer({ onClose, viewer, children, photo, onPrev, onNext, position, label }: { onClose: () => void; viewer: ReactNode; children: ReactNode; photo?: boolean; onPrev?: () => void; onNext?: () => void; position?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { onClose, onPrev, onNext });
  useSheetHistory(onClose); // phones: Back closes the drawer
  const viewerRef = useViewerGestures({ onPrev, onNext }); // phones: pinch / pan / double-tap zoom and swipe between photos
  const nav = !!(onPrev || onNext);
  return (
    <div className="backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={label ?? 'Details'}>
        <div className="sheet-bar">{position && <span className="viewer-count">{position}</span>}<button className="btn ghost" onClick={onClose} aria-label="Close">✕ Close</button></div>
        <div ref={viewerRef} className={`viewer${photo ? ' photo' : ''}`}>
          {viewer}
          {nav && <>
            <button className="viewer-nav prev" onClick={onPrev} disabled={!onPrev} aria-label="Previous" aria-keyshortcuts="ArrowLeft" title="Previous (←)">‹</button>
            <button className="viewer-nav next" onClick={onNext} disabled={!onNext} aria-label="Next" aria-keyshortcuts="ArrowRight" title="Next (→)">›</button>
          </>}
        </div>
        <div className="side">
          <div className="row close-row">{position && <span className="viewer-count" aria-live="polite">{position}</span>}<span className="spacer" /><button className="btn ghost sm" onClick={onClose} aria-label="Close" title="Close (Esc)">✕ Close</button></div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Phone-only switch between the two columns of a `.split` page: pass the same value as `data-pane` on the split (see `.pane-switch` in styles.css). */
export function PaneSwitch({ items, value, onChange }: { items: [number, ReactNode][]; value: number; onChange: (pane: number) => void }) {
  return <div className="seg pane-switch">{items.map(([n, label]) => <button key={n} className={value === n ? 'on' : ''} aria-pressed={value === n} onClick={() => onChange(n)}>{label}</button>)}</div>;
}

export const Empty = ({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) => (
  <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{actions && <div className="row">{actions}</div>}<small className="kiro">♥ by Kiro</small></div>
);

// ---------- files ----------
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const imagesOnly = (files: FileList | File[]) => Array.from(files).filter(f => IMAGE_TYPES.includes(f.type));

const HTTP = /^https?:\/\/\S+$/i;
/** Image addresses in a drag or paste from another tab: a dragged <img>'s own address first, then plain links. */
export function linksFromData(dt: { getData(type: string): string }): string[] {
  const img = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(dt.getData('text/html'))?.[1]?.replace(/&amp;/g, '&');
  if (img && (HTTP.test(img) || /^data:image\//i.test(img))) return [img];
  const plain = [...dt.getData('text/uri-list').split(/\r?\n/), ...dt.getData('text/plain').split(/\s+/)].map(s => s.trim()).filter(s => HTTP.test(s));
  return [...new Set(plain)].slice(0, 12);
}
const foreign = (l: string) => { try { return new URL(l).origin !== location.origin; } catch { return false; } };
/** Hand dragged or pasted addresses on: web links go to `onUrls` (the server downloads them), inline data: images become files. */
function routeLinks(links: string[], onFiles: (f: File[]) => void, onUrls: (u: string[]) => void) {
  const web = links.filter(l => HTTP.test(l) && foreign(l));
  if (web.length) onUrls(web);
  const inline = links.filter(l => /^data:image\//i.test(l));
  if (inline.length) {
    Promise.all(inline.map(async (l, i) => { const b = await (await fetch(l)).blob(); return new File([b], `pasted-image-${i + 1}`, { type: b.type }); }))
      .then(f => onFiles(imagesOnly(f))).catch(() => { /* not a readable image */ });
  }
}

/** A button that opens the file picker (a label around a hidden input cannot be reached with the keyboard). */
export function FileButton({ children, className = 'btn', multiple, title, disabled, onFiles }: { children: ReactNode; className?: string; multiple?: boolean; title?: string; disabled?: boolean; onFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} title={title} disabled={disabled} onClick={() => input.current?.click()}>{children}</button>
      <input ref={input} type="file" hidden multiple={multiple} accept={IMAGE_TYPES.join(',')} aria-hidden="true" tabIndex={-1} onChange={e => { const f = imagesOnly(e.target.files ?? []); if (f.length) onFiles(f); e.target.value = ''; }} />
    </>
  );
}

/** Click-or-drop area for image files. On phones (no dragging) it shows the `touch*` wording instead. */
export function DropZone({ onFiles, onUrls, title, hint, touchTitle, touchHint = 'Tap to choose a photo', multiple = true }: { onFiles: (f: File[]) => void; onUrls?: (urls: string[]) => void; title: string; hint?: string; touchTitle?: string; touchHint?: string; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone${over ? ' over' : ''}`} role="button" tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = imagesOnly(e.dataTransfer.files); if (f.length) onFiles(multiple ? f : f.slice(0, 1)); else if (onUrls) routeLinks(linksFromData(e.dataTransfer), onFiles, onUrls); }}
    >
      <strong>{touchTitle ? <><span className="desk">{title}</span><span className="touch">{touchTitle}</span></> : title}</strong>
      {hint && <span className="hint"><span className="desk">{hint}</span><span className="touch">{touchHint}</span></span>}
      <input ref={input} type="file" hidden multiple={multiple} accept={IMAGE_TYPES.join(',')}
        onChange={e => { const f = imagesOnly(e.target.files ?? []); if (f.length) onFiles(f); e.target.value = ''; }} />
    </div>
  );
}

/**
 * Drop image files anywhere on the page. Shows a full-screen overlay while dragging.
 * With `onUrls` it also takes images dragged in from another tab, and links or images pasted with Cmd/Ctrl+V.
 */
export function usePageDrop(onFiles: (f: File[]) => void, label: string, sub?: string, onUrls?: (urls: string[]) => void) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const cb = useRef(onFiles);
  cb.current = onFiles;
  const urls = useRef(onUrls);
  urls.current = onUrls;
  useEffect(() => {
    const dragged = (e: DragEvent) => { const t = e.dataTransfer?.types ?? []; return t.includes('Files') || (!!urls.current && t.includes('text/uri-list')); };
    const enter = (e: DragEvent) => { if (!dragged(e)) return; depth.current++; setActive(true); };
    const leave = (e: DragEvent) => { if (!dragged(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setActive(false); };
    const over = (e: DragEvent) => { if (dragged(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!dragged(e)) return;
      e.preventDefault(); depth.current = 0; setActive(false);
      const f = imagesOnly(e.dataTransfer!.files);
      if (f.length) cb.current(f);
      else if (urls.current) routeLinks(linksFromData(e.dataTransfer!), cb.current, urls.current);
    };
    const paste = (e: ClipboardEvent) => {
      if (!urls.current || !e.clipboardData) return;
      const f = imagesOnly(e.clipboardData.files);
      if (f.length) { e.preventDefault(); cb.current(f); return; }
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return; // pasting text into a field stays normal
      const links = linksFromData(e.clipboardData);
      if (links.length) { e.preventDefault(); routeLinks(links, cb.current, urls.current); }
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop); window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); window.removeEventListener('paste', paste);
    };
  }, []);
  return active ? <div className="drop-overlay"><div>{label}{sub && <small>{sub}</small>}</div></div> : null;
}

// ---------- selection ----------
export function useSelection() {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const last = useRef<string | null>(null);
  const toggle = useCallback((id: string) => { last.current = id; setIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }, []);
  const clear = useCallback(() => { last.current = null; setIds(new Set()); }, []);
  const set = useCallback((list: string[]) => setIds(new Set(list)), []);
  /** A click on a card's checkbox. With Shift held it selects the whole run between the last clicked card and this one, in the order of `order`. */
  const pick = useCallback((id: string, shift: boolean, order: string[]) => {
    const from = order.indexOf(last.current ?? ''), to = order.indexOf(id);
    if (!shift || from < 0 || to < 0) return toggle(id);
    last.current = id;
    setIds(s => { const n = new Set(s); for (const x of order.slice(Math.min(from, to), Math.max(from, to) + 1)) n.add(x); return n; });
  }, [toggle]);
  return { ids, list: [...ids], has: (id: string) => ids.has(id), toggle, pick, clear, set, size: ids.size };
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
export const duration = (from: string, to?: string | null) => {
  const s = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** mm:ss for a length of time in ms. */
export const fmtMs = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Job labels built from a reference's file name ("Inspired by 42d773e0…") read better without the hash. */
export const niceLabel = (s: string) => s.replace(/\b[0-9a-f]{12,}\b/gi, 'a reference');
// One shared one-second ticker for every live counter on the page (it only runs while at least one counter is mounted).
const ticking = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | undefined;
const onTick = (cb: () => void) => {
  ticking.add(cb);
  tickTimer ??= setInterval(() => ticking.forEach(f => f()), 1000);
  return () => { ticking.delete(cb); if (!ticking.size) { clearInterval(tickTimer); tickTimer = undefined; } };
};
const nowSecond = () => Math.floor(Date.now() / 1000);
/** A live mm:ss counter since `from`. Pages only re-render when polled data changes, so it ticks itself. */
export function Elapsed({ from }: { from: string }) {
  useSyncExternalStore(onTick, nowSecond);
  return <>{duration(from)}</>;
}
