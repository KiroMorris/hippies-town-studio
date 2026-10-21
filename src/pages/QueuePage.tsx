import { Link } from 'react-router-dom';
import type { Job } from '../../shared/types.ts';
import { api, useAction, useJobs, useStats } from '../api.ts';
import { QueryError, RowSkeleton } from '../components/states.tsx';
import { Elapsed, Empty, duration, niceLabel, plural, timeAgo, useConfirm, useRun, useToast } from '../components/ui.tsx';

const STATUS_BADGE: Record<Job['status'], string> = { queued: '', running: 'run', done: 'ok', error: 'err', cancelled: 'archived' };
const resultLink = (j: Job) => (j.result?.kind === 'design' ? `/designs?open=${j.result.id}` : j.result?.kind === 'shoot' ? '/shoots' : j.result?.kind === 'preset' ? '/presets' : j.result?.kind === 'copy' ? `/products/${j.result.id}` : null);

/** One row. Defined outside the page so a poll does not remount every row (which would reset the live timers and drop keyboard focus). */
function JobRow({ j, ahead, onCancel, onRetry }: { j: Job; ahead: number; onCancel: (id: string) => void; onRetry: (id: string) => void }) {
  const link = resultLink(j);
  return (
    <div className={`job${j.status === 'error' ? ' failed' : ''}`}>
      <span className={`badge ${STATUS_BADGE[j.status]}`}>{j.status === 'running' ? <>running <Elapsed from={j.startedAt ?? j.createdAt} /></> : j.status}</span>
      <div style={{ minWidth: 0 }}>
        <div className="label" title={niceLabel(j.label)}>{niceLabel(j.label)}</div>
        <div className="sub">
          {j.type === 'copy' ? 'write details' : j.type} · queued {timeAgo(j.createdAt)}{j.finishedAt && j.startedAt ? ` · took ${duration(j.startedAt, j.finishedAt)}` : ''}{j.attempts > 1 ? ` · attempt ${j.attempts}` : ''}
          {j.status === 'running' && <span className="typical"> · usually 2–4 min</span>}
          {j.status === 'queued' && <span className="typical"> · {ahead > 0 ? `${plural(ahead, 'job')} ahead` : 'next up'}</span>}
        </div>
        {j.error && j.status !== 'done' && <div className="error">{j.status === 'queued' || j.status === 'running' ? 'Last try failed, trying again: ' : ''}{j.error}</div>}
      </div>
      <div className="row">
        {link && j.status === 'done' && <Link className="btn sm" to={link}>View</Link>}
        {(j.status === 'queued' || j.status === 'running') && <button className="btn sm" onClick={() => onCancel(j.id)}>Cancel</button>}
        {(j.status === 'error' || j.status === 'cancelled') && <button className="btn sm" onClick={() => onRetry(j.id)}>Retry</button>}
      </div>
    </div>
  );
}

export function QueuePage() {
  const { data: jobs = [], isPending: isLoading, isError, error, refetch } = useJobs();
  const { data: stats } = useStats();
  const run = useRun();
  const ask = useConfirm();
  const cancel = useAction((id: string) => api.post(`/jobs/${id}/cancel`));
  const retry = useAction((id: string) => api.post(`/jobs/${id}/retry`));
  const cancelAll = useAction(() => api.post('/jobs/cancel-all'));
  const clear = useAction(() => api.post('/jobs/clear'));
  const retryEvery = useAction(() => api.post<{ retried: number; blocked: number; gone: number }>('/jobs/retry-all'));
  const toast = useToast();
  const activeJobs = jobs.filter(j => j.status === 'queued' || j.status === 'running').reverse();
  const failed = jobs.filter(j => j.status === 'error');
  const finished = jobs.filter(j => j.status !== 'queued' && j.status !== 'running' && j.status !== 'error');
  const running = activeJobs.filter(j => j.status === 'running').length, waiting = activeJobs.length - running;
  const retryable = jobs.filter(j => j.status === 'error' || j.status === 'cancelled').length; // the list holds the latest 200 finished jobs; the server retries every one from the last 3 days
  const onRetryAll = async () => {
    const out = await run(() => retryEvery.mutateAsync());
    if (out) toast(out.retried ? `${plural(out.retried, 'job')} queued again${out.blocked ? `, ${out.blocked} left out because the safety filter refused those pictures` : ''}${out.gone ? `, ${out.gone} skipped because their mockup, model or design was deleted` : ''}` : 'Nothing to retry');
  };
  // A rough "how long is left": the median time of the recent finished jobs, times the rounds needed at the current parallelism.
  const took = jobs.filter(j => j.status === 'done' && j.startedAt && j.finishedAt).map(j => +new Date(j.finishedAt!) - +new Date(j.startedAt!)).sort((a, b) => a - b);
  const median = took.length ? took[Math.floor(took.length / 2)] : 0;
  const slots = stats?.queue.concurrency ?? 3;
  const minutes = activeJobs.length && median ? Math.max(1, Math.round((Math.ceil(activeJobs.length / slots) * median) / 60000)) : 0;
  let seen = 0; // queue position of each waiting job, oldest first
  const aheadOf = (j: Job) => (j.status === 'queued' ? seen++ : 0);
  const onCancel = (id: string) => void run(() => cancel.mutateAsync(id));
  const onRetry = async (id: string) => {
    // A picture the safety filter refused is judged the same way every time, and each try still spends image generations.
    if (jobs.find(j => j.id === id)?.error?.startsWith("OpenAI's image safety filter") && !(await ask({
      title: 'Try a blocked picture again?',
      body: 'OpenAI’s safety filter checks the finished picture, and this one was refused. The same request is refused the same way, and every try still uses image generations. Change the reference first (for example crop out the nude figures), or leave it.',
      confirm: 'Try anyway', cancel: 'Leave it', danger: true,
    }))) return;
    await run(() => retry.mutateAsync(id), 'Queued again');
  };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Library · <span className="kiro">made by Kiro</span></div><h1>Queue</h1>
          <p>Everything Codex is making. Up to {slots} jobs run at once; queued jobs survive restarts. Failed jobs retry once automatically.</p></div>
        <div className="row">
          {activeJobs.length > 0 && <button className="btn danger" onClick={async () => (await ask({ title: 'Cancel all jobs?', body: `${plural(activeJobs.length, 'queued or running job')} will stop. You can retry any of them later from this page.`, confirm: 'Cancel all jobs', cancel: 'Keep them', danger: true })) && run(() => cancelAll.mutateAsync(), 'Cancelled')}>Cancel all</button>}
          {retryable > 0 && <button className="btn primary" disabled={retryEvery.isPending} title="Run every failed and cancelled job again (pictures the safety filter refused are left out)" onClick={onRetryAll}>Retry all · {retryable >= 200 ? '200+' : retryable}</button>}
          {finished.length + failed.length > 0 && <button className="btn" title="Removes finished and failed jobs from this list (your designs and photos stay)" onClick={() => run(() => clear.mutateAsync(), 'Cleared')}>Clear finished</button>}
        </div>
      </div>

      {isError && !jobs.length ? <QueryError what="the queue" error={error} onRetry={() => refetch()} />
        : isLoading ? <RowSkeleton count={6} />
        : !jobs.length ? <Empty title="Queue is empty">Generated designs, photo shoots and reference photos show up here while they're being made.</Empty> : (
        <div className="stack">
          <div className="q-summary" role="status">
            {activeJobs.length > 0
              ? <><b>{running} running</b><span>{waiting} waiting</span>{minutes > 0 && <span>about {minutes} min left</span>}{minutes > 0 && <span className="hint">estimated from your recent jobs</span>}</>
              : <><b>Nothing running</b>{failed.length > 0 ? <span>{plural(failed.length, 'job')} need{failed.length === 1 ? 's' : ''} attention</span> : <span>Everything finished</span>}</>}
          </div>
          {activeJobs.length > 0 && <div className="stack" style={{ gap: 8 }}><h2 className="h-sm">In progress · {activeJobs.length}</h2><div className="job-list">{activeJobs.map(j => <JobRow key={j.id} j={j} ahead={aheadOf(j)} onCancel={onCancel} onRetry={onRetry} />)}</div></div>}
          {failed.length > 0 && <div className="stack" style={{ gap: 8 }}><h2 className="h-sm">Needs attention · {failed.length}</h2><div className="job-list">{failed.map(j => <JobRow key={j.id} j={j} ahead={0} onCancel={onCancel} onRetry={onRetry} />)}</div></div>}
          {finished.length > 0 && <div className="stack" style={{ gap: 8 }}><h2 className="h-sm">Finished · {finished.length}</h2><div className="job-list">{finished.map(j => <JobRow key={j.id} j={j} ahead={0} onCancel={onCancel} onRetry={onRetry} />)}</div></div>}
        </div>
      )}
    </>
  );
}
