import sharp from 'sharp';
import { config } from './config.ts';

/** Long side of an upscaled print file ("4K"): 4096 px is about 35 cm at 300 DPI. */
export const UPSCALE_LONG = 4096;
const MODEL = 'fal-ai/esrgan';

export class UpscaleError extends Error {}

/**
 * Upscales a transparent print to a 4096 px long side with fal.ai (Real-ESRGAN, faithful: it sharpens what is there and invents nothing).
 * Upscalers drop transparency, so the colours are sent with their edges bled outward (no dark or grey fringe at the cut line)
 * and the alpha goes through the model separately as a grey picture, then is put back (2 calls per print).
 */
export async function upscalePrint(png: Buffer): Promise<Buffer> {
  if (!config.falKey) throw new UpscaleError('Add your fal.ai key to studio/.env as FAL_KEY=… and restart the Studio.');
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const long = Math.max(w, h);
  if (long >= UPSCALE_LONG) throw new UpscaleError(`This print is already ${w} × ${h} px.`);
  const target = UPSCALE_LONG / long;
  const scale = Math.min(4, Math.ceil(target));

  const rgb = await bleed(data, w, h);
  const colourIn = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const alphaIn = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extractChannel(3).toColourspace('srgb').png().toBuffer();
  // The cut line matters as much as the colours, so the alpha is upscaled by the model too (as a grey picture).
  const [bigColour, bigAlpha] = await Promise.all([esrgan(colourIn, scale), esrgan(alphaIn, scale)]);

  const W = Math.round(w * target), H = Math.round(h * target);
  const colour = await sharp(bigColour).removeAlpha().resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const alpha = await sharp(bigAlpha).removeAlpha().extractChannel(0).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  return sharp(colour, { raw: { width: W, height: H, channels: 3 } }).joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

async function esrgan(png: Buffer, scale: number): Promise<Buffer> {
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${config.falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: `data:image/png;base64,${png.toString('base64')}`, scale, model: 'RealESRGAN_x4plus', output_format: 'png' }),
    signal: AbortSignal.timeout(180_000),
  }).catch(e => { throw new UpscaleError(`fal.ai did not answer (${(e as Error).message}).`); });
  const body = await res.json().catch(() => ({})) as { image?: { url?: string }; detail?: unknown };
  if (res.status === 401 || res.status === 403) throw new UpscaleError('fal.ai refused the key in studio/.env (FAL_KEY). Check it on fal.ai → Keys.');
  if (!res.ok || !body.image?.url) throw new UpscaleError(`fal.ai failed (${res.status}): ${JSON.stringify(body.detail ?? body).slice(0, 200)}`);
  return Buffer.from(await (await fetch(body.image.url)).arrayBuffer());
}

/** RGB where every see-through pixel takes the colour of the nearest artwork (blur of premultiplied colour ÷ blur of alpha), so the edge stays clean when upscaled. */
async function bleed(rgba: Buffer, w: number, h: number): Promise<Buffer> {
  const n = w * h;
  const pre = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    for (let c = 0; c < 3; c++) pre[i * 4 + c] = Math.round(rgba[i * 4 + c] * a / 255);
    pre[i * 4 + 3] = a;
  }
  // The smallest blur that reaches a pixel gives its fill (nearest colour); far-away pixels fall back to wider blurs, then grey.
  const fill = Buffer.alloc(n * 3, 128);
  const done = new Uint8Array(n);
  for (const sigma of [2, 8, 32, 128]) {
    const b = await sharp(pre, { raw: { width: w, height: h, channels: 4 } }).blur(sigma).raw().toBuffer();
    for (let i = 0; i < n; i++) {
      const ba = b[i * 4 + 3];
      if (done[i] || ba < 3) continue;
      for (let c = 0; c < 3; c++) fill[i * 3 + c] = Math.min(255, Math.round(b[i * 4 + c] * 255 / ba));
      done[i] = 1;
    }
  }
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a ? rgba[i * 4 + c] : fill[i * 3 + c]; // straight alpha: a soft edge keeps its own colour
  }
  return out;
}
