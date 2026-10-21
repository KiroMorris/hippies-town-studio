// Persistent job queue: jobs live in SQLite, so queued work survives restarts. Runs up to config.concurrency at once.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { MODEL_PHOTOS, SHOOT_FRAMINGS, SHOOT_RATIOS, SHOT_TEMPLATES, isSleeveLayer, type JobType, type ModelView, type Placement, type QueuePause, type View } from '../shared/types.ts';
import { config } from './config.ts';
import { all, db, get, insert, newId, now, run, transaction, update } from './db.ts';
import { abs, cropToRatio, inspectImage, ratioOf, removeFiles, storeImage } from './files.ts';
import { fatal, parseResetAt, runCodexImage, toJobError } from './codex.ts';
import { characterSheetPrompt, designPrompt, extractPrompt, fixPrompt, modelViewPrompt, presetPrompt, refinePrompt, setPrompt } from './prompts.ts';
import { describePrints, extraModelView, seedOf, shootBrief } from './shootBrief.ts';
import { designRow, mockupRow, presetRow, presetViewRows } from './models.ts';
import { getProduct } from './catalog.ts';
import { writeCopy } from './copy.ts';
import { planRefs, printSheet } from './shootRefs.ts';

type Input = Record<string, any>;
type Result = { kind: 'design' | 'shoot' | 'preset' | 'copy'; id: string; notes?: string[] };
/** Handlers do the slow work, then return a sync commit that inserts rows; execute runs it with the "done" update in one transaction. */
type Commit = () => Result;

const running = new Map<string, AbortController>();
let ticking = false;
let lastError: string | null = null;
let paused: QueuePause | null = null;
let timer: NodeJS.Timeout | null = null;
let shuttingDown = false;
const safe = (fn: () => void) => { try { fn(); } catch (e) { console.error('[queue]', e); } };

try { const kv = get(`SELECT value FROM kv WHERE key = 'paused'`); if (kv) paused = JSON.parse(String(kv.value)); } catch { paused = null; }
function setPause(until: number, reason: string) {
  paused = { until: Math.max(until, paused?.until ?? 0), reason };
  safe(() => run(`INSERT INTO kv (key, value) VALUES ('paused', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(paused)));
}
const isPaused = () => {
  if (paused && paused.until <= Date.now()) { paused = null; safe(() => run(`DELETE FROM kv WHERE key = 'paused'`)); }
  return !!paused;
};

/** Clear a usage-limit/login pause and let queued jobs run immediately. */
export function resumeQueue() {
  paused = null;
  safe(() => run(`DELETE FROM kv WHERE key = 'paused'`));
  run(`UPDATE jobs SET run_after = NULL WHERE status = 'queued'`);
  queueMicrotask(tick);
}

let tickQueued = false;
/** One scheduler pass after a burst of enqueues. A pass per job grows with the square of the batch: 4000 photos in one click blocked the server for 14 s. */
const tickSoon = () => { if (tickQueued) return; tickQueued = true; queueMicrotask(() => { tickQueued = false; tick(); }); };

export function enqueue(type: JobType, label: string, input: Input, batchId: string | null = null) {
  const id = newId('job');
  insert('jobs', { id, type, status: 'queued', label, batch_id: batchId, input: JSON.stringify(input), created_at: now() });
  tickSoon();
  return id;
}

/** Queue "write the product details" jobs. A product that already has one waiting or running is not queued twice. */
export function queueCopy(listingIds: string[], mode: 'empty' | 'all' = 'empty') {
  const batchId = listingIds.length > 1 ? newId('bat') : null;
  const ids: string[] = [];
  for (const listingId of listingIds) {
    const row = get('SELECT title FROM listings WHERE id = ?', listingId);
    if (!row) continue;
    const waiting = get(`SELECT id FROM jobs WHERE type = 'copy' AND status IN ('queued','running') AND json_extract(input, '$.listingId') = ?`, listingId);
    ids.push(waiting ? String(waiting.id) : enqueue('copy', `Write details · ${String(row.title).slice(0, 60)}`, { listingId, mode }, batchId));
  }
  return ids;
}

export function cancelJob(id: string) {
  const job = get('SELECT status FROM jobs WHERE id = ?', id);
  if (!job) return false;
  if (job.status === 'queued') update('jobs', id, { status: 'cancelled', finished_at: now() });
  running.get(id)?.abort(new Error('Cancelled'));
  return true;
}

const DROPPED = 'The earlier design of this set did not finish, so this one was not made. Retry the earlier one and this one follows.';

export function retryJob(id: string) {
  run(`UPDATE jobs SET status = 'queued', error = NULL, attempts = 0, run_after = NULL, started_at = NULL, finished_at = NULL WHERE id = ? AND status IN ('error','cancelled')`, id);
  // later prints of its set that were dropped because this one did not finish follow it again
  for (let ids = [id]; ids.length;) {
    ids = all(`SELECT id FROM jobs WHERE status = 'cancelled' AND error = ? AND json_extract(input, '$.after') IN (${ids.map(() => '?').join(',')})`, DROPPED, ...ids).map(r => String(r.id));
    for (const next of ids) run(`UPDATE jobs SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?`, next);
  }
  tickSoon();
}

/** Whether a failed or cancelled job still has what it works on: deleting a mockup, model, design or product cancels its jobs, and running those again would only fail. */
function stillMakesSense(job: Record<string, any>) {
  let input: Input;
  try { input = JSON.parse(String(job.input)); } catch { return false; }
  const has = (table: string, id: unknown) => !!id && !!get(`SELECT 1 FROM ${table} WHERE id = ?`, String(id));
  if (job.type === 'shoot') return input.fixOf ? has('shoots', input.fixOf) : has('mockups', input.mockupId);
  if (job.type === 'preset') return has('presets', input.presetId);
  if (job.type === 'refine') return has('designs', input.designId);
  if (job.type === 'copy') return has('listings', input.listingId);
  return true;
}

/**
 * "Retry all" on the Queue page: every failed or cancelled job from the last 3 days (older ones may have lost their files). It leaves out pictures the safety filter
 * refused (refused the same way every time), later prints of a set (they follow their earlier print when that one is retried) and jobs whose mockup, model or design is gone.
 */
export function retryAll() {
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const rows = all(`SELECT * FROM jobs WHERE status IN ('error','cancelled') AND COALESCE(finished_at, created_at) > ? ORDER BY created_at, rowid`, since);
  const waiting = () => Number(get(`SELECT COUNT(*) n FROM jobs WHERE status = 'queued'`)?.n);
  const before = waiting();
  let blocked = 0, gone = 0;
  transaction(() => {
    for (const j of rows) {
      if (String(j.error ?? '').startsWith("OpenAI's image safety filter")) blocked++;
      else if (j.error === DROPPED) continue;
      else if (!stillMakesSense(j)) gone++;
      else retryJob(String(j.id));
    }
  });
  return { retried: waiting() - before, blocked, gone };
}

/** How many queued or running jobs need one of these image files (a reference or a design used as a reference) or designs (to refine, or to match). */
export function jobsUsing(files: string[], designIds: string[] = []) {
  return all(`SELECT input FROM jobs WHERE status IN ('queued','running')`).filter(j => {
    try { const i = JSON.parse(String(j.input)); return (i.refFiles ?? []).some((f: string) => files.includes(f)) || designIds.includes(i.designId) || designIds.includes(i.joinId); } catch { return false; }
  }).length;
}

/** Image files that jobs may still need: waiting and running ones, and failed or cancelled ones from the last 3 days (the Queue offers Retry on those). */
export function filesNeededByJobs() {
  const keep = new Set<string>();
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  for (const j of all(`SELECT input FROM jobs WHERE status IN ('queued','running') OR (status IN ('error','cancelled') AND COALESCE(finished_at, created_at) > ?)`, since)) {
    try { for (const f of JSON.parse(String(j.input)).refFiles ?? []) keep.add(String(f)); } catch { /* unreadable input */ }
  }
  return keep;
}

/**
 * Deleting a reference from the library keeps its file while queued or running designs still need it; this removes such leftovers once nothing does.
 * Files younger than 10 minutes are left alone: one that was just uploaded may not be in the library yet.
 */
export async function sweepReferences() {
  try {
    const dir = path.join(config.paths.files, 'references');
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    if (!names.length) return;
    const keep = new Set([...all('SELECT file FROM refs').map(r => String(r.file)), ...filesNeededByJobs()]);
    for (const n of names) {
      if (keep.has(`references/${n}`)) continue;
      const st = await fs.stat(path.join(dir, n)).catch(() => null);
      if (st?.isFile() && Date.now() - st.mtimeMs > 10 * 60_000) await fs.rm(path.join(dir, n), { force: true });
    }
  } catch (e) { console.error('[queue] reference sweep failed', e); }
}

export const queueStats = () => ({
  queued: Number(get(`SELECT COUNT(*) n FROM jobs WHERE status = 'queued'`)!.n),
  running: running.size,
  concurrency: config.concurrency,
  lastError,
  paused: isPaused() ? paused : null,
});

/** Jobs left "running" by a crash or restart go back to the queue (attempts untouched). */
export function startQueue() {
  run(`UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'`);
  try { for (const d of fsSync.readdirSync(config.paths.work)) fsSync.rmSync(path.join(config.paths.work, d), { recursive: true, force: true }); } catch {}
  const stop = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${sig}: requeueing ${running.size} running job(s)`);
    for (const c of running.values()) c.abort(new Error('Shutdown'));
    safe(() => run(`UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'`));
    safe(() => db.close());
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  void sweepReferences();
  tick();
  setInterval(tick, 5000).unref();
}

function tick() {
  if (ticking || shuttingDown) return;
  ticking = true;
  try {
    if (isPaused()) return;
    // A linked set's later prints wait for the one before them (`after`) and are dropped if that one was cancelled or failed for good. Retrying the earlier one brings them back.
    while (Number(run(`UPDATE jobs SET status = 'cancelled', error = ?, finished_at = ? WHERE status = 'queued' AND json_extract(input, '$.after') IN (SELECT id FROM jobs WHERE status IN ('cancelled','error'))`, DROPPED, now()).changes) > 0) { /* cascade down the chain */ }
    while (running.size < config.concurrency) {
      const job = get(`SELECT * FROM jobs j WHERE j.status = 'queued' AND (j.run_after IS NULL OR j.run_after <= ?) AND (json_extract(j.input, '$.after') IS NULL OR EXISTS (SELECT 1 FROM jobs a WHERE a.id = json_extract(j.input, '$.after') AND a.status = 'done')) ORDER BY (j.type = 'copy') DESC, j.created_at, j.rowid LIMIT 1`, Date.now());
      if (!job) break;
      const controller = new AbortController();
      running.set(String(job.id), controller);
      update('jobs', String(job.id), { status: 'running', started_at: now(), run_after: null });
      void execute(job, controller);
    }
  } catch (e) { console.error('[queue] tick failed', e); }
  finally {
    ticking = false;
    safe(() => {
      if (timer) clearTimeout(timer);
      const next = Number(get(`SELECT MIN(run_after) n FROM jobs WHERE status = 'queued' AND run_after > ?`, Date.now())?.n) || 0;
      const at = Math.max(next, paused?.until ?? 0);
      timer = at ? setTimeout(tick, Math.min(Math.max(at - Date.now(), 100), 2 ** 30)) : null;
      timer?.unref();
    });
  }
}

const backoffMs = (attempts: number) => 20_000 * 3 ** (attempts - 1);

async function execute(job: Record<string, any>, controller: AbortController) {
  const id = String(job.id);
  const began = Date.now();
  const timeout = setTimeout(() => controller.abort(new Error('Timed out')), config.jobTimeoutMs);
  const workDir = path.join(config.paths.work, id);
  try {
    const input = JSON.parse(job.input) as Input;
    const handler = { design: runDesign, refine: runRefine, shoot: runShoot, preset: runPreset, copy: writeCopy }[job.type as JobType];
    const commit = await handler(input, { id, batchId: job.batch_id, workDir, signal: controller.signal, recoverThreadId: input._recoverThread ?? null, recoverSince: input._recoverSince ?? null });
    transaction(() => update('jobs', id, { status: 'done', result: JSON.stringify(commit()), error: null, run_after: null, finished_at: now() }));
    lastError = null;
  } catch (err: any) {
    safe(() => {
      const reason = controller.signal.aborted ? controller.signal.reason?.message : null;
      if (reason === 'Cancelled') return update('jobs', id, { status: 'cancelled', error: 'Cancelled', finished_at: now() });
      if (reason === 'Shutdown') return update('jobs', id, { status: 'queued', started_at: null });
      const e = toJobError(controller.signal.aborted ? controller.signal.reason : err);
      const message = e.message.slice(0, 500);
      lastError = message; console.error(`[job ${id}] ${e.kind}: ${message}`);
      if (e.kind === 'limit') {
        const until = parseResetAt(e.message) ?? Date.now() + 30 * 60_000;
        setPause(until, 'Codex usage limit reached');
        return update('jobs', id, { status: 'queued', error: message, run_after: paused!.until, started_at: null }); // no attempt consumed
      }
      const attempts = Number(job.attempts) + 1;
      if (e.kind === 'auth') setPause(Date.now() + 30 * 60_000, 'Codex is not logged in');
      const retry = (e.kind === 'transient' || e.kind === 'noimage') && attempts < config.maxAttempts;
      const row: Record<string, unknown> = { status: retry ? 'queued' : 'error', error: message, attempts, run_after: retry ? Date.now() + backoffMs(attempts) : null, finished_at: retry ? null : now() };
      if (retry && e.kind === 'noimage' && e.threadId) row.input = JSON.stringify({ ...JSON.parse(job.input), _recoverThread: e.threadId, _recoverSince: began });
      update('jobs', id, row);
    });
  } finally {
    clearTimeout(timeout);
    running.delete(id);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    void sweepReferences();
    tick();
  }
}

interface Ctx { id: string; batchId: string | null; workDir: string; signal: AbortSignal; recoverThreadId: string | null; recoverSince: number | null }

async function need(files: string[]) {
  for (const f of files) {
    if (await fs.access(f).then(() => true, () => false)) continue;
    const rel = path.relative(config.paths.files, f);
    throw fatal(rel.startsWith('references/') ? 'The reference image was deleted before Codex could use it. Add it again on the Generate page and make the design again.'
      : rel.startsWith('designs/') ? 'The design this one is based on was deleted.' : `Input file is missing: ${rel}.`);
  }
}

/** Resume the same thread once with a targeted fix if the result can't be printed (opaque background, too small, empty). */
async function gate(res: { file: string; threadId: string | null; reply: string }, ctx: Ctx, outDir: string) {
  if (!res.threadId) return res;
  try {
    const q = await inspectImage(res.file);
    const problems = [
      !(q.transparent && q.cornersTransparent) && 'The background is not transparent. Regenerate with image_gen with a transparent background; do not edit pixels with scripts.',
      Math.max(q.width, q.height) < 1000 && 'The image is too small. Regenerate with image_gen at the highest resolution available (long side at least 1024px).',
      q.contentRatio < 0.02 && 'The artwork is nearly empty. Regenerate it so the artwork fills most of the canvas.',
    ].filter(Boolean);
    if (!problems.length) return res;
    const fix = path.join(outDir, 'design-fix.png');
    const r = await runCodexImage({ prompt: `${problems.join(' ')} Save to ${fix}.`, images: [], workDir: ctx.workDir, outFile: fix, signal: ctx.signal, resumeThreadId: res.threadId });
    return { ...r, reply: res.reply };
  } catch (err) {
    const e = toJobError(err);
    if (ctx.signal.aborted) throw err;
    if (e.kind === 'limit' || e.kind === 'auth') setPause(parseResetAt(e.message) ?? Date.now() + 30 * 60_000, e.kind === 'auth' ? 'Codex is not logged in' : 'Codex usage limit reached');
    return res; // keep the first result; the UI flags transparent=false
  }
}

/** Codex's name for a design: the first reply line that isn't the file path, kept short. */
const titleFrom = (reply: string, file: string) => {
  const line = reply.split('\n').map(s => s.replace(/^[\s>*#`"'-]+|[\s`"'.]+$/g, '')).find(s => s && !s.includes('/') && !s.includes(path.basename(file)) && !/^(done|saved|here|ok|okay|sure|created|finished|complete)\b/i.test(s));
  return line && line.length >= 3 && line.length <= 60 ? line : null;
};
const PLACEMENT_LABEL: Record<string, string> = { front: 'Front', back: 'Back', sleeve: 'Sleeve' };

async function runDesign(input: Input, ctx: Ctx): Promise<Commit> {
  const t0 = Date.now();
  // Later prints of a linked set are made from the ones before them, so the set reads as one collection.
  // `joinId` is an existing design this print is made to match: it is a reference now and joins the set when the print is saved.
  // An exact extraction takes every print from the reference itself, so earlier prints of its set are not references.
  const mates = input.setId && !input.exact ? all('SELECT title, placement, file FROM designs WHERE set_id = ? OR id = ? ORDER BY created_at', input.setId, input.joinId ?? '') : [];
  const refs: string[] = (mates.length ? mates.map(m => String(m.file)) : input.refFiles ?? []).map(abs);
  await need(refs);
  const out = path.join(ctx.workDir, 'design.png');
  const prompt = input.exact
    ? extractPrompt({ notes: input.idea ?? '', placement: input.placement, file: out })
    : mates.length
    ? setPrompt({ idea: input.idea ?? '', placement: input.placement, mates: mates.map(m => m.placement as Placement), file: out, egyptian: input.egyptian })
    : designPrompt({ idea: input.idea ?? '', placement: input.placement, refCount: refs.length, variant: input.variant, count: input.count, file: out, egyptian: input.egyptian });
  const res = await gate(await runCodexImage({ prompt, images: refs, workDir: ctx.workDir, outFile: out, signal: ctx.signal, recoverThreadId: ctx.recoverThreadId, recoverSince: ctx.recoverSince }), ctx, ctx.workDir);
  // Codex names the design it made; the rest of a set is named after its first print. A repeated name in one batch gets the variation number.
  const named = mates.length ? `${String(mates[0].title).replace(/ · (Front|Back|Sleeve)$/, '')} · ${PLACEMENT_LABEL[input.placement] ?? input.placement}` : titleFrom(res.reply, out);
  let title: string = named ?? input.title;
  if (named && !mates.length && ctx.batchId && get('SELECT 1 FROM designs WHERE batch_id = ? AND title = ?', ctx.batchId, named)) title = `${named} · v${input.variant + 1}`;
  return saveDesign({ file: res.file, threadId: res.threadId, title, prompt: input.idea ?? '', placement: input.placement, source: 'generated', parentId: input.parentId ?? null, batchId: ctx.batchId, setId: input.setId ?? null, joinId: input.joinId ?? null, genMs: Date.now() - t0 });
}

async function runRefine(input: Input, ctx: Ctx): Promise<Commit> {
  const t0 = Date.now();
  const parent = designRow(input.designId);
  if (!parent) throw fatal('The design to refine was deleted.');
  const parentFile = abs(String(parent.file));
  await need([parentFile]);
  const out = path.join(ctx.workDir, 'design.png');
  // Resuming the original thread keeps Codex's context; without one, the design itself is attached.
  const resume = parent.thread_id ? String(parent.thread_id) : null;
  const prompt = refinePrompt({ feedback: input.feedback, hasImage: !resume, file: out });
  let res;
  try {
    res = await runCodexImage({ prompt, images: resume ? [] : [parentFile], workDir: ctx.workDir, outFile: out, signal: ctx.signal, resumeThreadId: resume, recoverThreadId: ctx.recoverThreadId, recoverSince: ctx.recoverSince });
  } catch (err) {
    const e = toJobError(err);
    if (!resume || ctx.signal.aborted || e.kind === 'limit' || e.kind === 'auth') throw err;
    res = await runCodexImage({ prompt: refinePrompt({ feedback: input.feedback, hasImage: true, file: out }), images: [parentFile], workDir: ctx.workDir, outFile: out, signal: ctx.signal });
  }
  res = await gate(res, ctx, ctx.workDir);
  return saveDesign({
    file: res.file, threadId: res.threadId, title: `${parent.title} · refined`, prompt: `${parent.prompt}\nRefined: ${input.feedback}`.trim(),
    placement: parent.placement as Placement, source: 'refined', parentId: String(parent.id), batchId: ctx.batchId, genMs: Date.now() - t0,
  });
}

async function saveDesign(o: { file: string; threadId: string | null; title: string; prompt: string; placement: Placement; source: string; parentId: string | null; batchId: string | null; setId?: string | null; joinId?: string | null; genMs?: number }): Promise<Commit> {
  const id = newId('dsn');
  const img = await storeImage('designs', id, o.file, { trim: true });
  return () => {
    insert('designs', {
      id, title: o.title, prompt: o.prompt, placement: o.placement, status: 'draft', favorite: 0, source: o.source,
      parent_id: o.parentId, batch_id: o.batchId, thread_id: o.threadId, set_id: o.setId ?? null, gen_ms: o.genMs ?? null, file: img.file, thumb: img.thumb,
      width: img.width, height: img.height, transparent: img.transparent ? 1 : 0, created_at: now(),
    });
    if (o.setId && o.joinId) run('UPDATE designs SET set_id = ? WHERE id = ? AND set_id IS NULL', o.setId, o.joinId);
    return { kind: 'design', id };
  };
}

/** "Fix this photo": edits a finished photo with one stated change and saves the result as a new photo beside it (the original stays). */
async function runFix(input: Input, ctx: Ctx): Promise<Commit> {
  const src = get('SELECT * FROM shoots WHERE id = ?', String(input.fixOf));
  if (!src) throw fatal('The photo to fix was deleted.');
  const feedback = String(input.feedback ?? '').trim();
  if (!feedback) throw fatal('Say what to fix.');
  const mockup = mockupRow(String(src.mockup_id)), template = SHOT_TEMPLATES.find(t => t.key === src.shot);
  const layers = (mockup && template ? JSON.parse(String(mockup.views))[template.view] ?? [] : []) as { designId: string }[];
  const designFiles = [...new Set(layers.map(l => l.designId))].map(designRow).filter(Boolean).map(d => abs(String(d!.file)));
  const photo = abs(String(src.file));
  await need([photo, ...designFiles]);
  const out = path.join(ctx.workDir, 'fix.png');
  const sheet = designFiles.length > 1;
  const images = [photo];
  if (designFiles.length) images.push(sheet ? await printSheet(designFiles, path.join(ctx.workDir, 'prints.png')) : designFiles[0]);
  const prompt = fixPrompt({ feedback, hasArtwork: designFiles.length > 0, sheet, file: out });
  const { file } = await runCodexImage({ prompt, images, workDir: ctx.workDir, outFile: out, signal: ctx.signal, recoverThreadId: ctx.recoverThreadId, recoverSince: ctx.recoverSince });
  const id = newId('sht');
  const img = await storeImage('shoots', id, await cropToRatio(file, await ratioOf(photo)));
  return () => {
    insert('shoots', {
      id, mockup_id: src.mockup_id, shot: src.shot, kind: src.kind, model_id: src.model_id, location_id: src.location_id, style_id: src.style_id,
      notes: [src.notes, `Fix: ${feedback}`].filter(Boolean).join(' | ').slice(0, 1500), favorite: 0, file: img.file, thumb: img.thumb, batch_id: ctx.batchId, created_at: now(),
    });
    return { kind: 'shoot', id };
  };
}

async function runShoot(input: Input, ctx: Ctx): Promise<Commit> {
  if (input.fixOf) return runFix(input, ctx);
  const base = SHOT_TEMPLATES.find(t => t.key === input.shot);
  // flat lay / ghost of the back of a back-print-only mockup, and the sleeve close-up of a mockup whose sleeve prints are on the back
  const template = base && !base.usesModel && (input.view === 'front' || input.view === 'back') ? { ...base, view: input.view as View } : base;
  const mockup = mockupRow(input.mockupId);
  if (!template || !mockup) throw fatal('The mockup for this shoot was deleted.');
  const renders = JSON.parse(String(mockup.renders || '{}'));
  if (!renders[template.view]) throw fatal(`The mockup has no ${template.view} render.`);
  const product = getProduct(String(mockup.product_id));
  const sideLayers = JSON.parse(String(mockup.views))[template.view] as { designId: string; x: number; widthCm: number }[];
  const layers = template.key === 'ecom-detail-sleeve' ? sideLayers.filter(isSleeveLayer) : sideLayers; // a sleeve close-up shows only the sleeve artwork
  if (!layers.length && template.key === 'ecom-detail-sleeve') throw fatal('This mockup has no sleeve print.');
  const designFiles = [...new Set(layers.map(l => l.designId))].map(designRow).filter(Boolean).map(d => abs(String(d!.file)));
  const model = template.usesModel ? presetRow(input.modelId) : undefined;
  const location = template.usesLocation ? presetRow(input.locationId) : undefined;
  const studio = template.usesStudio ? presetRow(input.studioId) : undefined; // a saved studio backdrop for the model shots of the store
  const style = presetRow(input.styleId);
  // Sunglasses (a product photo under data/files/accessories/) are worn in front shots of a model only: from behind they would not show.
  const accessoryRel = template.usesModel && template.view === 'front' && /^accessories\/[\w.-]+\.png$/.test(String(input.accessory ?? '')) ? String(input.accessory) : null;

  const out = path.join(ctx.workDir, 'shoot.png');
  const ratio = template.kind === 'lifestyle' ? SHOOT_RATIOS.find(r => r === input.ratio) ?? '4:5' : '4:5'; // e-commerce photos stay in the store's shape
  const framing = template.kind === 'lifestyle' ? SHOOT_FRAMINGS.find(f => f === input.framing) ?? 'medium' : 'medium';
  // A model with a character sheet is sent as that one picture: it already shows the front, side, behind and full length, so no extra photo is needed.
  const sheetFile = model ? presetViewRows(model).sheet?.file : undefined;
  const extraView = model?.file && !sheetFile ? extraModelView(template) : null;
  const extraFile = extraView ? presetViewRows(model!)[extraView]?.file : undefined;
  const placeText = String(location?.description ?? input.placeText ?? '');
  const studioText = String(studio?.description ?? '');
  const files = {
    render: abs(renders[template.view]),
    model: sheetFile ? abs(sheetFile) : model?.file ? abs(String(model.file)) : null,
    modelExtra: extraFile ? abs(extraFile) : null,
    // A photo of the place only when its words are too short to describe it (a bare name like "Dahab Abu Galoum Camp" gets a postcard). A written place works as well, and a photo can leak.
    // a studio's photo always goes along: it carries the exact backdrop colour and floor, which words only approximate
    accessory: accessoryRel ? abs(accessoryRel) : null,
    location: studio?.file ? abs(String(studio.file)) : location?.file && placeText.trim().length < 80 ? abs(String(location.file)) : null,
  };
  // The style is words only: a style photo carries its own subject into the shoot (a ramen-shop "style" photo put Japanese signs behind the model).
  const styleText = [style?.description, input.styleText].filter(Boolean).join('. ');
  await need([...designFiles, ...Object.values(files).filter((f): f is string => !!f)]);
  // Codex's image tool takes at most 5 reference images (more ends the job with no picture). When a shoot has more, the print files become one sheet, then the model's extra photo
  // is left out. The prompt labels follow this same list, so build both from `plan`.
  const plan = planRefs({ prints: designFiles.length, model: !!files.model, modelExtra: !!files.modelExtra, location: !!files.location, accessory: !!files.accessory });
  const images = [files.render];
  if (plan.sheet) images.push(await printSheet(designFiles, path.join(ctx.workDir, 'prints.png')));
  else images.push(...designFiles);
  if (files.model) images.push(files.model);
  if (plan.modelExtra && files.modelExtra) images.push(files.modelExtra);
  if (files.location) images.push(files.location);
  if (files.accessory) images.push(files.accessory);
  const prompt = shootBrief({
    template, productStyle: String(product?.style ?? ''), productColor: String(product?.color ?? ''), productType: String(product?.type ?? ''),
    prints: describePrints(layers), printFiles: designFiles.length, sheet: plan.sheet,
    hasModelPhoto: !!files.model, modelExtra: plan.modelExtra ? extraView : null, modelSheet: !!sheetFile, ratio, framing, locationPhoto: !!files.location,
    modelText: String(model?.description ?? ''), locationText: placeText, studioText, styleText, notes: input.notes ?? '',
    accessoryPhoto: !!files.accessory, accessoryText: input.accessoryText, bottoms: input.bottoms,
    variant: input.variant, seed: typeof input.seed === 'number' ? input.seed : seedOf(ctx.id), count: input.count, file: out,
  });
  const { file } = await runCodexImage({ prompt, images, workDir: ctx.workDir, outFile: out, signal: ctx.signal, recoverThreadId: ctx.recoverThreadId, recoverSince: ctx.recoverSince });
  const id = newId('sht');
  const img = await storeImage('shoots', id, await cropToRatio(file, ratio));
  return () => {
    insert('shoots', {
      id, mockup_id: mockup.id, shot: template.key, kind: template.kind, model_id: model?.id ?? null, location_id: location?.id ?? studio?.id ?? null, // a studio photo keeps its studio backdrop in the location column
     
      style_id: style?.id ?? null, notes: input.notes ?? '', favorite: 0, file: img.file, thumb: img.thumb, batch_id: ctx.batchId, created_at: now(),
    });
    return { kind: 'shoot', id };
  };
}

/** A preset job makes a preset's main photo, or (with `view`) an extra photo of a model made from that main photo; the view `sheet` is the character sheet. */
async function runPreset(input: Input, ctx: Ctx): Promise<Commit> {
  const preset = presetRow(input.presetId);
  if (!preset) throw fatal('The preset was deleted.');
  const view = MODEL_PHOTOS.find(v => v === input.view);
  if (view && !preset.file) throw fatal('Make the main photo first.');
  const out = path.join(ctx.workDir, 'preset.png');
  const refs = view ? [abs(String(preset.file))] : [];
  await need(refs);
  const prompt = view === 'sheet' ? characterSheetPrompt({ description: String(preset.description), file: out })
    : view ? modelViewPrompt({ view: view as ModelView, description: String(preset.description), file: out }) : presetPrompt({ kind: preset.kind as any, description: String(preset.description), file: out });
  const { file } = await runCodexImage({ prompt, images: refs, workDir: ctx.workDir, outFile: out, signal: ctx.signal, recoverThreadId: ctx.recoverThreadId, recoverSince: ctx.recoverSince });
  const img = await storeImage('presets', `${preset.id}${view ? `_${view}` : ''}_${Date.now().toString(36)}`, file);
  return () => {
    const id = String(preset.id), cur = presetRow(id);
    if (!cur) return { kind: 'preset', id };
    if (view) update('presets', id, { views: JSON.stringify({ ...presetViewRows(cur), [view]: { file: img.file, thumb: img.thumb } }) });
    else { // a new main photo is a new face, so the extra photos made from the old one no longer match
      const stale = Object.values(presetViewRows(cur)).flatMap(v => (v ? [v.file, v.thumb] : []));
      update('presets', id, { file: img.file, thumb: img.thumb, views: '{}' });
      void removeFiles(...stale, cur.file as string, cur.thumb as string).catch(() => {}); // the photo this one replaces
      if (input.sheet && preset.kind === 'model') enqueue('preset', `Model · ${preset.name} · character sheet`, { presetId: id, view: 'sheet' }); // the course's next step: the sheet follows the photo
    }
    return { kind: 'preset', id };
  };
}

