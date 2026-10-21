import { useCallback, useState } from 'react';

/** State that is remembered in this browser between visits (a choice you make every time, like the model or the shots of a shoot). Storage can be missing or blocked: then it behaves like useState. */
export function useRemembered<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(`hippies.${key}`); if (raw != null) return JSON.parse(raw) as T; } catch { /* use the default */ }
    return initial;
  });
  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try { localStorage.setItem(`hippies.${key}`, JSON.stringify(next)); } catch { /* not remembered */ }
      return next;
    });
  }, [key]);
  return [value, set];
}
