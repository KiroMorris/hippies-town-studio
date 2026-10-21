// Claude, through the owner's own Claude login (the `claude` command in headless mode), for the Studio's writing jobs: improve a prompt, describe a model,
// propose shot ideas from a product photo, write a caption. Nothing here spends ChatGPT/Codex quota, needs an API key, or can change a file: the only tool
// Claude gets is Read (to look at the photos it is told about), and no session is saved.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BIN = process.env.STUDIO_CLAUDE_BIN || path.join(os.homedir(), '.local', 'bin', 'claude');
const MODEL = process.env.STUDIO_CLAUDE_MODEL || 'claude-sonnet-5-5';

export interface ClaudeAsk {
  /** Who Claude is and the rules to follow (replaces the coding-assistant default). */
  system: string;
  prompt: string;
  /** Photos Claude must look at: absolute paths. */
  images?: string[];
  /** JSON Schema of the answer; the answer comes back parsed. */
  schema: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Two at a time: each call is a whole Claude run (about 20 to 60 seconds). */
let active = 0;
const waiting: (() => void)[] = [];
const slot = async () => { if (active >= 2) await new Promise<void>(r => waiting.push(r)); active++; };
const release = () => { active--; waiting.shift()?.(); };

export class ClaudeError extends Error {}

/** A friendly message for the usual ways this fails. */
const explain = (text: string): string =>
  /ENOENT|not found/i.test(text) ? 'Claude is not installed on this computer (the `claude` command was not found). Install Claude Code, or set STUDIO_CLAUDE_BIN.'
  : /log ?in|authenticat|unauthori[sz]ed|credential|401|api key/i.test(text) ? 'Claude is not signed in. Open a terminal, run `claude` once and sign in, then try again.'
  : /rate limit|usage limit|quota|overloaded|429|529/i.test(text) ? 'Claude is busy or out of usage right now. Try again in a few minutes.'
  : `Claude could not answer: ${text.replace(/\s+/g, ' ').slice(0, 240)}`;

export async function askClaude<T = unknown>(o: ClaudeAsk): Promise<T> {
  await slot();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-claude-')); // an empty folder, so no project instructions are picked up
  try {
    const dirs = [...new Set((o.images ?? []).map(f => path.dirname(f)))];
    const args = [
      '-p', '--system-prompt', o.system, '--output-format', 'json', '--json-schema', JSON.stringify(o.schema), '--no-session-persistence', '--model', MODEL,
      '--tools', o.images?.length ? 'Read' : '', ...(o.images?.length ? ['--allowedTools', 'Read'] : []), ...dirs.flatMap(d => ['--add-dir', d]),
    ];
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(BIN, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new ClaudeError('Claude took too long. Try again, or shorten the text.')); }, o.timeoutMs ?? 150_000);
      o.signal?.addEventListener('abort', () => { child.kill('SIGTERM'); reject(new ClaudeError('Cancelled')); }, { once: true });
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('error', e => { clearTimeout(timer); reject(new ClaudeError(explain(String(e)))); });
      child.on('close', code => { clearTimeout(timer); code === 0 || stdout.trim() ? resolve(stdout) : reject(new ClaudeError(explain(stderr || `exit code ${code}`))); });
      child.stdin.end(o.prompt);
    });
    let parsed: any;
    try { parsed = JSON.parse(out); } catch { throw new ClaudeError(explain(out || 'no answer')); }
    if (parsed.is_error) throw new ClaudeError(explain(String(parsed.result ?? 'unknown error')));
    const answer = parsed.structured_output ?? (typeof parsed.result === 'string' ? (() => { try { return JSON.parse(parsed.result); } catch { return null; } })() : null);
    if (answer == null) throw new ClaudeError('Claude answered, but not in the expected form. Try again.');
    return answer as T;
  } finally {
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    release();
  }
}
