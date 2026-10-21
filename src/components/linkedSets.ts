// Which designs are linked into sets (the front, back and sleeve prints of one collection), for marking them where designs are chosen.
import type { Design, Placement } from '../../shared/types.ts';

export const SET_LABEL: Record<Placement, string> = { front: 'Front', back: 'Back', sleeve: 'Sleeve' };
const ORDER: Placement[] = ['front', 'back', 'sleeve'];
/** Colours that carry white text, so one set can be told from the next. */
export const SET_COLORS = ['#c92a2a', '#d9480f', '#2b8a3e', '#0b7285', '#1864ab', '#6741d9', '#a61e4d', '#5c940d'];

export interface SetInfo {
  /** Every linked set: its prints in front, back, sleeve order. Archived prints, and a set left with one print, do not count. */
  members: Record<string, Design[]>;
  /** The colour of a set. It goes by when the set was first made, so a set keeps its colour as newer ones are linked. */
  color: Record<string, string>;
  /** The set ids, the newest set first. */
  order: string[];
}

export function linkedSets(designs: Pick<Design, 'id' | 'setId' | 'status' | 'placement' | 'createdAt'>[]): SetInfo {
  const groups: Record<string, typeof designs> = {};
  for (const d of designs) if (d.setId && d.status !== 'archived') (groups[d.setId] ??= []).push(d);
  const members: Record<string, Design[]> = {};
  for (const [id, ds] of Object.entries(groups)) {
    if (ds.length > 1) members[id] = [...ds].sort((a, b) => ORDER.indexOf(a.placement) - ORDER.indexOf(b.placement) || a.createdAt.localeCompare(b.createdAt)) as Design[];
  }
  const ids = Object.keys(members);
  const born = (id: string) => members[id].map(d => d.createdAt).sort()[0], newest = (id: string) => members[id].map(d => d.createdAt).sort().reverse()[0];
  const color = Object.fromEntries([...ids].sort((a, b) => born(a).localeCompare(born(b)) || a.localeCompare(b)).map((id, i) => [id, SET_COLORS[i % SET_COLORS.length]]));
  const order = [...ids].sort((a, b) => newest(b).localeCompare(newest(a)) || a.localeCompare(b));
  return { members, color, order };
}

/** The other prints of a design's set (none when it is not linked). */
export const matesOf = (info: SetInfo, d: Pick<Design, 'id' | 'setId'>): Design[] => (d.setId && info.members[d.setId] ? info.members[d.setId].filter(m => m.id !== d.id) : []);
