// Page filters live in the address (?status=draft&q=lemon), so a refresh, Back and Forward keep them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

type Patch = Record<string, string | number | boolean | null | undefined>;

/** The search params and a setter that merges a patch into them. Empty, false and null values are dropped from the address. `replace` skips a history entry. */
export function useUrlParams() {
  const [params, setParams] = useSearchParams();
  const set = useCallback((patch: Patch, replace = false) => setParams(p => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === null || v === '' || v === false) next.delete(k); else next.set(k, v === true ? '1' : String(v)); }
    return next;
  }, { replace }), [setParams]);
  return [params, set] as const;
}

/** A search box that follows `?key=` in the address: typing updates the address after a short pause (without adding history entries), Back and Forward update the box. */
export function useUrlSearch(key = 'q', delay = 250) {
  const [params, set] = useUrlParams();
  const url = (params.get(key) ?? '').trim();
  const [text, setText] = useState(url);
  const pushed = useRef(url);
  useEffect(() => { if (url !== pushed.current) { pushed.current = url; setText(url); } }, [url]); // address changed from outside (Back, a link)
  useEffect(() => {
    if (text.trim() === pushed.current) return; // `pushed` is what the address holds (trimmed), so a trailing space never resets the box
    const t = setTimeout(() => { pushed.current = text.trim(); set({ [key]: text.trim() || null }, true); }, delay);
    return () => clearTimeout(t);
  }, [text, key, delay, set]);
  return [text, setText, url.trim()] as const;
}
