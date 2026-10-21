// Linked sets: the front, back and sleeve prints of one collection share `designs.set_id`, with at most one print per placement.
import type { Placement } from '../shared/types.ts';
import { all, get, newId, run, transaction } from './db.ts';

const PLACEMENTS: Placement[] = ['front', 'back', 'sleeve'];
const bad = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const marks = (list: unknown[]) => list.map(() => '?').join(',');

export interface SetMember { id: string; placement: Placement }

/** A set with one print left is not a set: let that print go. */
export function dissolveLoneSets(setIds: Iterable<unknown>) {
  for (const id of new Set([...setIds].filter(Boolean).map(String))) {
    if (all('SELECT id FROM designs WHERE set_id = ?', id).length < 2) run('UPDATE designs SET set_id = NULL WHERE set_id = ?', id);
  }
}

/**
 * Make exactly these designs one set, each linked as the placement given. `into` names an existing set to change:
 * members it had that are not listed leave it. Designs that come from another set leave that one, and a set left with one print is dissolved.
 */
export function linkDesigns(members: SetMember[], into?: string | null): string[] {
  const ids = members.map(m => m.id);
  if (new Set(ids).size !== ids.length) bad(400, 'Each design can be linked once.');
  if (members.length < 2) bad(400, 'Pick at least two designs to link.');
  if (members.length > PLACEMENTS.length) bad(400, 'A set holds one front, one back and one sleeve print.');
  if (members.some(m => !PLACEMENTS.includes(m.placement))) bad(400, 'Choose front, back or sleeve for each design.');
  const twice = PLACEMENTS.find(p => members.filter(m => m.placement === p).length > 1);
  if (twice) bad(400, `Two of these are both ${twice} prints. A set holds one front, one back and one sleeve print.`);
  const rows = all(`SELECT id, set_id FROM designs WHERE id IN (${marks(ids)})`, ...ids);
  if (rows.length !== ids.length) bad(404, 'One of these designs no longer exists.');
  return transaction(() => {
    const target = into && get('SELECT 1 x FROM designs WHERE set_id = ?', into) ? into : newId('set');
    const leaving = rows.map(r => r.set_id).filter(s => s && s !== target);
    run(`UPDATE designs SET set_id = NULL WHERE set_id = ? AND id NOT IN (${marks(ids)})`, target, ...ids);
    for (const m of members) run('UPDATE designs SET placement = ?, set_id = ? WHERE id = ?', m.placement, target, m.id);
    dissolveLoneSets(leaving);
    return ids;
  });
}

/** Take designs out of their sets. A set left with one print is dissolved. */
export function unlinkDesigns(ids: string[]) {
  if (!ids.length) return;
  transaction(() => {
    const leaving = all(`SELECT DISTINCT set_id FROM designs WHERE set_id IS NOT NULL AND id IN (${marks(ids)})`, ...ids).map(r => r.set_id);
    run(`UPDATE designs SET set_id = NULL WHERE id IN (${marks(ids)})`, ...ids);
    dissolveLoneSets(leaving);
  });
}

/**
 * Checks "make the matching back/sleeve for this design" and works out the set it joins: its own, or a new one.
 * The design only joins the set when the first print is saved, so a cancelled or failed job leaves it unlinked.
 */
export function planMatch(designId: string, wanted: unknown) {
  const row = get('SELECT * FROM designs WHERE id = ?', designId) ?? bad(404, 'Design not found');
  const asked = PLACEMENTS.filter(p => Array.isArray(wanted) && wanted.includes(p));
  if (!asked.length) bad(400, 'Choose which prints to make.');
  const taken = new Set((row.set_id ? all('SELECT placement FROM designs WHERE set_id = ?', row.set_id) : [row]).map(r => String(r.placement)));
  const dup = asked.find(p => taken.has(p));
  if (dup) bad(409, `This set already has a ${dup} print.`);
  const setId = String(row.set_id ?? newId('set'));
  const busy = all(`SELECT input FROM jobs WHERE type = 'design' AND status IN ('queued','running')`)
    .map(j => { try { return JSON.parse(String(j.input)) as Record<string, unknown>; } catch { return {}; } })
    .find(i => (i.setId === setId || i.joinId === designId) && asked.includes(i.placement as Placement));
  if (busy) bad(409, `A ${busy.placement} print is already being made for this set.`);
  return { row, setId, placements: asked };
}
