// Makes the app icons from the two faces in public/logo.png (left part of the logo) on a cream square. Run: node scripts/make-icons.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const pub = fileURLToPath(new URL('../public/', import.meta.url));
const src = sharp(pub + 'logo.png');
const { width, height } = await src.metadata();
const faces = await sharp(pub + 'logo.png').extract({ left: 0, top: 0, width: Math.round(width * 0.55), height }).png().toBuffer().then(b => sharp(b).trim().png().toBuffer());
const cream = { r: 244, g: 243, b: 240, alpha: 1 };
const make = async (size, pad, out) => {
  const inner = Math.round(size * (1 - 2 * pad));
  const img = await sharp(faces).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: cream } }).composite([{ input: img, gravity: 'center' }]).png().toFile(pub + out);
};
await make(180, 0.08, 'apple-touch-icon.png');
await make(192, 0.08, 'icon-192.png');
await make(512, 0.08, 'icon-512.png');
await make(512, 0.2, 'icon-maskable-512.png');
console.log('icons written');
