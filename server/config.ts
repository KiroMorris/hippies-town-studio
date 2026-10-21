import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(STUDIO, '.env')); } catch { /* no .env: optional settings stay unset */ }
const DATA = path.resolve(process.env.STUDIO_DATA || path.join(STUDIO, 'data'));

export const config = {
  port: Number(process.env.STUDIO_PORT) || 4322,
  host: process.env.STUDIO_HOST || '127.0.0.1',
  /** Codex threads running at once. Each one spends ChatGPT subscription quota. */
  concurrency: Number(process.env.STUDIO_CONCURRENCY) || 3,
  jobTimeoutMs: (Number(process.env.STUDIO_JOB_TIMEOUT_MIN) || 12) * 60_000,
  maxAttempts: 2,
  /** Admin API access for pushing products (see .env). */
  shopify: { domain: process.env.SHOPIFY_STORE_DOMAIN || '', token: process.env.SHOPIFY_ACCESS_TOKEN || '', apiVersion: process.env.SHOPIFY_API_VERSION || '2026-07' },
  /** fal.ai key for "Upscale to 4K" on a design (server/upscale.ts). */
  falKey: process.env.FAL_KEY || '',
  codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  paths: {
    studio: STUDIO,
    data: DATA,
    db: path.join(DATA, 'studio.db'),
    files: path.join(DATA, 'files'),
    work: path.join(DATA, 'work'),
    clientDist: path.join(STUDIO, 'dist'),
    /** Garment photos and masks: ids, styles, colours and their Cloudinary URLs. */
    catalog: path.join(STUDIO, 'assets', 'catalog.json'),
    /** Original product photos and masks, used before falling back to the catalog's Cloudinary URLs. */
    productSources: process.env.STUDIO_PRODUCT_SOURCES || path.join(DATA, 'media-source', 'products'),
  },
};
