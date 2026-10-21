// The photo-shoot prompt. Codex is an agent: handed a long brief, it rewrites it into one short paragraph before the image model sees it, which threw away
// the print instructions ("The print follows the fabric folds" was all that was left). So the prompt travels as a block Codex must pass on WORD FOR WORD
// (PROMPT START .. PROMPT END). Checked in 13 of 13 test shoots: what the image model got was identical to this text.
//
// What it says follows the AI Video Bootcamp lessons (light logic, camera as language, a clean realistic person) and tests on this Studio's own shoots: name a real light
// source, describe what the print DOES on cloth, name the clothes that replace the reference photos' clothes, keep style and colour last. Short on purpose: every sentence
// here is one the image model can see in the picture.
import { BODY_PX, isCloseUp, type ModelView, type ShootFraming, type ShootRatio, type ShotTemplate } from '../shared/types.ts';

/** The camera course's shot sizes for lifestyle photos: what the frame holds and the camera that makes it (wide lenses stretch space, long lenses compress it, a low f-number melts the place). */
const FRAMINGS: Record<ShootFraming, { frame: string; camera: string }> = {
  medium: {
    frame: 'Framed from the waist up to the mid-thigh, with the whole head, the print and the hem inside the frame.',
    camera: 'A good phone photo: the main camera at chest height, slightly wide, the frame tilted about two degrees, deep focus (the background is soft only because it is far away).',
  },
  full: {
    frame: 'Framed full length from the head to the feet with a little ground visible, the person filling about two thirds of the height of the frame.',
    camera: 'A good phone photo: the main camera at waist height a few metres away, slightly wide, the frame tilted about two degrees, deep focus.',
  },
  wide: {
    frame: 'A wide shot: the whole person is full length and fairly small in the lower part of the picture, and the place takes most of the frame.',
    camera: 'A wide 24mm lens from about four metres away at chest height, the frame tilted about two degrees, deep focus so the whole place is sharp.',
  },
  close: {
    frame: 'A close shot from the top of the head down to the waist: the face in the upper part of the frame, the whole main print filling most of the rest, the place a soft blur behind.',
    camera: 'A full-frame camera with an 85mm lens at f/2.8 from about one metre away at chest height, the frame tilted about two degrees, shallow depth of field.',
  },
};

/** How the brief names the picture shape. */
const FORMAT: Record<ShootRatio, string> = { '4:5': 'portrait 4:5', '9:16': 'tall vertical 9:16, like a phone screen', '1:1': 'square 1:1' };

/** The prompt block goes to the image model unchanged; the rules around it keep Codex from "helping". */
const rules = (refs: boolean) => [
  'IMAGE RULES (read first):',
  `- Call your built-in image_gen tool exactly ONCE${refs ? ', passing the attached images as referenced_image_paths in the order they are attached (Image 1 first)' : ', with no reference images'}.`,
  '- The prompt you give image_gen is the text between PROMPT START and PROMPT END, copied character for character: do not shorten, summarise, reorder, reword or add to it, and leave out the two marker lines.',
  '- The only shell command you may run is ONE `cp` that copies the generated image to the target file. Never open, inspect, convert, crop, composite or edit an image with a script.',
  '- If image_gen is rejected by the safety system, do not reword and retry: stop and reply with the rejection reason. If it fails for another reason, you may call it once more with the same prompt.',
].join('\n');

/** Wraps a finished image prompt so that Codex passes it to the image model word for word and saves the result to `file`. */
export function passOn(block: string, file: string, refs = true): string {
  return [rules(refs), 'PROMPT START', block, 'PROMPT END', `Copy the generated image to ${file} and reply with just that path.`].join('\n');
}

/** A seed from a job id, for jobs queued without one: every photo still gets its own pose. */
export const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The extra photo of the model that goes with a shot: only a shot from behind needs one (how the hair falls). More references dilute the likeness and leak clothes and backdrops. */
export const extraModelView = (t: ShotTemplate): ModelView | null => (t.usesModel && t.view === 'back' ? 'back' : null);

// ---------- what is printed where ----------

export interface PrintInfo {
  /** Widths (cm) of the prints on the body of this side (chest or back). */
  body: number[];
  /** Narrow prints on the sleeves, counted on the left and right of the picture. */
  sleeveLeft: number;
  sleeveRight: number;
}

/** A print whose centre lies outside the body width is on a sleeve (same rule as the editor's Copy sleeves). */
export function describePrints(layers: { x: number; widthCm: number }[]): PrintInfo {
  const info: PrintInfo = { body: [], sleeveLeft: 0, sleeveRight: 0 };
  for (const l of layers) {
    if (Math.abs(l.x - 512) > 0.45 * BODY_PX) { if (l.x < 512) info.sleeveLeft++; else info.sleeveRight++; } else info.body.push(l.widthCm);
  }
  return info;
}

// ---------- people ----------

/** Wording for the person: only the noun, so the text never has to guess pronouns. */
const who = (desc: string) => (/\b(woman|girl|female|lady)\b/i.test(desc) ? 'woman' : /\b(man|boy|male|guy)\b/i.test(desc) ? 'man' : 'model');

/** A clean, real person. Named skin flaws (redness, blemishes, uneven tone, shadows under the eyes) are drawn as dirty, blotchy skin, so none are asked for; each photo differs by its pose, light and place. */
const SKIN = 'Clear, healthy skin with an even tone and fine pores that show only up close, fine hair on the cheeks; the hair has a few flyaway strands at the crown. No airbrushed smoothness and no beauty-filter look.';

const BOTTOMS = ['plain blue jeans', 'plain black trousers', 'straight light-wash jeans', 'plain khaki trousers'];

// ---------- the garment ----------

const GARMENT: Record<string, string> = {
  hoodie: 'hood down and resting behind the neck, no drawstrings or cords anywhere (the garment in Image 1 has none), kangaroo pocket visible on front views',
  'long-sleeves': 'long sleeves down to the cuffs, cuffs unrolled',
  crewneck: 'ribbed collar, cuffs and hem, dropped shoulders, sleeves down to the cuffs',
  't-shirt': 'short sleeves, hem untucked and unrolled',
};

const NOUN: Record<string, string> = { hoodie: 'hoodie', crewneck: 'sweatshirt', 't-shirt': 't-shirt', 'long-sleeves': 'long-sleeve tee' };

/** What the cloth is, from the style's name (the brand's own fabrics: brushed cotton fleece, acid-washed finishes, 280 gsm jersey). */
export function fabricOf(style: string, type: string): string {
  const s = style.toLowerCase();
  if (/washed|acid/.test(s)) return 'soft faded garment-dyed cotton with a mottled acid-washed surface';
  if (type === 'hoodie' || type === 'crewneck') return 'heavy brushed cotton fleece with a soft nap';
  return 'heavy soft cotton jersey';
}

// ---------- shots ----------

const POSES: Record<string, string[]> = {
  'ecom-front': [
    'stands facing the camera, weight on the left leg, the right shoulder a touch lower, head tilted slightly, arms hanging loosely a hand-width from the body, a small genuine smile, eyes to the lens',
    'stands facing the camera, weight on the right leg, one hand loosely in a pocket and the other arm relaxed, head turned a few degrees, a calm neutral expression with the lips closed, looking just past the lens',
    'stands in a slight three-quarter turn to the left, arms relaxed and a little away from the body, chin slightly down, a soft half-smile, eyes to the lens',
    'stands in a slight three-quarter turn to the right, hands loosely clasped low in front, a relaxed jaw, eyes to the lens',
    'stands facing the camera with both thumbs hooked in the front pockets, the shoulders relaxed, a quiet half-smile, eyes to the lens',
    'takes one easy step toward the camera, the weight rolling onto the front foot, the arms swinging loosely a hand-width from the body, a small laugh, looking just past the lens',
    'stands with the weight on the right leg and one hand resting on the hip below the print, the other arm hanging, the chin level, a faint smile, eyes to the lens',
    'stands relaxed with one hand holding the opposite cuff low in front, the head tilted toward the left shoulder, a soft closed-lip smile, eyes to the lens',
    'walks across the frame from right to left, caught mid-stride, the torso turned toward the camera, laughing, looking at the lens',
    'leans one shoulder against the wall behind, the arms loosely crossed low at the waist below the print, one ankle crossed over the other, a calm look into the lens',
    'stands in a three-quarter turn with the weight on the back foot, one hand pushing a sleeve up the forearm, looking off to the side with a faint smile',
    'sits on the edge of a tall wooden stool, the torso upright and facing the camera, the forearms resting on the thighs, a relaxed half-smile',
    'turns the head sharply to look back at the camera over one shoulder, the body in a three-quarter turn, one hand brushing the hair behind the ear',
    'stands with a wide relaxed stance, both hands tucked into the back pockets so the chest opens toward the camera, chin up a little, eyes to the lens',
  ],
  'ecom-back': [
    'is seen from directly behind, arms hanging loosely a hand-width from the body, head turned a few degrees',
    'is seen from behind, head turned to look over the left shoulder, weight on one leg',
    'is seen from behind with a slight turn to the right, one hand in a pocket',
    'is seen from behind, head turned to look over the right shoulder',
    'is seen from behind one step away from the camera, the head turned a little to the right, the arms swinging loosely',
    'is seen from behind with both hands in the back pockets, the head turned to look over the left shoulder',
  ],
  'life-front': [
    'stands with one shoulder leaning on a nearby surface, arms loose, looking at the camera',
    'sits casually, torso upright and facing the camera, forearms on the knees',
    'stands in the middle of the scene, looking off to the side',
    'laughs, looking slightly away from the camera',
  ],
  'life-back': [
    'walks away from the camera with the head turned slightly',
    'stands still facing away, looking at the scenery',
    'is turned three-quarters away, looking back over the shoulder',
    'sits with the back to the camera',
  ],
  'life-candid': [
    'is caught mid-step walking toward the camera, arms swinging loosely a hand-width from the body, looking just past the lens with a half-smile, a breeze moving a few strands of hair',
    'walks across the frame side-on, looking ahead',
    'pauses mid-walk to adjust a sleeve cuff, well below the sleeve print',
    'turns around mid-step',
  ],
};

const STUDIO_SCENE = [
  'A small photo studio. A light-grey seamless paper backdrop, a little lighter at the top left and a shade darker toward the lower right, with a faint soft shadow of the model on the paper.',
  'A small photo studio. A warm off-white painted wall with a faint plaster texture and a soft shadow of the model on it.',
  'A small photo studio. A mid-grey seamless paper backdrop with a gentle falloff toward the corners and a soft shadow on the paper.',
];
const STUDIO_LIGHT = [
  'One large softbox camera-left at about 45 degrees and a white bounce card camera-right: the left side is brighter and the right side falls off gently, the shadow side about one stop darker.',
  'One big window-style light camera-right with a gentle falloff toward the left, the shadow side about one stop darker and a soft shadow on the wall.',
  'A large softbox in front and slightly above, with a thin rim of light from behind-left separating the hair and shoulders from the backdrop.',
  'One large softbox camera-right at about 45 degrees and a white bounce card camera-left: the right side is brighter and the left side falls off gently, the shadow side about one stop darker.',
  'A very large soft overhead diffuser with a low white fill from the front: even gentle light, a soft shadow under the chin and under the hem.',
];

/** Places for lifestyle shots when none is picked: real, specific and a little worn (a bare name or a "cafe" gets a stock-photo look). */
const PLACES = [
  'A narrow side street in Zamalek, Cairo, late afternoon in October. Pale ochre plaster walls with patches of peeling paint, a faded blue wooden door with a brass handle, a dusty fig tree leaning over a garden wall, small parked cars and thin overhead wires farther down the street, cracked pavement with a few fallen leaves. Low warm sun from camera-left, about 25 degrees above the horizon, throws long soft shadows across the ground and puts a warm edge on the hair. The sky is hazy and a little too bright.',
  'A narrow limestone lane in old Cairo, mid-morning, with sun on the upper walls and open shade below. Worn wooden doors, a mashrabiya window, tangled cables, half-open shutters, stacked crates and a parked scooter; the lane recedes about 25 metres to a bright end. Soft cool light on the ground, warm light on the walls above.',
  'A flat Cairo rooftop 45 minutes before sunset, a low sun from camera-left and a dusty haze. A waist-high brick parapet, rusted rebar stubs, black water tanks, satellite dishes and patched cement; hazy blocks and minarets far behind.',
  'A downtown Cairo café at 4:30 pm with side light: a cracked cream facade, iron balconies with air-conditioning units, plastic and bentwood chairs, small tea glasses on a table, uneven tiled pavement, parked cars soft in the background.',
];

export interface ShootBriefInput {
  template: ShotTemplate;
  /** "Premium Oversized Crewneck" and "Hunter Green". */
  productStyle: string;
  productColor: string;
  productType: string;
  prints: PrintInfo;
  /** How many print files are on this side (separate images, or 1 sheet when `sheet`). */
  printFiles: number;
  sheet: boolean;
  hasModelPhoto: boolean;
  /** Which extra photo of the model is attached (face, body or back), if any. */
  modelExtra: ModelView | null;
  /** The model photo is a character sheet (several views of the same person in one image), not a single portrait. */
  modelSheet?: boolean;
  /** Picture shape; lifestyle photos only (e-commerce is always 4:5). */
  ratio?: ShootRatio;
  /** How much of the person the photo shows; lifestyle photos only. */
  framing?: ShootFraming;
  /** A photo of the place is attached. */
  locationPhoto: boolean;
  /** Written descriptions from the presets. */
  modelText: string;
  locationText: string;
  /** The description of a saved studio backdrop (the studio photos on a model use it instead of the fixed grey backdrops). */
  studioText?: string;
  /** Sunglasses the model wears (their photo is attached after the place photo) and what she wears below the garment (default: a plain pair from a list). */
  accessoryText?: string;
  accessoryPhoto?: boolean;
  bottoms?: string;
  styleText: string;
  notes: string;
  variant: number;
  /** Picks the pose, the light and the small details; each photo of a shoot gets its own, so the photos differ (defaults to `variant`). */
  seed?: number;
  count: number;
  /** Where Codex must copy the finished picture. */
  file: string;
}

const EXTRA_ROLE: Record<ModelView, string> = {
  face: 'a close-up of the same face: use it for the exact facial features and skin texture',
  body: 'a full-body photo of the same person: use it for height, proportions and posture',
  back: 'the same person from behind: use it for how the hair falls and for the back and shoulders',
};

/** The whole message for Codex: the rules, then the prompt block to pass on unchanged, then where to save. */
export function shootBrief(o: ShootBriefInput): string {
  const t = o.template, v = o.variant, s = o.seed ?? o.variant, pick = <T,>(a: T[]) => a[s % a.length];
  const worn = t.usesModel, studioPhoto = t.kind === 'ecom' && worn, lifestyle = t.usesLocation;
  const flat = t.key.startsWith('ecom-flatlay'), closeUp = isCloseUp(t.key), sleeveClose = t.key === 'ecom-detail-sleeve';
  const colour = o.productColor.toLowerCase().replace(/\s+/g, '-');
  const garment = `${colour} ${o.productStyle.toLowerCase()}`;

  // image numbers, in the order runShoot attaches them
  let n = 1;
  const render = n++;
  const printNo = o.printFiles ? (o.sheet ? `${n}` : o.printFiles > 1 ? `${n}-${n + o.printFiles - 1}` : `${n}`) : '';
  n += o.sheet ? (o.printFiles ? 1 : 0) : o.printFiles;
  const modelNo = o.hasModelPhoto ? n++ : 0;
  const extraNo = o.hasModelPhoto && o.modelExtra ? n++ : 0;
  const placeNo = o.locationPhoto ? n++ : 0;
  const accessoryNo = o.accessoryPhoto ? n++ : 0;
  const manyPrints = !o.sheet && o.printFiles > 1;
  const printImg = o.sheet ? `Image ${printNo}` : manyPrints ? `Images ${printNo}` : `Image ${printNo}`;

  const FR = FRAMINGS[lifestyle ? o.framing ?? 'medium' : 'medium']; // e-commerce photos keep the studio framing
  // ---- scene
  const place = o.locationText.trim() || pick(PLACES);
  // A saved studio backdrop replaces the fixed grey ones for the model shots; its photo keeps the exact colour.
  // The model is IN the studio, not a cut-out in front of a backdrop: feet on its floor, a shadow on it, its colour bouncing back onto her, one light for both.
  const inStudio = !lifestyle && !!o.studioText?.trim() && (t.key === 'ecom-front' || t.key === 'ecom-back');
  const studioScene = inStudio
    ? `A small photo studio. ${o.studioText!.trim().replace(/[.\s]+$/, '')}. The model stands a few steps in front of the backdrop with both feet on the studio floor: a soft contact shadow under the shoes, and a softer shadow of the whole figure on the floor and on the backdrop behind. The colour of the backdrop bounces back as a faint tint onto the shadow side of the hair, the jaw and the sleeves, so the person and the studio share one light.${o.locationPhoto ? ` Image ${placeNo} is this studio: keep its exact backdrop colour, its wall surface and its floor, and photograph the model standing inside it as one picture.` : ''}`
    : null;
  const scene = lifestyle
    ? (o.locationPhoto ? `${place} Image ${placeNo} shows the place: take its buildings, materials and the direction of its light from it, never its people, signs or text.` : place)
    : flat ? 'A flat lay on a pale raw-linen tablecloth (#D9D2C5) with a visible weave. No props.'
    : t.key === 'ecom-ghost' ? 'A ghost-mannequin product photo on a pure white seamless background.'
    : closeUp ? `A close-up of the ${NOUN[o.productType] ?? 'garment'} being worn, in a plain bright room.`
    : studioScene ?? pick(STUDIO_SCENE);

  // ---- subject
  const pose = POSES[t.key] ? POSES[t.key][(s * 5) % POSES[t.key].length] : ''; // stride 5: neighbouring seeds land far apart in the pool
  const sentence = (s: string) => s.replace(/\s+/g, ' ').trim();
  let subject = '';
  if (worn) {
    const ids = extraNo ? `Images ${modelNo} and ${extraNo}` : modelNo ? `Image ${modelNo}` : '';
    const actor = modelNo && o.modelSheet
      ? `The ${who(o.modelText)} from Image ${modelNo}, a character sheet of the same person in several views (take only the face, hair, skin tone and build from it, never its panels, clothes or wall)`
      : modelNo
      ? `The ${who(o.modelText)} from ${ids} (same face, hair, skin tone and build; ignore their clothes and backdrop${extraNo ? `; Image ${extraNo} is ${EXTRA_ROLE[o.modelExtra!]}` : ''})`
      : o.modelText.trim() ? `The model (${o.modelText.trim().replace(/[.\s]+$/, '')})` : 'A model in their twenties with an unretouched, natural look';
    const covered = modelNo && /\bhijab\b/i.test(o.modelText) ? ` The head stays covered by the same hijab as in Image ${modelNo}, in every shot.` : ''; // the sheet rule "never copy its clothes" must not take the hijab off
    subject = sentence(`${actor} ${pose}.${covered} ${FR.frame}`);
  } else if (flat) {
    subject = `the ${garment} from Image ${render} laid flat, ${t.view === 'back' ? 'back' : 'front'} up, centred, the sleeves bent in a loose natural curve so they do not mirror each other exactly, the hem slightly uneven, the ribbing pulled in a little.`;
  } else if (t.key === 'ecom-ghost') {
    subject = `the ${garment} from Image ${render}, ${t.view === 'back' ? 'back' : 'front'} view, as if worn by an invisible person: filled out through the chest and shoulders, the sleeves hanging a little away from the body, the neck opening hollow so the inside back neck rib shows. No mannequin, no body and no hands are visible.`;
  } else {
    const focus = sleeveClose ? 'one sleeve fills the frame from the shoulder seam down toward the cuff, the arm turned so the printed strip on the outside of the sleeve faces the camera and runs down the frame, the whole strip inside the frame'
      : o.prints.body.length ? `the middle of the main print on the ${t.view === 'back' ? 'back' : 'chest'} fills the frame${t.view === 'back' ? '' : ', with the lower edge of the ribbed collar just visible at the top'}`
      : o.prints.sleeveLeft + o.prints.sleeveRight ? 'the upper part of one sleeve strip fills the frame, running down the outside of the sleeve' : 'the cloth fills the frame';
    subject = `${focus}. The cloth bends gently and one soft fold crosses the lower third of the frame. Only the garment is in the picture, with no face and no hands.`;
  }

  // ---- details
  const bottoms = o.bottoms?.trim() || BOTTOMS[v % BOTTOMS.length]; // the same trousers across the photos of one shoot unless a shoot picks them to suit the colours
  const fab = fabricOf(o.productStyle, o.productType);
  const gnote = GARMENT[o.productType] ?? '';
  const details = worn
    ? `${SKIN} The model wears the ${garment} from Image ${render} (${[gnote, fab].filter(Boolean).join(', ')}) with real wrinkles at the elbows, underarms and hem and a soft drape fold across the lower chest. Below it: ${bottoms}, not the clothes in the reference photos.${accessoryNo && worn ? ` The model wears ${o.accessoryText?.trim() || 'the sunglasses'} exactly as shown in Image ${accessoryNo}: on the nose with the arms of the frame over the ears, with the same shape, colour and lens tint, and a small reflection in the lenses.` : ''}`
    : closeUp ? `${fab[0].toUpperCase()}${fab.slice(1)}; tiny fibres and a little pilling catch the light, and small wrinkles gather around the print.`
    : `${fab[0].toUpperCase()}${fab.slice(1)}, with natural wrinkles at the elbows, the shoulders and the hem${gnote ? `; ${gnote}` : ''}.`;

  // ---- the print: what it DOES on cloth
  const sides = t.view === 'back' ? 'back' : 'chest';
  const bodyBit = o.prints.body.length === 1 ? `one large print${o.prints.body[0] ? ` about ${Math.round(o.prints.body[0])} cm wide` : ''} centred on the ${sides}` : o.prints.body.length > 1 ? `${o.prints.body.length} prints on the ${sides}` : '';
  const sleeveN = closeUp && o.prints.body.length ? 0 : o.prints.sleeveLeft + o.prints.sleeveRight; // a close-up of the main print has no sleeves in it
  const sleeveBit = sleeveN === 0 ? '' : sleeveClose ? 'one narrow strip down the outside of a sleeve' : sleeveN === 1 ? `one narrow strip down the outside of the ${o.prints.sleeveLeft ? 'left' : 'right'} sleeve of the picture` : 'a narrow strip down the outside of each sleeve';
  const what = [bodyBit, sleeveBit].filter(Boolean).join(' plus ');
  let print = '';
  if (what && o.printFiles) {
    const art = o.sheet ? `${printImg} is the clean flat artwork (${what}; the sheet is grey and laid out for convenience: ignore the grey and the layout)` : `${printImg} ${manyPrints ? 'are' : 'is'} the clean flat artwork (${what})`;
    const photoNote = closeUp ? '' : ` Image ${render} shows their size and exact position, for that only: ignore its flat shape and flat lighting.`;
    const behaviour = `Draw the same artwork in the same colours and layout, but as DTF ink printed on this cloth, not a sticker: a thin matte film that follows the knit, so the weave still shows through it; it takes the same light and shadow as the cloth around it; every fold and wrinkle that crosses it bends the artwork and runs through it as shadow and highlight${worn || closeUp ? '; and where the body curves, the artwork curves with it and its outer parts turn away from the camera' : ''}. No outline, glow or drop shadow around it.`;
    const sleeves = sleeveClose ? ' The strip faces the camera here, so it shows at its full width; only its two long edges curve away a little around the arm.'
      : sleeveN ? ` Each sleeve strip runs down the outside of the ${worn ? 'arm' : 'sleeve'} and wraps around it, so ${worn ? `from ${t.view === 'back' ? 'behind' : 'the front'} ` : ''}it is narrower than in Image ${render} and its far edge compresses into the seam.` : '';
    print = `The printed graphic: ${art}.${photoNote} ${behaviour}${sleeves}`;
  } else if (o.printFiles === 0) {
    print = `The garment has no print on this side: keep it plain, as in Image ${render}.`;
  }

  // ---- camera and light
  const camera = lifestyle || t.key === 'life-candid'
    ? FR.camera
    : studioPhoto ? 'Shot on a full-frame camera with an 85mm lens at f/4, at chest height, sharp across the body, with fine grain in the shadows.'
    : flat ? 'Shot straight down from about 1.2 metres with a 50mm lens at f/5.6.'
    : t.key === 'ecom-ghost' ? 'Shot at chest height with an 85mm lens at f/8, the whole garment sharp.'
    : 'The camera is about 30 cm from the cloth, held by hand, slightly angled; focus is sharp on the middle of the print and falls off gently toward the edges of the frame.';
  const light = lifestyle ? (/\b(sun|light|lamp|shade|overcast|window)\b/i.test(place) ? '' : 'Low warm sun from camera-left, about 25 degrees above the horizon, long soft shadows.')
    : studioPhoto ? `${pick(STUDIO_LIGHT)}`
    : flat ? 'A window on the left gives soft directional daylight, with a long soft shadow along the right edges of the sleeves and the hem.'
    : t.key === 'ecom-ghost' ? 'Two large softboxes, one on each side, give soft even light with a gentle shadow gradient under the hem.'
    : 'A window on the left gives soft directional daylight that skims across the cloth, so the knit texture and every small wrinkle cast tiny shadows.';
  const look = o.styleText.trim() ? `${o.styleText.trim().replace(/[.\s]+$/, '')}. Where this look differs from the camera or light above, the look wins.`
    : lifestyle ? 'True-to-life colour, no teal-and-orange grade.' : 'True-to-life colour and a neutral white balance.';

  // ---- the block
  // No "no text anywhere" here: the image model applied it to the print too and wiped lettering out of the artwork (a design's title vanished; tested 2026-10-06 without it).
  const constraints = [
    'one real photograph, nothing pasted or composited',
    worn ? 'hair and hands stay clear of the print' : '',
    `keep the garment colour${worn ? '' : ' and cut'} of Image ${render}`,
  ].filter(Boolean).join('; ');
  const lines = [
    `Create one ${lifestyle ? 'lifestyle' : 'e-commerce product'} photograph for a streetwear store, ${FORMAT[lifestyle ? o.ratio ?? '4:5' : '4:5']}.`,
    `Scene: ${scene}`,
    `Subject: ${subject[0].toUpperCase()}${subject.slice(1)}`,
    `Important Details: ${details}`,
    print,
    `Camera: ${camera}`,
    light && `Light: ${light}`,
    `Look: ${look}`,
    o.notes.trim() && `Art direction (it wins over the defaults above where they differ): ${o.notes.trim()}`,
    `Constraints: ${constraints}.`,
  ].filter(Boolean);
  return passOn(lines.join('\n\n'), o.file);
}
