// Runs Codex (ChatGPT-subscription login, no API key) to produce one image file.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Codex, type ThreadOptions } from '@openai/codex-sdk';
import { config } from './config.ts';
import { isImage } from './files.ts';
import { MAX_REFS } from './shootRefs.ts';

const codex = new Codex();

/** limit: usage/rate limit (pause queue, no retry burn) · auth: not logged in · noimage/transient: retry · fatal: never retry. */
export type ErrKind = 'limit' | 'auth' | 'noimage' | 'transient' | 'fatal';

export class JobError extends Error {
  kind: ErrKind;
  /** Codex thread to resume when retrying a noimage failure. */
  threadId: string | null;
  constructor(message: string, kind: ErrKind, threadId: string | null = null) { super(message); this.kind = kind; this.threadId = threadId; }
}

export const fatal = (message: string) => new JobError(message, 'fatal');

export function toJobError(err: unknown): JobError {
  if (err instanceof JobError) return err;
  const message = String((err as any)?.message || err);
  const kind: ErrKind = /usage limit|rate limit|quota|too many requests|try again (in|at)/i.test(message) ? 'limit' : /not logged in|unauthorized|401|login/i.test(message) ? 'auth' : 'transient';
  return new JobError(message, kind);
}

const UNITS: Record<string, number> = { d: 864e5, h: 36e5, m: 6e4, s: 1e3 };
/** Best-effort reset time (ms timestamp) from a limit message like "try again in 2 hours 5 minutes" or "at 3:45 PM". */
export function parseResetAt(message: string): number | null {
  const t = Date.now();
  const rel = message.match(/(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|[dhms])\b[\s,]*(?:and\s*)?)+)/i);
  if (rel) {
    let ms = 0;
    for (const m of rel[1].matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) ms += Number(m[1]) * (UNITS[m[2][0].toLowerCase()] ?? 0);
    if (ms > 0) return t + Math.min(Math.max(ms, 60_000), 7 * 864e5);
  }
  const iso = message.match(/\d{4}-\d\d-\d\dT[\d:.]+Z?/);
  if (iso && Date.parse(iso[0]) > t) return Math.min(Date.parse(iso[0]), t + 7 * 864e5);
  const at = message.match(/at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (at) {
    let h = Number(at[1]) % 12 + (/pm/i.test(at[3] ?? '') ? 12 : 0);
    if (!at[3]) h = Number(at[1]);
    const d = new Date(); d.setHours(h, Number(at[2]), 0, 0);
    if (d.getTime() <= t) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return null;
}

export interface CodexImageRequest {
  prompt: string;
  /** Local image files attached as references, in order. */
  images: string[];
  /** Directory Codex works in; the output file is written here. */
  workDir: string;
  outFile: string;
  signal?: AbortSignal;
  /** Continue an earlier thread (used to refine a design with feedback). */
  resumeThreadId?: string | null;
  /** Thread of a previous attempt that ended without a picture, and when that attempt began (ms). A picture it finished late is taken from the thread's own folder. */
  recoverThreadId?: string | null;
  recoverSince?: number | null;
}

const IMG_RE = /\.(png|webp|jpe?g)$/i;
const listGenerated = async (threadId: string) => {
  const dir = path.join(config.codexHome, 'generated_images', threadId);
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter(n => IMG_RE.test(n));
  return (await Promise.all(names.map(async n => ({ n, p: path.join(dir, n), t: (await fs.stat(path.join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })))).filter(f => f.t);
};

/** Newest image saved for this thread that was not there before the run began. Never returns a pre-existing image. */
async function newestGenerated(threadId: string | null, since: number, before: Set<string>) {
  if (!threadId) return null;
  const fresh = (await listGenerated(threadId)).filter(f => f.t >= since - 500 && !before.has(`${f.n}:${f.t}`));
  return fresh.sort((a, b) => b.t - a.t)[0]?.p ?? null;
}

/**
 * A picture an earlier attempt's thread finished after its turn had ended, copied to `outFile`. It is read from that thread's own folder, newer than the attempt began.
 * Asking Codex to "copy your latest image" is unsafe: every job writes into the same generated_images folder, and Codex picked another job's picture (a shoot got a copy of a different shot).
 */
export async function recoverPicture(threadId: string, since: number, outFile: string) {
  const late = (await listGenerated(threadId)).filter(f => f.t >= since - 1000).sort((a, b) => b.t - a.t);
  for (const f of late) {
    if (!(await isImage(f.p))) continue;
    await fs.copyFile(f.p, outFile);
    return { file: outFile, reply: '', threadId };
  }
  return null;
}

/**
 * Why OpenAI's image service refused a picture. Its answer ("moderation_blocked ... safety_violations=[sexual]") is not in the SDK's result, but it is in the thread's
 * Codex session log, which sits in a folder named for the local date. Returns the categories ("sexual"), or null when the thread was not refused.
 */
export async function safetyBlock(threadId: string | null): Promise<string | null> {
  if (!threadId) return null;
  try {
    for (const back of [0, 1]) { // yesterday too, in case the run crossed midnight
      const d = new Date(Date.now() - back * 864e5);
      const dir = path.join(config.codexHome, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
      const name = (await fs.readdir(dir).catch(() => [] as string[])).find(n => n.endsWith(`${threadId}.jsonl`));
      if (!name) continue;
      const hits = (await fs.readFile(path.join(dir, name), 'utf8')).split('\n').flatMap(line => { const m = line.match(/safety_violations=\[([^\]]+)\]/); return m ? [m[1]] : []; });
      return hits.length ? hits[hits.length - 1].replace(/\s+/g, ' ').trim() : null;
    }
  } catch { /* no log to read: treat it as an ordinary failure */ }
  return null;
}

export async function runCodexImage(req: CodexImageRequest): Promise<{ file: string; threadId: string | null; reply: string }> {
  // The image tool refuses more references than this, so say so at once instead of spending two Codex runs to hear it
  if (req.images.length > MAX_REFS) throw fatal(`Codex's image tool takes at most ${MAX_REFS} reference images, and this job has ${req.images.length}. Use fewer references.`);
  await fs.mkdir(req.workDir, { recursive: true });
  const options: ThreadOptions = {
    workingDirectory: req.workDir,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    modelReasoningEffort: 'low',
  };
  let said = ''; // what Codex last answered, so "no image" can say why (it often asks for something that was not attached)
  /** Runs one turn; returns the saved image and Codex's closing reply, or null if no image appeared. */
  const attempt = async (thread: ReturnType<typeof codex.startThread>, input: Parameters<typeof thread.run>[0], priorId: string | null) => {
    const before = new Set((priorId ? await listGenerated(priorId) : []).map(f => `${f.n}:${f.t}`));
    const since = Date.now();
    const turn = await thread.run(input, { signal: req.signal });
    said = (turn.finalResponse ?? '').replace(/\s+/g, ' ').trim() || said;
    const file = (await isImage(req.outFile)) ? req.outFile : await newestGenerated(thread.id, since, before);
    return file ? { file, reply: turn.finalResponse ?? '' } : null;
  };

  if (req.recoverThreadId && req.recoverSince) {
    const got = await recoverPicture(req.recoverThreadId, req.recoverSince, req.outFile).catch(() => null);
    if (got) return got;
  }

  const thread = req.resumeThreadId ? codex.resumeThread(req.resumeThreadId, options) : codex.startThread(options);
  const input = [
    ...req.images.map(p => ({ type: 'local_image' as const, path: p })),
    { type: 'text' as const, text: req.prompt },
  ];
  const got = await attempt(thread, input, req.resumeThreadId ?? null);
  if (got) return { ...got, threadId: thread.id };
  // Refused by the image safety filter: it judges the finished picture, so another try (or other wording) is refused the same way. Say so and stop.
  const blocked = await safetyBlock(thread.id);
  if (blocked) throw fatal(`OpenAI's image safety filter blocked the picture (${blocked}). It checks the finished image, so retrying or rewording does not help${/sexual/i.test(blocked) ? '. Nude figures can trigger it, even in classical art' : ''}.`);
  throw new JobError(`Codex finished without producing an image.${said ? ` It said: “${said.length > 300 ? `${said.slice(0, 297)}...` : said}”` : ''}`, 'noimage', thread.id);
}

export interface CodexTextRequest {
  prompt: string;
  /** Local image files attached as references, in order. */
  images: string[];
  workDir: string;
  /** JSON schema the answer must match. */
  schema: object;
  signal?: AbortSignal;
  /** Continue an earlier thread (used for one fix pass). */
  resumeThreadId?: string | null;
}

/** One text answer (JSON matching `schema`) from Codex. Read-only, no web, no network: it writes from what it is given. */
export async function runCodexText(req: CodexTextRequest): Promise<{ text: string; threadId: string | null }> {
  await fs.mkdir(req.workDir, { recursive: true });
  const options: ThreadOptions = {
    workingDirectory: req.workDir,
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    modelReasoningEffort: 'medium',
    webSearchMode: 'disabled',
    networkAccessEnabled: false,
  };
  const thread = req.resumeThreadId ? codex.resumeThread(req.resumeThreadId, options) : codex.startThread(options);
  const input = [...req.images.map(p => ({ type: 'local_image' as const, path: p })), { type: 'text' as const, text: req.prompt }];
  const turn = await thread.run(input, { signal: req.signal, outputSchema: req.schema });
  const text = (turn.finalResponse ?? '').trim();
  if (!text) throw new JobError('Codex finished without an answer.', 'transient', thread.id);
  return { text, threadId: thread.id };
}
