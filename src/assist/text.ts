// Text helpers for the Assist palette: add or take out a phrase in a prompt box, and spot words that make AI pictures look fake.
// Pure functions (no React), so they are easy to test.

const isEdge = (c: string | undefined) => c === undefined || /[\s,;.]/.test(c);

/** Where `phrase` sits in `text` (ignoring case), as a whole piece and not inside a longer word, or null. */
function find(text: string, phrase: string): { start: number; end: number } | null {
  const hay = text.toLowerCase(), needle = phrase.toLowerCase().trim();
  if (!needle) return null;
  for (let from = 0; ;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return null;
    const end = i + needle.length;
    if (isEdge(hay[i - 1]) && isEdge(hay[end])) return { start: i, end };
    from = i + 1;
  }
}

export const has = (text: string, phrase: string) => find(text, phrase) !== null;

/** Adds `phrase` after the text, separated by a comma. Does nothing when it is already there. The first phrase in an empty box gets a capital letter. */
export function add(text: string, phrase: string): string {
  const p = phrase.trim();
  if (!p || has(text, p)) return text;
  const t = text.replace(/\s+$/, '');
  if (!t) return p[0].toUpperCase() + p.slice(1);
  return /[,;.]$/.test(t) ? `${t} ${p}` : `${t}, ${p}`;
}

/** Takes `phrase` out and tidies the commas around it. */
export function remove(text: string, phrase: string): string {
  const at = find(text, phrase);
  if (!at) return text;
  const before = text.slice(0, at.start).replace(/[\s,;]+$/, ''), after = text.slice(at.end).replace(/^[\s,;]+/, '');
  if (!before) return after;
  if (!after) return before;
  return /\n\s*$/.test(text.slice(0, at.start)) || /^\s*\n/.test(text.slice(at.end)) ? `${before}\n${after}` : `${before}, ${after}`;
}

/** Like `add`, but on a new line (for boxes with one idea per line). */
export function addLine(text: string, phrase: string): string {
  const p = phrase.trim();
  if (!p || has(text, p)) return text;
  const t = text.replace(/\s+$/, '');
  return t ? `${t}\n${p}` : p;
}

/** Click once to add, click again to take out. */
export const toggle = (text: string, phrase: string) => (has(text, phrase) ? remove(text, phrase) : add(text, phrase));
export const toggleLine = (text: string, phrase: string) => (has(text, phrase) ? remove(text, phrase) : addLine(text, phrase));

export interface Slop { id: string; label: string; tip: string }

/** Words that push a picture toward the fake, polished "AI look" (OpenAI's and Google's prompting guides, and tests on this Studio's own shoots). */
const SLOP: { id: string; label: string; re: RegExp; tip: string }[] = [
  { id: 'res', label: '8K / 4K', re: /\b[48]\s?k\b/gi, tip: 'Resolution words do not add detail. Describe what is visible instead.' },
  { id: 'ultra', label: 'ultra-realistic / hyper-detailed', re: /\b(?:ultra|hyper)[- ]?(?:realistic|real|detailed|sharp|hd)\b/gi, tip: 'Stacked quality words push toward the polished AI look. Real skin texture and a named light work better.' },
  { id: 'hype', label: 'masterpiece / award-winning / high quality', re: /\b(?:masterpiece|award[- ]winning|best quality|high[- ]quality|professional photography)\b/gi, tip: 'Praise words do nothing for the picture. Name the camera, the light and the place.' },
  { id: 'flatter', label: 'stunning / flawless / perfect', re: /\b(?:stunning|gorgeous|breathtaking|flawless|perfect(?:ly)?)\b/gi, tip: 'Flattering words give airbrushed, plastic-looking people. Ask for clear skin with fine pores and real wrinkles in the cloth.' },
  { id: 'cinematic', label: 'cinematic', re: /\bcinematic\b/gi, tip: '"Cinematic lighting" tells the model nothing. Say where the light comes from, from which side, hard or soft.' },
];

/** The slop words found in `text`, each once. */
export function slopIn(text: string): Slop[] {
  return SLOP.filter(s => { s.re.lastIndex = 0; return s.re.test(text); }).map(({ id, label, tip }) => ({ id, label, tip }));
}

/** Deletes the words of one slop group from `text` and tidies the gaps. */
export function stripSlop(text: string, id: string): string {
  const s = SLOP.find(x => x.id === id);
  if (!s) return text;
  return text.replace(s.re, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([,;.])/g, '$1').replace(/([,;])\s*(?=[,;])/g, '').replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/,\s*\n/g, '\n');
}
