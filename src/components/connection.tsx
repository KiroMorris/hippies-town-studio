// "You're offline" / "Can't reach the Studio" banner. The owner reaches the Studio over the internet through the home router, so the connection
// comes and goes. Two signals feed it: the browser's own online/offline state, and the result of every API call (`reportNetwork`, called from api.ts).
import { useSyncExternalStore } from 'react';

type State = 'ok' | 'offline' | 'unreachable';
let failSince = 0, timer = 0, state: State = 'ok';
const subs = new Set<() => void>();
const compute = (): State => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : failSince && Date.now() - failSince >= 2000 ? 'unreachable' : 'ok');
const refresh = () => { const next = compute(); if (next !== state) { state = next; subs.forEach(f => f()); } };

/** Called after every API call: `false` when the request never got an answer, `true` when the Studio answered (whatever the answer was). */
export function reportNetwork(ok: boolean) {
  if (ok) { failSince = 0; clearTimeout(timer); timer = 0; }
  else if (!failSince) { failSince = Date.now(); timer = window.setTimeout(refresh, 2100); } // one failed request is not an outage: wait until it lasts
  refresh();
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { failSince = 0; refresh(); });
  window.addEventListener('offline', refresh);
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const useConnection = () => useSyncExternalStore(subscribe, () => state, () => 'ok' as State);

/** Slim strip at the top of the page. Clears itself as soon as the connection is back. */
export function ConnectionBanner() {
  const s = useConnection();
  if (s === 'ok') return null;
  return (
    <div className="conn" role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span>{s === 'offline' ? "You're offline. Changes can't be saved until you're back online." : "Can't reach the Studio right now. Trying again…"} <span className="kiro">Kiro's on it</span></span>
    </div>
  );
}
