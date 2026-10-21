// Accessibility and keyboard helpers for the desktop UI: dialog focus handling (trap, restore, Esc, arrows), typing detection and shortcuts.
import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const NON_TEXT = /^(checkbox|radio|range|button|submit|reset|file|image|color)$/;

/** True while the user is typing in (or choosing from) a field: single-key shortcuts and arrow keys must leave it alone. */
export const isTyping = (t: EventTarget | null): boolean => {
  const e = t as HTMLElement | null;
  if (!e || !e.tagName) return false;
  if (e.isContentEditable || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT') return true;
  return e.tagName === 'INPUT' && !NON_TEXT.test((e as HTMLInputElement).type);
};

/** Open dialogs and drawers, oldest first. Only the top one reacts to Esc, arrows and Tab. */
const stack: symbol[] = [];
export const dialogOpen = () => stack.length > 0;

const tabbables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');

/**
 * Dialog semantics for `Modal` and `Drawer`: moves focus into the dialog (the container, so a text field does not grab it),
 * keeps Tab inside, closes on Esc, calls `onPrev`/`onNext` on the arrow keys, and gives focus back to what opened it.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, o: { onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const cb = useRef(o);
  cb.current = o;
  // Read while rendering, before the dialog's own autoFocus runs: that is the element that opened it.
  const opened = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const me = Symbol('dialog');
    stack.push(me);
    const opener = opened.current;
    root.tabIndex = -1;
    // Focus lands on the element marked data-autofocus (the safe button of a confirmation), else on the dialog itself.
    if (!root.contains(document.activeElement)) (root.querySelector<HTMLElement>('[data-autofocus]') ?? root).focus({ preventScroll: true });
    const top = () => stack[stack.length - 1] === me;
    const onKey = (e: KeyboardEvent) => {
      if (!top()) return;
      if (e.key === 'Escape') { if (!e.defaultPrevented) { e.preventDefault(); cb.current.onClose(); } return; }
      if (e.key === 'Tab') {
        const list = tabbables(root), at = document.activeElement;
        if (!list.length) { e.preventDefault(); root.focus(); return; }
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && (at === first || at === root || !root.contains(at))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (at === last || !root.contains(at))) { e.preventDefault(); first.focus(); }
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.defaultPrevented && !isTyping(e.target) && !(e.target instanceof HTMLInputElement && e.target.type === 'range')) {
        const go = e.key === 'ArrowLeft' ? cb.current.onPrev : cb.current.onNext;
        if (go) { e.preventDefault(); go(); }
      }
    };
    const onFocusIn = (e: FocusEvent) => { if (top() && e.target instanceof Node && !root.contains(e.target)) root.focus({ preventScroll: true }); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}

/** "/" jumps to the page's search field (any input marked `data-search`); "?" opens the shortcut list. Call once, in the layout. */
export function useGlobalShortcuts(onHelp: () => void) {
  const help = useRef(onHelp);
  help.current = onHelp;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || dialogOpen()) return;
      if (e.key === '/') {
        const el = [...document.querySelectorAll<HTMLInputElement>('[data-search]')].find(x => x.getClientRects().length > 0);
        if (el) { e.preventDefault(); el.focus(); el.select(); }
      } else if (e.key === '?') { e.preventDefault(); help.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Esc clears the selection; Cmd/Ctrl+A (with `all`) selects every visible card. Ignored while typing or while a dialog is open. */
export function useSelectionKeys(sel: { size: number; clear: () => void; set: (ids: string[]) => void }, all?: string[]) {
  const latest = useRef({ sel, all });
  latest.current = { sel, all };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || dialogOpen()) return;
      const { sel: s, all: ids } = latest.current;
      if (e.key === 'Escape' && s.size > 0) { e.preventDefault(); s.clear(); }
      else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a' && ids?.length) { e.preventDefault(); s.set(ids); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Live value of a CSS media query. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Warm the browser cache with the next/previous full-size images of a viewer. */
export function usePreload(urls: (string | null | undefined)[]) {
  const key = urls.filter(Boolean).join('|');
  useEffect(() => { for (const u of key.split('|').filter(Boolean)) { const im = new Image(); im.decoding = 'async'; im.src = u; } }, [key]);
}
