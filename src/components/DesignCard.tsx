import type { MouseEvent } from 'react';
import type { Design, Job } from '../../shared/types.ts';
import { useJobs } from '../api.ts';
import { Elapsed, fmtMs, niceLabel } from './ui.tsx';

export function DesignCard({ design, selected, onToggle, onOpen, onFavorite }: {
  design: Design; selected?: boolean; onToggle?: (e: MouseEvent) => void; onOpen: () => void; onFavorite?: () => void;
}) {
  return (
    <div className={`card${selected ? ' selected' : ''}`}>
      {onToggle && <button className="select-box" onClick={onToggle} aria-pressed={selected} aria-label={`Select ${design.title}`} title="Select (Shift-click selects a range)">{selected ? '✓' : ''}</button>}
      {onFavorite && <button className={`fav${design.favorite ? ' on' : ''}`} onClick={onFavorite} aria-pressed={design.favorite} aria-label="Favorite" title={design.favorite ? 'Remove from favorites' : 'Add to favorites'}>{design.favorite ? '★' : '☆'}</button>}
      <button className="media" onClick={onOpen} aria-label={`Open ${design.title}`}><img src={design.thumbUrl} alt="" width={design.width} height={design.height} loading="lazy" decoding="async" /></button>
      <div className="body">
        <div className="title" title={design.title}>{design.title}</div>
        <div className="meta">
          <span className="badge">{design.placement}</span>
          {design.status !== 'draft' && <span className={`badge ${design.status}`}>{design.status}</span>}
          {!design.transparent && <span className="badge warn" title="This image has a solid background. It will print as a box.">no transparency</span>}
          {design.source === 'refined' && <span className="badge">refined</span>}
          {design.setId && <span className="badge" title="Linked with its other prints (front, back, sleeve)">set</span>}
          {design.genMs != null && <span className="badge" title="How long Codex took to make this design">⏱ {fmtMs(design.genMs)}</span>}
        </div>
      </div>
    </div>
  );
}

/** Stand-in card for a design that is still queued or generating: what it is, how long it has taken, how many jobs are ahead of it. */
export function PendingCard({ job }: { job: Job }) {
  const running = job.status === 'running';
  const { data: active = [] } = useJobs('active'); // same query the pages already poll
  const ahead = running ? 0 : active.filter(j => j.status === 'queued' && j.createdAt < job.createdAt).length;
  return (
    <div className={`placeholder-card${running ? ' running' : ''}`}>
      <div>
        <div className={`badge ${running ? 'run' : ''}`}>{running ? <>Generating · <Elapsed from={job.startedAt ?? job.createdAt} /></> : job.input.after ? 'Waiting for the earlier print' : 'Waiting in queue'}</div>
        <div style={{ marginTop: 8 }}>{niceLabel(job.label.replace(/^\w+ · /, ''))}</div>
        <div className="pc-sub">{running ? 'Usually 2–4 minutes' : ahead > 0 ? `${ahead} ${ahead === 1 ? 'job' : 'jobs'} ahead of it` : 'Next up'}</div>
        {job.attempts > 1 && <div className="hint">Retry {job.attempts}</div>}
      </div>
    </div>
  );
}
