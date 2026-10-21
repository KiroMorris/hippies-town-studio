import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

fs.mkdirSync(config.paths.data, { recursive: true });
export const db = new DatabaseSync(config.paths.db);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const hasCol = (table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === col);

/** Ordered migrations; PRAGMA user_version records how many have run. Append only, never edit. */
const MIGRATIONS: (() => void)[] = [
  () => db.exec(`
CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', placement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', favorite INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL,
  parent_id TEXT, batch_id TEXT, thread_id TEXT, file TEXT NOT NULL, thumb TEXT NOT NULL,
  width INTEGER NOT NULL, height INTEGER NOT NULL, transparent INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, file TEXT NOT NULL, thumb TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mockups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, product_id TEXT NOT NULL, body_width REAL NOT NULL,
  views TEXT NOT NULL, renders TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  file TEXT, thumb TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shoots (
  id TEXT PRIMARY KEY, mockup_id TEXT NOT NULL, shot TEXT NOT NULL, kind TEXT NOT NULL,
  model_id TEXT, location_id TEXT, style_id TEXT, notes TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL, thumb TEXT NOT NULL, batch_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, label TEXT NOT NULL, batch_id TEXT,
  input TEXT NOT NULL, result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
`),
  () => {
    if (!hasCol('jobs', 'run_after')) db.exec('ALTER TABLE jobs ADD COLUMN run_after INTEGER');
    db.exec(`
CREATE INDEX IF NOT EXISTS designs_batch ON designs(batch_id);
CREATE INDEX IF NOT EXISTS designs_parent ON designs(parent_id);
CREATE INDEX IF NOT EXISTS shoots_mockup ON shoots(mockup_id);
CREATE INDEX IF NOT EXISTS jobs_batch ON jobs(batch_id);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
  },
  () => {
    db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, style TEXT NOT NULL, design_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', price REAL, compare_at REAL, tags TEXT NOT NULL DEFAULT '[]', sizes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft', media TEXT NOT NULL DEFAULT '[]', hidden TEXT NOT NULL DEFAULT '[]', shopify_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_key ON listings(style, design_key);
`);
    if (!hasCol('mockups', 'listing_id')) db.exec('ALTER TABLE mockups ADD COLUMN listing_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS mockups_listing ON mockups(listing_id)');
  },
  () => {
    if (!hasCol('presets', 'views')) db.exec(`ALTER TABLE presets ADD COLUMN views TEXT NOT NULL DEFAULT '{}'`);
  },
  () => {
    if (!hasCol('designs', 'set_id')) db.exec('ALTER TABLE designs ADD COLUMN set_id TEXT');
    if (!hasCol('designs', 'gen_ms')) db.exec('ALTER TABLE designs ADD COLUMN gen_ms INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS designs_set ON designs(set_id)');
    try { // how long existing designs took, from the jobs that made them
      db.exec(`UPDATE designs SET gen_ms = (SELECT CAST((julianday(j.finished_at) - julianday(j.started_at)) * 86400000 AS INTEGER) FROM jobs j WHERE json_extract(j.result, '$.id') = designs.id AND j.started_at IS NOT NULL AND j.finished_at IS NOT NULL LIMIT 1) WHERE source != 'uploaded'`);
    } catch { /* optional */ }
  },
  () => {
    if (!hasCol('listings', 'shopify')) db.exec('ALTER TABLE listings ADD COLUMN shopify TEXT');
  },
  () => {
    for (const col of ['seo_title', 'seo_description', 'copy_at']) if (!hasCol('listings', col)) db.exec(`ALTER TABLE listings ADD COLUMN ${col} TEXT`);
  },
  () => {
    if (!hasCol('presets', 'group_id')) db.exec('ALTER TABLE presets ADD COLUMN group_id TEXT');
    if (!hasCol('shoots', 'caption')) db.exec(`ALTER TABLE shoots ADD COLUMN caption TEXT NOT NULL DEFAULT ''`);
    if (!hasCol('shoots', 'hashtags')) db.exec(`ALTER TABLE shoots ADD COLUMN hashtags TEXT NOT NULL DEFAULT ''`);
  },
  () => {
    if (!hasCol('listings', 'note')) db.exec(`ALTER TABLE listings ADD COLUMN note TEXT NOT NULL DEFAULT ''`); // the owner's own note, never sent to Shopify
  },
  () => {
    // the test shot "Flat lay · keep text" became the normal flat lay once every shot stopped saying "no text anywhere"
    db.exec(`UPDATE shoots SET shot = 'ecom-flatlay' WHERE shot = 'ecom-flatlay-text'`);
    db.exec(`UPDATE jobs SET input = json_set(input, '$.shot', 'ecom-flatlay'), label = replace(label, 'Flat lay · keep text (test)', 'Flat lay · front') WHERE type = 'shoot' AND json_extract(input, '$.shot') = 'ecom-flatlay-text'`);
  },
];

for (let v = Number((db.prepare('PRAGMA user_version').get() as any).user_version); v < MIGRATIONS.length; v++) {
  db.exec('BEGIN');
  try { MIGRATIONS[v](); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
export const now = () => new Date().toISOString();

type Row = Record<string, unknown>;
export const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as Row[];
export const get = (sql: string, ...params: unknown[]) => db.prepare(sql).get(...(params as never[])) as Row | undefined;
export const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[]));

/** Insert a row from a plain object whose keys are column names. */
export function insert(table: string, row: Row) {
  const keys = Object.keys(row);
  run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => row[k]));
}

/** Update the given columns of one row by id. */
export function update(table: string, id: string, row: Row) {
  const keys = Object.keys(row);
  if (keys.length) run(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => row[k]), id);
}

export const transaction = <T>(fn: () => T): T => {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
};
