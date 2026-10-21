// The Studio's "AI chat" (what the course calls Wise Chat), run on Claude: it sees the product and the model, knows the brand and the realism rules, and writes
// the text the image model is sent. Improve a prompt box, describe a model from a rough idea, propose shot ideas from a mockup, write a social caption.
import path from 'node:path';
import { SHOOT_FRAMINGS, SHOT_TEMPLATES, type View } from '../shared/types.ts';
import { askClaude } from './claude.ts';
import { describePrints } from './shootBrief.ts';

const BRAND = 'Hippies Town (bhippie.com, tagline "Art Connect People") is an Egyptian streetwear brand for young Egyptians into hippie, boho and retro-cartoon style: unisex oversized hoodies, acid-washed hoodies and tees, crewnecks, long sleeves and premium basics with DTF-printed art (peace signs, flowers, butterflies, boho patterns, art collages, retro cartoon characters and mood slogans such as Chill Out or Overthinking is my Cardio; a chest or back print and narrow sleeve strips). Its voice is relaxed, upbeat, short and a bit cheeky. Its photos are made by an AI image model that is sent the text you write word for word, so every word you write should be something the model can SEE.';

/** The realism rules from the owner's AI Video Bootcamp course, OpenAI's and Google's prompting guides, and tests on this Studio's own shoots. */
const REALISM = [
  'Write what is VISIBLE and never praise. Never use: 8K, ultra-realistic, hyperrealistic, masterpiece, stunning, gorgeous, flawless, perfect, cinematic, high quality.',
  'Light: name a real source and the side it comes from, and say if it is hard or soft. Light that comes from nowhere looks rendered. Light must match the place (no studio light outdoors).',
  'Camera: where it stands, how much we see (full, medium, close) and a lens or a phone look. Most real photos of people are phone photos.',
  'Real-world detail: wrinkles in the cloth, a slightly tilted frame, light that matches the place. A person has clear, healthy skin with fine pores and a few flyaway hairs, never skin problems (redness, blemishes, uneven tone): the image model draws them as dirty skin.',
  'People are caught between moves: a small action, an uneven stance, a glance just past the lens. Hands and hair stay clear of the print.',
  'Places are real and a little worn: a district or an object, an hour, two or three ordinary details. No postcards and no mood words.',
  'Build the frame in layers: something near the camera, the subject, a far background (haze or dust helps).',
  'Colour is restrained and comes last: true-to-life, no teal-and-orange.',
  'Positive wording. Keep every fact the owner gave (colours, places, names).',
].join('\n');

const SYSTEM = `${BRAND}\n\nRules for everything you write:\n${REALISM}\nAnswer in the same language the owner used. Do not use dashes as punctuation. Return only the requested JSON.`;

export type AssistField = 'shoot' | 'model' | 'location' | 'studio' | 'style' | 'design' | 'refine';

const FIELD: Record<AssistField, string> = {
  shoot: 'The text is the Art direction note for ONE photo of a model wearing a garment of the brand. Rewrite it as 1 to 3 short sentences (30 to 70 words) that add what is missing: the light, the camera, a small action, one or two place details. Do not describe the print: the Studio does that. Keep every instruction the owner gave.',
  model: 'The text describes a person for an AI casting photo. Rewrite it as one paragraph: age and origin, build and height, the face (three or four specific features: shape, eyes, nose, lips, eyebrows), skin colour, hair, and one last sentence on a plain, current, relaxed streetwear outfit (no logos, text or graphics; relaxed or wide fits, never skinny, not all black). Keep every fact the owner gave, including the gender: use pronouns that match it, or none. The person looks fresh, healthy and well groomed. For a person the rule about imperfections does NOT apply: never write skin problems (acne, pimples, spots, scars, redness, uneven tone, pigment, shadows under the eyes), because the image model draws them as dirty, blotchy skin; at most one small mark such as a mole or a dimple.',
  location: 'The text names a place for lifestyle photos. Rewrite it as a location recipe of 50 to 90 words: the kind of place with a district or object, an hour, where the light comes from, materials and wear, and three depth layers (near, middle, far). Mention no people.',
  studio: 'The text names a studio backdrop for product photos. Rewrite it as 20 to 40 words: the backdrop material (seamless paper, painted wall, limewash plaster, fabric, wood) and its colour with a hex code, the floor material and colour, and one visible detail of the surface (a soft crease, a plaster texture). Describe no light (each photo adds its own), no props, no furniture, no people and no place.',
  style: 'The text describes a photographic look. Rewrite it as 25 to 55 words: a named camera or film, the light setup, colour and grain, two small imperfections. Describe no scene and no subject.',
  design: 'The text has one print-design idea per line (each line becomes its own design). Keep one idea per line. Improve each line: a clear subject, one art style, a palette of 2 to 4 named colours, the composition. DTF print rules: hard edges, flat colours, no gradients, no text unless asked. Use no photo or camera language.',
  refine: 'The text is feedback to change a print design. Rewrite it as precise instructions for one or two changes and say what must stay identical. Use no photo language.',
};

export async function improveText(o: { field: AssistField; text: string; context?: string }): Promise<{ text: string; changed: string }> {
  const text = o.text.trim();
  if (!text) throw new Error('Write a few words first, then Improve can work on them.');
  return askClaude({
    system: SYSTEM,
    prompt: `${FIELD[o.field]}\n${o.context ? `\nContext: ${o.context}\n` : ''}\nThe owner's text:\n"""\n${text.slice(0, 3000)}\n"""\n\nReturn the improved text, and in "changed" one short sentence on what you added or fixed.`,
    schema: { type: 'object', properties: { text: { type: 'string' }, changed: { type: 'string' } }, required: ['text', 'changed'] },
  });
}

/** The course's first step for a model: a rough idea becomes a detailed, realistic description (the AI chat step). */
export async function describeModel(o: { idea: string; gender?: string; age?: string }): Promise<{ description: string }> {
  return askClaude({
    system: SYSTEM,
    prompt: `${FIELD.model}\n\nThe owner's rough idea for a model: """${o.idea.trim().slice(0, 1500)}"""${o.gender ? `\nGender: ${o.gender}` : ''}${o.age ? `\nAge range: ${o.age}` : ''}\n\nReturn the description.`,
    schema: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] },
  });
}

const SHOT_KEYS = SHOT_TEMPLATES.filter(t => t.usesLocation).map(t => t.key);

/**
 * Looks at a mockup (and a model photo) and plans lifestyle shots: the course's "ask the chat for several different prompts". Two modes. Default: different places, hours and
 * light for each idea. `same` (the camera course's coverage): ONE place and one light, many camera setups (angle, shot size, lens), as a photographer covers a scene.
 */
export async function shotIdeas(o: { renderPath: string; modelPath?: string | null; garment: string; theme?: string; count: number; same?: boolean }): Promise<{ ideas: { title: string; shot: string; size: string; place: string; notes: string }[] }> {
  const images = [o.renderPath, ...(o.modelPath ? [o.modelPath] : [])];
  const look = `Use the Read tool to look at the photos: ${images.map((p, i) => `${i + 1}. ${p} (${i === 0 ? `a flat mockup of the garment: ${o.garment}` : 'the model, only for her or his look'})`).join('; ')}.`;
  const people = 'Never write he, she, his or her for the person (their gender is not yours to guess): write "the person" or start the sentence with the verb.';
  const fields = `${people} "shot" is one of ${SHOT_KEYS.join(', ')} (front view, back view or candid walking; a back view needs a back print, so use it at most once); "size" is one of ${SHOOT_FRAMINGS.join(', ')} (medium is waist up, full is head to toe, wide is a small figure in a big place, close is a tight crop with the print filling most of the frame); "title" is 2 to 5 words.`;
  const task = o.same
    ? `Plan ${o.count} photos of ONE scene, as a photographer covers a shoot: the same person, the same garment, the same place and the same light in every photo, and a different camera setup for each. ${o.theme ? `Theme from the owner: ${o.theme}.` : 'Pick one real place: a Cairo street, lane, rooftop or café, or the Sinai coast.'} Write the place ONCE as a location recipe of 50 to 90 words (the kind of place, an hour, where the light comes from and how hard it is, materials and wear, near, middle and far layers) and copy it word for word into every idea's "place". Each idea's "notes" is 20 to 45 words and holds only the camera setup and a small action: the angle (eye level, three-quarter, low from knee height, high, over the shoulder, from behind), the lens feel (24mm wide, 50mm, 85mm portrait, 200mm compressing the background), the aperture look, and what the person does. Cover a range of sizes: at least one wide or full, one medium and one close. ${fields} Keep the print visible: nothing covers the chest or the sleeves.`
    : `Propose ${o.count} DIFFERENT lifestyle photo ideas that show this garment and its print well on the model. ${o.theme ? `Theme from the owner: ${o.theme}.` : 'Mix places and hours: Cairo streets, lanes, rooftops, cafés, the Sinai coast.'} For each idea: ${fields} "place" is a location recipe of 40 to 70 words (a real kind of place, an hour, where the light comes from, materials and wear, near and far layers); "notes" is the art direction in 25 to 50 words (a small action and stance, the camera, the light) and must not repeat the place. Make the ideas clearly different from each other in place, hour, light and camera. Keep the print visible: nothing covers the chest or the sleeves.`;
  const out = await askClaude<{ ideas: { title: string; shot: string; size: string; place: string; notes: string }[] }>({
    system: SYSTEM,
    images,
    prompt: `${look}\n\n${task}`,
    schema: { type: 'object', properties: { ideas: { type: 'array', maxItems: 8, items: { type: 'object', properties: { title: { type: 'string' }, shot: { type: 'string', enum: SHOT_KEYS }, size: { type: 'string', enum: [...SHOOT_FRAMINGS] }, place: { type: 'string' }, notes: { type: 'string' } }, required: ['title', 'shot', 'size', 'place', 'notes'] } } }, required: ['ideas'] },
    timeoutMs: 240_000,
  });
  if (o.same && out.ideas.length) for (const i of out.ideas) i.place = out.ideas[0].place; // one scene: the same words for every photo
  return out;
}

/** A caption and hashtags for a finished photo (the course's Captions step). Claude looks at the photo itself. */
export async function captionFor(o: { photoPath: string; platform: 'instagram' | 'tiktok'; length: 'short' | 'medium'; context?: string }): Promise<{ caption: string; hashtags: string[] }> {
  const words = o.length === 'short' ? 'one short line (under 15 words)' : 'two or three short sentences (30 to 55 words)';
  return askClaude({
    system: `${BRAND}\nYou write social media captions for the brand in its own voice: relaxed, upbeat, short and a bit cheeky, like a friend talking. English by default; a light touch of Egyptian Arabic (Franco or Arabic script) is fine when the owner asks for it. Specific about what is in the photo; no hype, no clichés, no dashes as punctuation, no emojis unless asked; never invent prices, sizes or shipping.`,
    images: [o.photoPath],
    prompt: `Use the Read tool to look at the photo ${o.photoPath}. Write a ${o.platform === 'tiktok' ? 'TikTok' : 'Instagram'} caption of ${words} about what you actually see (the garment, the print, the place, the moment).${o.context ? ` Extra context from the owner: ${o.context}.` : ''} Then give 6 to 8 hashtags: a few for the brand (such as #HippiesTown) and the print, a few for the place or the style.`,
    schema: { type: 'object', properties: { caption: { type: 'string' }, hashtags: { type: 'array', maxItems: 10, items: { type: 'string' } } }, required: ['caption', 'hashtags'] },
  });
}

/** The course's "review" step for a new model: looks at the options side by side and says which one reads as a real person (skin, symmetry, hair), with concrete notes on each. */
export async function rankModels(o: { photos: { id: string; path: string }[] }): Promise<{ best: string; ranking: { id: string; score: number; good: string[]; problems: string[] }[] }> {
  const list = o.photos.map((p, i) => `Photo ${i + 1}: ${p.path}`).join('\n');
  const r = await askClaude<{ best: number; ranking: { photo: number; score: number; good: string[]; problems: string[] }[] }>({
    system: SYSTEM,
    images: o.photos.map(p => p.path),
    prompt: `Use the Read tool to look at each of these casting photos of a person (an AI image model made them from the same description):\n${list}\n\nThe goal is a person who reads as REAL in later photo shoots, so pick the most natural one. Look for: clear, healthy skin with fine pores that show only up close, a face with natural small asymmetry, hair with a few flyaway strands, a soft half-smile, plain current clothes and a light wall. Penalise: waxy, plastic or airbrushed skin, blotchy, dirty or uneven skin, a perfectly symmetrical face, glamour lighting, a gloomy or blank expression, extra jewellery, odd hands or ears, any text. Score every photo from 1 (obviously AI) to 10 (indistinguishable from a real photo). For each give up to 2 specific things that are good and up to 3 specific problems (name the part of the face or body). Then name the best photo by its number.`,
    schema: { type: 'object', properties: { best: { type: 'integer' }, ranking: { type: 'array', items: { type: 'object', properties: { photo: { type: 'integer' }, score: { type: 'number' }, good: { type: 'array', items: { type: 'string' }, maxItems: 2 }, problems: { type: 'array', items: { type: 'string' }, maxItems: 3 } }, required: ['photo', 'score', 'good', 'problems'] } } }, required: ['best', 'ranking'] },
    timeoutMs: 240_000,
  });
  const at = (n: number) => o.photos[n - 1]?.id;
  return {
    best: at(r.best) ?? o.photos[0].id,
    ranking: r.ranking.flatMap(x => (at(x.photo) ? [{ id: at(x.photo)!, score: Math.min(10, Math.max(1, x.score)), good: x.good, problems: x.problems }] : [])),
  };
}

/** The course's Pinterest step: a reference photo is broken into parts (place, look, pose, camera) and turned into words. A photo sent to the image model carries its own subject along; words do not. */
export async function describeReference(o: { photoPath: string }): Promise<{ place: string; look: string; pose: string; shot: string }> {
  return askClaude({
    system: SYSTEM,
    images: [o.photoPath],
    prompt: `Use the Read tool to look at the photo ${o.photoPath}. Break it into parts that an image model can reuse WITHOUT the photo itself (so name nothing that is only a brand or a face):\n- "place": the place as a location recipe of 50 to 90 words: kind of place, hour, where the light comes from, materials and wear, and three depth layers (near, middle, far). No people.\n- "look": the photographic look in 25 to 55 words: camera or film feel, light setup, colour and grain, small imperfections. No subject.\n- "pose": what the person does in 20 to 40 words: stance, small action, where they look. If there is no person, describe how a person could stand in this place.\n- "shot": the camera in 15 to 30 words: angle, shot size (wide, full, medium, close), lens feel (wide, normal, portrait, telephoto) and depth of field.`,
    schema: { type: 'object', properties: { place: { type: 'string' }, look: { type: 'string' }, pose: { type: 'string' }, shot: { type: 'string' } }, required: ['place', 'look', 'pose', 'shot'] },
  });
}

/** What the print should look like in a photo of this side, in words (the check compares the photo with this and the artwork files). */
export function printExpectation(layers: { x: number; widthCm: number }[], view: View, closeUp: boolean): string {
  const p = describePrints(layers), parts: string[] = [];
  if (p.body.length) parts.push(`${p.body.length === 1 ? 'one print' : `${p.body.length} prints`} on the ${view === 'front' ? 'chest' : 'back'} (about ${p.body.map(w => `${Math.round(w)} cm`).join(' and ')} wide)`);
  if (p.sleeveLeft + p.sleeveRight) parts.push(`a narrow strip down the outside of ${p.sleeveLeft && p.sleeveRight ? 'each sleeve (the left and the right)' : p.sleeveLeft ? 'the sleeve on the left of the picture' : 'the sleeve on the right of the picture'}`);
  return `${view === 'front' ? 'Front' : 'Back'} view. Expected: ${parts.join(', and ') || 'no print'}.${closeUp ? ' This is a close-up, so only part of the print may be in the frame.' : ''}`;
}

export interface PrintCheck { verdict: 'ok' | 'fix'; problems: string[]; fix: string }

/**
 * The print check: Claude looks at a photo next to the artwork files and says whether the printed graphic is faithful (present, whole, the same drawing, the same colours, ink on cloth).
 * A second pair of eyes, not a guarantee: tested on 5 good photos (all ok) and 3 made-up failures (mirrored print, wrong artwork, wrong side; all caught).
 */
export async function checkPrint(o: { photoPath: string; artwork: { path: string; title: string }[]; expect: string }): Promise<PrintCheck> {
  const images = [o.photoPath, ...o.artwork.map(a => a.path)];
  return askClaude<PrintCheck>({
    system: 'You are a careful quality checker for print-on-demand apparel photos. An AI image model made the photo from artwork files. You judge only whether the printed graphic on the garment is faithful to the artwork. Be strict about real errors and fair about photography.',
    images,
    prompt: [
      'Use the Read tool to look at these images:',
      `Photo: ${o.photoPath} (the AI-made photograph of a person wearing the garment)`,
      ...o.artwork.map((a, i) => `Artwork ${i + 1}: ${a.path} (the clean artwork file "${a.title}", shown on a plain or transparent background; the photo should show this drawing printed on the cloth)`),
      '', o.expect, '',
      'Check, in this order: (1) every expected print is present (chest or back print, each sleeve strip); (2) each is fully visible, not cut off or hidden by the neckline, hem, sleeve edge, hands or hair; (3) it is the same drawing as the artwork: same elements and layout, not mirrored, nothing added or missing, no garbled shapes or lettering; (4) the same colours (name any colour that drifted); (5) it looks like ink on the cloth, following the folds, not like a sticker with an outline or glow.',
      'Do NOT fail the photo for: shadows or light making the print darker or lighter in places, the print turning away and looking narrower where the cloth curves (especially the sleeve strips seen from the front), a little fabric texture showing through the ink, or a slightly different crop of the artwork.',
      'Answer with verdict "ok" when the print is faithful (differences are minor) or "fix" when one of the five checks fails. "problems": up to 4 short, concrete statements of what is wrong and where (empty when ok). "fix": when the verdict is fix, ONE imperative sentence of at most 35 words for an image editor that says what to change and what to keep, for example "Draw the missing artwork strip down the outside of the left sleeve, matching Artwork 1, and keep everything else unchanged"; empty when ok.',
    ].join('\n'),
    schema: { type: 'object', properties: { verdict: { type: 'string', enum: ['ok', 'fix'] }, problems: { type: 'array', items: { type: 'string' }, maxItems: 4 }, fix: { type: 'string' } }, required: ['verdict', 'problems', 'fix'] },
    timeoutMs: 240_000,
  });
}

export const baseName = (p: string) => path.basename(p);
