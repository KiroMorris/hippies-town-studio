import { createHash, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const env = { ...loadEnv('', process.cwd(), 'STUDIO_'), ...process.env };
const api = `http://127.0.0.1:${env.STUDIO_PORT || 4322}`;
/** Setting STUDIO_PASSWORD opens the dev server to the network (router port forward), behind a password. Without it, localhost only. */
const password = env.STUDIO_PASSWORD || '';

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** This Mac (any of its own addresses, incl. the public IP aliased on lo0) and home Wi-Fi devices skip the password; the router (.1) doesn't, since port-forwarded traffic may arrive from it. */
const own = () => new Set(Object.values(networkInterfaces()).flat().map(i => i!.address));
const isLocal = (req: IncomingMessage) => {
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  return /^127\.|^::1$/.test(ip) || own().has(ip) || (/^192\.168\.100\.\d+$/.test(ip) && ip !== '192.168.100.1');
};

/** Same-origin check for writes, plus a password login page for internet visitors (cookie lasts a year; 10 wrong tries locks that IP out for 15 min). */
const COOKIE = 'studio_auth';
const token = createHash('sha256').update(`bastet-studio:${password}`).digest('hex');
const cookieOk = (req: IncomingMessage) => (req.headers.cookie ?? '').split(/;\s*/).some(c => c === `${COOKIE}=${token}`);
const loginPage = (wrong: boolean, logo = (() => { try { return `data:image/png;base64,${readFileSync(new URL('./public/logo.png', import.meta.url)).toString('base64')}`; } catch { return ''; } })()) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hippies Town Studio · made by Kiro</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Playpen+Sans:wght@400&family=Shrikhand&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f3f0;color:#2b2b2b;font:16px Inter,system-ui,sans-serif}
form{width:min(340px,90vw);display:grid;gap:12px;background:#fff;border:1px solid #e6e2d9;border-radius:16px;padding:24px}img{width:100%;height:auto}h1{font:400 22px Shrikhand,Inter,sans-serif;margin:0 0 4px;text-align:center}
.tag{margin:0;text-align:center;font:14px 'Playpen Sans',Inter,sans-serif;color:#5f5a51}.tag b{font:400 14px Shrikhand,sans-serif;color:#b13e3a}
input,button{font:inherit;padding:12px 14px;border-radius:10px;border:1px solid #d3cdc1;background:#fff;color:#2b2b2b}input:focus{outline:3px solid #056e8c;outline-offset:1px}
button{background:#056e8c;color:#fff;border:0;font-weight:600;cursor:pointer}button:hover{background:#0984a7}.err{margin:0;color:#b13e3a;font-size:14px}</style></head>
<body><form method="post" action="/__login">${logo ? `<img src="${logo}" alt="Hippies Town">` : '<h1>Hippies Town</h1>'}<p class="tag">Art Connect People · <b>made by Kiro</b></p>${wrong ? '<p class="err">Wrong password, try again.</p>' : ''}
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required><button>Open the studio</button></form></body></html>`;

function guard(): Plugin {
  const fails = new Map<string, { n: number; until: number }>();
  return {
    name: 'studio-guard',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const from = req.socket.remoteAddress ?? '';
        if (!/^(127\.|::1$|::ffff:127\.)/.test(from) && !req.url?.startsWith('/@') && !req.url?.startsWith('/src/') && !req.url?.startsWith('/node_modules/'))
          res.on('finish', () => console.log(`[visit] ${from} ${req.method} ${req.url} -> ${res.statusCode}`));
        if (!isLocal(req) && !cookieOk(req)) {
          if (!password) { res.statusCode = 403; return res.end('Forbidden'); }
          const f = fails.get(from);
          if (f && f.until > Date.now()) { res.statusCode = 429; return res.end('Too many attempts, try again in 15 minutes'); }
          if (req.method === 'POST' && req.url === '/__login') {
            let body = '';
            req.on('data', c => { if (body.length < 2000) body += c; });
            req.on('end', () => {
              if (same(new URLSearchParams(body).get('password') ?? '', password)) {
                fails.delete(from);
                res.writeHead(303, { Location: '/', 'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax` });
                return res.end();
              }
              const n = (f?.n ?? 0) + 1;
              fails.set(from, { n, until: n >= 10 ? Date.now() + 15 * 60_000 : 0 });
              res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(loginPage(true));
            });
            return;
          }
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(loginPage(false));
        }
        // Writes must come from this page itself (blocks other sites from using a saved login).
        const origin = req.headers.origin;
        if (req.method !== 'GET' && req.method !== 'HEAD' && origin && origin !== `http://${req.headers.host}`) {
          res.statusCode = 403; return res.end('Forbidden origin');
        }
        next();
      });
    },
  };
}

// The API only trusts localhost, so the proxy presents itself as local (the guard above already checked origin).
const proxy: ProxyOptions = { target: api, changeOrigin: true, configure: p => p.on('proxyReq', r => r.removeHeader('origin')) };

export default defineConfig({
  plugins: [react(), guard()],
  server: { port: Number(env.STUDIO_WEB_PORT) || 5182, strictPort: true, host: password ? '0.0.0.0' : 'localhost', proxy: { '/api': proxy, '/files': proxy } },
});
