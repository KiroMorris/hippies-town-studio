// Loading and error states shared by the pages. The skeletons use the same classes as the real cards, so nothing jumps when data arrives.

type Kind = 'design' | 'mockup' | 'photo' | 'product';
const TALL = ['', 'r34', '', 'r25', 'r34', '', '']; // a few taller cards among the squares, like real designs and sleeve strips

/** Placeholder cards for a grid that is still loading. */
export function GridSkeleton({ count = 12, kind = 'design', className }: { count?: number; kind?: Kind; className?: string }) {
  const grid = className ?? (kind === 'design' ? 'grid masonry' : kind === 'product' ? 'grid lg' : 'grid');
  return (
    <div className={grid} role="status">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card skel" aria-hidden="true">
          <div className={`media${kind === 'photo' || kind === 'product' ? ' photo tall' : kind === 'mockup' ? ' photo' : ` ${TALL[i % TALL.length]}`}`} />
          <div className="body"><div className="skel-line w70" /><div className="skel-line w40" /></div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder rows for a list (queue, products on the Shopify page). */
export function RowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="job-list" role="status">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => <div key={i} className="skel-job" aria-hidden="true"><div className="skel-line w40" /><div className="skel-line w70" /></div>)}
    </div>
  );
}

/** A failed request: say what failed, keep the tone calm, offer a retry. */
export function QueryError({ what, error, onRetry }: { what: string; error?: unknown; onRetry: () => void }) {
  const msg = error instanceof Error ? error.message.replace(/[.\s]+$/, '') : '';
  return (
    <div className="empty error-state" role="alert">
      <h3>Couldn't load {what}</h3>
      <p>{msg ? `${msg}. ` : 'The Studio server did not answer. '}Nothing was lost.</p>
      <div className="row"><button className="btn primary" onClick={onRetry}>Try again</button></div>
    </div>
  );
}

/** The mockup editor's three columns while the mockup loads. */
export function EditorSkeleton() {
  return (
    <div className="editor" role="status">
      <span className="sr-only">Loading the mockup…</span>
      <div className="panel skel-block" style={{ height: 520 }} aria-hidden="true" />
      <div className="panel skel-block" style={{ height: 640 }} aria-hidden="true" />
      <div className="panel skel-block" style={{ height: 420 }} aria-hidden="true" />
    </div>
  );
}

/** Two-column detail pages (a product) while they load. */
export function SplitSkeleton() {
  return (
    <div className="split" role="status">
      <span className="sr-only">Loading…</span>
      <div className="stack" aria-hidden="true"><div className="panel skel-block" style={{ height: 460 }} /><div className="panel skel-block" style={{ height: 220 }} /></div>
      <div className="stack" aria-hidden="true"><div className="panel skel-block" style={{ height: 200 }} /><div className="panel skel-block" style={{ height: 520 }} /></div>
    </div>
  );
}
