// Downloads an image from a pasted link, or from a page that has one (its og:image). Links to this computer or the local network are refused.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import sharp from 'sharp';

/** An error whose message is safe to show the user. */
export class LinkError extends Error {}

const MAX_BYTES = 30e6;
const MAX_HTML = 1.5e6;
const MAX_HOPS = 4;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FORMATS = ['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff'];
const PRIVATE = 'That link points to this computer or your local network, so it was blocked.';

const blocked = new net.BlockList();
for (const [addr, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(addr, bits, 'ipv6');
export const isPrivateIp = (ip: string) => { try { return blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4'); } catch { return true; } };

/** Resolve names ourselves and refuse private results, so a public-looking name or a redirect can't reach the local network. */
const guardedLookup = ((host: string, opts: dns.LookupOptions, cb: (...args: any[]) => void) => {
  dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as dns.LookupAddress[];
    if (!list.length || list.some(a => isPrivateIp(a.address))) return cb(new LinkError(PRIVATE));
    if (opts.all) cb(null, list); else cb(null, list[0].address, list[0].family);
  });
}) as net.LookupFunction;

interface Download { body: Buffer; type: string; url: URL }

async function download(link: string, hops = 0): Promise<Download> {
  let url: URL;
  try { url = new URL(link); } catch { throw new LinkError('That is not a valid link.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new LinkError('Only http and https links work.');
  if (url.username || url.password) throw new LinkError('Links with a login in them are not supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateIp(host)) throw new LinkError(PRIVATE);
  return new Promise<Download>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      lookup: guardedLookup, timeout: 12_000,
      headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,text/html;q=0.5,*/*;q=0.1', 'Accept-Encoding': 'identity', Referer: `${url.origin}/` },
    }, res => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_HOPS) return reject(new LinkError('That link redirects too many times.'));
        let next: string;
        try { next = new URL(res.headers.location, url).toString(); } catch { return reject(new LinkError('That link redirects somewhere invalid.')); }
        return download(next, hops + 1).then(resolve, reject);
      }
      if (status !== 200) { res.resume(); return reject(new LinkError(`The site answered with error ${status}.`)); }
      if (Number(res.headers['content-length']) > MAX_BYTES) { res.resume(); return reject(new LinkError('That file is too large.')); }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BYTES) req.destroy(new LinkError('That file is too large.')); else chunks.push(c); });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] ?? '').toLowerCase(), url }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new LinkError('The site took too long to answer.')));
    req.on('error', reject);
  });
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&#x2F;/gi, '/');

/** The picture a page advertises for sharing (og:image / twitter:image), as an absolute link. */
function pageImage(html: string, base: URL): string | null {
  const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) ?? [];
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find(v => v !== undefined);
  const abs = (v: string | undefined) => { try { return v ? new URL(decode(v), base).toString() : null; } catch { return null; } };
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
    for (const tag of tags) {
      if (!/^<meta/i.test(tag) || (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase() !== key) continue;
      const found = abs(attr(tag, 'content'));
      if (found) return found;
    }
  }
  for (const tag of tags) if (/^<link/i.test(tag) && attr(tag, 'rel')?.toLowerCase() === 'image_src') { const found = abs(attr(tag, 'href')); if (found) return found; }
  return null;
}

const nameFrom = (url: URL) => {
  let last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try { last = decodeURIComponent(last); } catch { /* keep it raw */ }
  return (last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim() || url.hostname).slice(0, 60);
};

/** Download the image behind a link. A page link works too: its og:image is used. */
export async function fetchImageFromLink(link: string): Promise<{ buffer: Buffer; name: string }> {
  let got = await download(link.trim());
  if (got.type.includes('html')) {
    const img = pageImage(got.body.subarray(0, MAX_HTML).toString('utf8'), got.url);
    if (!img) throw new LinkError('That page has no picture to use. Open the image itself and copy its address.');
    got = await download(img);
  }
  const format = await sharp(got.body, { limitInputPixels: 80_000_000 }).metadata().then(m => m.format, () => undefined);
  if (!format || !FORMATS.includes(format)) throw new LinkError('That link is not a PNG, JPG or WebP image.');
  return { buffer: got.body, name: nameFrom(got.url) };
}

/** A plain-words reason for a failed download. */
export function linkErrorMessage(e: unknown): string {
  if (e instanceof LinkError) return e.message;
  const code = String((e as NodeJS.ErrnoException)?.code ?? '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'That address could not be found.';
  if (/^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE)$/.test(code)) return 'The site could not be reached.';
  if (/CERT|TLS|SSL/i.test(code) || /certificate/i.test(String((e as Error)?.message))) return "The site's security certificate is not valid.";
  return 'The download failed.';
}
