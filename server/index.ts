import express, { type ErrorRequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { api } from './routes.ts';
import { startQueue } from './queue.ts';
import { backfillListings } from './listings.ts';
import { smallFiles } from './thumbs.ts';

const app = express();
app.disable('x-powered-by');

// Local-only hardening: reject DNS-rebinding (foreign Host) and cross-site writes (foreign Origin).
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const ORIGINS = new Set([Number(process.env.STUDIO_WEB_PORT) || 5182, config.port].flatMap(p => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]));
app.use((req, res, next) => {
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  if (!LOCAL.has(host)) return void res.status(403).json({ error: 'Forbidden host' });
  const origin = req.headers.origin;
  if (req.path.startsWith('/api') && req.method !== 'GET' && req.method !== 'HEAD' && origin && !ORIGINS.has(origin)) return void res.status(403).json({ error: 'Forbidden origin' });
  next();
});
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
app.use(express.json({ limit: '5mb' }));
app.use('/api', api);
app.use('/files', smallFiles(config.paths.files), express.static(config.paths.files, { maxAge: '1h', fallthrough: false }));

// Production: serve the built client with an SPA fallback. In dev, Vite serves it and proxies /api and /files here.
if (fs.existsSync(path.join(config.paths.clientDist, 'index.html'))) {
  app.use(express.static(config.paths.clientDist));
  app.get(/^\/(?!api|files).*/, (_req, res) => res.sendFile(path.join(config.paths.clientDist, 'index.html')));
}

app.use(((err, _req, res, _next) => {
  const status = Number(err?.status ?? err?.statusCode) || 500;
  if (status >= 500) console.error('[api]', err);
  if (res.headersSent) return;
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : String(err?.message || 'Bad request') });
}) as ErrorRequestHandler);

backfillListings();
startQueue();
app.listen(config.port, config.host, () => {
  console.log(`Hippies Town Studio API (made by Kiro) on http://${config.host}:${config.port} · data in ${config.paths.data} · ${config.concurrency} Codex jobs at once`);
});
