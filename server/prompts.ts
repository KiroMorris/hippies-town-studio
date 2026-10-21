import type { ModelView, Placement } from '../shared/types.ts';
import { passOn } from './shootBrief.ts';

/** Rules shared by every prompt. Codex has a shell; without these it "helps" by scripting image edits. */
const IMAGE_TOOL = [
  'IMAGE RULES (read first):',
  '- Make the image with your built-in image_gen tool (not the CLI fallback). Pass every attached image to image_gen as a reference input.',
  '- The only shell command you may run is ONE `cp` that copies the image_gen output to the target file. Never open, inspect, convert, resize, crop, re-encode, composite, cut out, recolor or edit any image with a script or tool (no Python, PIL, ImageMagick, sharp, etc.).',
  '- Try image_gen at most 2 times. If it is still not right, save your best result anyway.',
  '- If image_gen is rejected by the safety system, do not reword the request to get around it and do not try again. Stop, and reply with the rejection reason (its error code and categories) instead of a file path.',
].join('\n');
const save = (file: string) => `Copy the final image to ${file} and reply with just that path.`;

const PLACEMENT_BRIEF: Record<Placement, string> = {
  front: 'a FRONT chest print: compact, balanced composition that reads well on the chest. Square 1024x1024 canvas.',
  back: 'a large BACK print: bold, full composition for a big back area. Portrait 1024x1536 canvas.',
  sleeve: 'a long SLEEVE print: a tall, narrow vertical strip (about 1:4 width to height) running down a sleeve. Portrait 1024x1536 canvas; the strip fills the full canvas height and is centered, everything beside it is transparent.',
};

export const VARIATION_DIRECTIONS = [
  'stay closest to the reference style with a fresh composition',
  'a bolder, more simplified graphic take with fewer, larger shapes',
  'a more ornamental, highly detailed take with rich pattern work',
  'change the pose, angle or framing of the main subject',
  'a minimal line-art take with a limited palette (2-3 colors)',
  'a vintage emblem take: the subject set inside a shaped medallion of the artwork itself (laurel, sunburst, winged disc or lotus ring), with no rectangular frame or border box',
  'a symmetrical, iconic centerpiece take',
  'a darker, moodier take with deep jewel tones and metallic gold accents',
  'a heraldic take: the subject flanked by mirrored lotus, wings or cobras',
  'a stylized tomb-painting take: flat profile figures, bold outlines, limited ochre, turquoise, red and black palette',
  'an art-deco geometric take: sharp symmetry, gold linework, sunburst rays',
  'a woodcut / linocut take: carved textured strokes, two or three flat ink colors',
  'a close-up take: the main subject cropped tighter and larger, dramatic and graphic',
  'a celestial take: the subject combined with sun disc, crescent moon and stars',
];

const PRINT_RULES = [
  'DTF print rules: hard, crisp edges. No soft glows, blurs, shadows or gradients that fade into transparency. No strokes thinner than about 1 mm at print size (nothing hairline). Flat or lightly shaded colors in a limited palette. Leave about 5% empty margin; the artwork must not touch the canvas edge.',
  'Request a TRANSPARENT background from image_gen and keep its alpha as generated. If the result is not transparent, run image_gen again asking for a transparent background; never remove a background yourself.',
  'Artwork only: no t-shirt, mockup, model, frame, border box, watermark or signature. No text unless the idea asks for specific words; never invent words.',
].join('\n');

const PLACEMENT_NAME: Record<Placement, string> = { front: 'FRONT', back: 'BACK', sleeve: 'SLEEVE' };
const REF_NOTE = 'If a reference shows a garment, a person or a product photo, ignore the person, garment, folds and background and take the artwork printed on it. Make a NEW design in that spirit, not a copy, and never copy text or logos from a reference.';
/** The store theme is only a fallback subject or an opt-in twist; otherwise the idea or the reference decides what is drawn. */
const THEME = 'No subject was given, so choose one from the store theme: Egyptian mythology (Bastet, Anubis, lotus, ankh, scarab, eye of Horus, winged sun disc).';
const TWIST = 'Dress the subject in the store theme: ancient Egyptian art style, motifs and palette (lapis blue, gold, turquoise, carnelian).';
const EGYPT_CARE = 'If the subject is Egyptian, keep the iconography faithful to ancient Egyptian art (correct crowns, profile poses, attributes) and use no fake hieroglyph gibberish.';
/** Reply format that lets Codex name the design it just made. */
const saveAndName = (file: string) => `Copy the final image to ${file}. Then reply with exactly two lines: that file path, then a short title (2 to 5 words, no quotes) naming what the design shows.`;

export function designPrompt(o: { idea: string; placement: Placement; refCount: number; variant: number; count: number; file: string; egyptian?: boolean }) {
  const direction = o.count > 1 ? VARIATION_DIRECTIONS[o.variant % VARIATION_DIRECTIONS.length] : '';
  const many = o.refCount > 1;
  return [
    IMAGE_TOOL,
    'Create ONE original t-shirt print design for DTF printing.',
    o.refCount ? `The attached image${many ? 's are' : ' is'} ${o.idea ? `${many ? 'references' : 'a reference'} for style and mood only; the idea below sets the subject` : `the ${many ? 'references' : 'reference'} for subject, style and mood`}. ${REF_NOTE}` : '',
    o.idea ? `Designer's idea: ${o.idea}` : '',
    o.idea || o.refCount ? `Follow that subject exactly and do not swap it for something else${o.egyptian ? '' : '; add no Egyptian mythology or other theme unless the idea or the reference is itself about it'}.` : THEME,
    o.egyptian ? TWIST : '',
    `It is ${PLACEMENT_BRIEF[o.placement]}`,
    direction ? `Creative direction: ${direction}.` : '',
    PRINT_RULES,
    EGYPT_CARE,
    saveAndName(o.file),
  ].filter(Boolean).join('\n');
}

/** A later print of a linked set, made from the earlier ones (Image 1, 2…) so the set reads as one collection. */
export function setPrompt(o: { idea: string; placement: Placement; mates: Placement[]; file: string; egyptian?: boolean }) {
  return [
    IMAGE_TOOL,
    `Create ONE original t-shirt print design for DTF printing: the ${PLACEMENT_NAME[o.placement]} print of a matching set.`,
    ...o.mates.map((p, i) => `Image ${i + 1} is the ${PLACEMENT_NAME[p]} print of the same set.`),
    `Design this ${o.placement} print so the whole set reads as one collection: the same subject world, artistic style, color palette and line weight, but a new composition that suits this placement. Do not repeat or copy the other prints.`,
    o.idea ? `Designer's idea: ${o.idea}` : '',
    o.egyptian ? TWIST : '',
    `It is ${PLACEMENT_BRIEF[o.placement]}`,
    PRINT_RULES,
    EGYPT_CARE,
    save(o.file),
  ].filter(Boolean).join('\n');
}

const EXTRACT_RULES = [
  'DTF print rules: crisp edges, and no soft glows or blurs that fade into transparency. Leave about 5% empty margin so the artwork does not touch the canvas edge. Keep the artwork\'s own proportions; do not squeeze it into a square.',
  'Request a TRANSPARENT background from image_gen and keep its alpha as generated. If the result is not transparent, run image_gen again asking for a transparent background; never remove a background yourself.',
  'Artwork only. A border or frame that is part of the artwork stays; a box, backdrop, watermark or signature that is not part of it does not.',
].join('\n');

/** Exact extraction: recreate the artwork that is in the reference, as it is, instead of making a new design inspired by it. */
export function extractPrompt(o: { notes: string; placement: Placement; file: string }) {
  return [
    IMAGE_TOOL,
    'Extract the artwork from the attached reference image and recreate it as a clean file for DTF printing.',
    `The reference may be a photo of a garment, a mockup, a screenshot or the artwork on its own. Find the ${PLACEMENT_NAME[o.placement]} print (or, if the image is only artwork, the whole image) and reproduce THAT artwork EXACTLY: the same subject, composition, proportions, colors, line work, shading and every detail. Keep any lettering exactly as it appears. Do not redesign, restyle, simplify, recolor or reinterpret it, and do not add or remove anything.`,
    'Leave out everything that is not the artwork: the garment, fabric texture and folds, shadows, lighting, hands, people, the background and any mockup. Where a fold or a hand hides part of the artwork, complete it faithfully from the parts you can see. If the artwork is tilted or in perspective, straighten it so it reads flat and front-on.',
    o.notes ? `Extra instructions from the designer: ${o.notes}` : '',
    EXTRACT_RULES,
    saveAndName(o.file),
  ].filter(Boolean).join('\n');
}

export function refinePrompt(o: { feedback: string; hasImage: boolean; file: string }) {
  return [
    IMAGE_TOOL,
    `Revise the t-shirt print design${o.hasImage ? ' attached' : ' you made earlier in this thread'}. Regenerate the whole design with image_gen, using the previous design image as the input to edit. Never edit its pixels with scripts.`,
    `Feedback: ${o.feedback}`,
    'Change only what the feedback asks for; keep everything else identical. Keep the same canvas size, placement and transparent background.',
    PRINT_RULES,
    EGYPT_CARE,
    save(o.file),
  ].join('\n');
}

// The photo-shoot prompt lives in shootBrief.ts. The prompts below make the saved presets (model, extra photos of a model, location, style). Like the shoot prompt, each travels as a
// block that Codex must pass on word for word: left alone, Codex shortens the brief and the specific wording (light, skin, wear) is lost.

/**
 * Identity photo for a saved model: a clean agency test shot ("digitals"). Not a passport photo (a generic stock face that every shoot copies) and not a messy snapshot (it looks dirty). Tested 2026-10-05:
 * a blank closed-lip expression, black clothes, a beige textured wall, film grain and skin words like blemishes, redness or uneven tone gave gloomy, blotchy faces, so the look is a soft half-smile,
 * a light-grey wall, daylight and clear, even skin with fine pores; marks like acne, spots or scars must not be written into a description either. The clothes are plain and current (the shoots name their own).
 */
const OUTFIT = 'They wear the clothes named in the description; if none are named, a plain relaxed off-white crew-neck tee, relaxed straight light-wash jeans and white sneakers.';
const modelBlock = (description: string) => [
  'Create one photograph, portrait 4:5.',
  'Scene: A clean, empty light-grey wall, smooth and plain. Soft daylight from a large window camera-left with gentle falloff across the face and small window catchlights in the eyes. Camera at chest height, natural depth of field, neutral white balance, a clean sharp image.',
  `Subject: A working fashion model in a natural agency test shot ("digitals"). The person: ${description.trim().replace(/[.\s]+$/, '')}. Standing upright and relaxed, head to mid-thigh, arms loose, weight on one leg, eyes to the camera with a soft natural half-smile, fresh and well rested. ${OUTFIT}`,
  'Important Details: Clear, healthy skin with an even tone, a soft natural sheen on the forehead and nose, and fine pores that show only up close; bright rested eyes, neat groomed eyebrows, neatly styled hair with natural movement and only a few flyaway strands; the face is slightly asymmetric, as real faces are. The clothes are plain, clean and well fitted, with soft natural folds.',
  'Use Case: a reference photo that keeps one person consistent across later shoots.',
  'Constraints: no skin smoothing, no plastic skin, no heavy makeup, no glamour lighting, no jewellery, no logos, no text or watermark.',
].join('\n\n');

const MODEL_VIEW_SHOT: Record<ModelView, { subject: string; details: string }> = {
  face: {
    subject: 'a tight close-up portrait: the face fills most of the frame from the top of the hair to just below the chin, eyes to the camera, a relaxed expression with a faint natural smile.',
    details: 'sharp focus on the eyes, clear skin with fine pores that show only up close, neat eyebrows, natural lip texture, hair strands catching the light, the exact facial features, skin tone and any beauty mark from Image 1.',
  },
  body: {
    subject: 'a full-length photo: the whole person from head to feet inside the frame with a little floor visible, standing upright and relaxed, arms loose at the sides, weight slightly on one leg, eyes to the camera, a soft natural half-smile.',
    details: 'true proportions and height, the exact face, skin tone, hair and body build from Image 1, and the same clothes and shoes as Image 1.',
  },
  back: {
    subject: 'photographed from directly behind, standing upright and relaxed, head facing straight away from the camera, arms loose at the sides, framed from the top of the head to the mid-thigh, face not visible.',
    details: 'the exact hair colour, length, texture and parting from Image 1 as it falls over the back and shoulders, true shoulder width and back build, neck and ears, the same clothes as Image 1 with soft natural folds across the back.',
  },
};

/** Extra photo of a saved model, made from its main photo (Image 1) so it stays the same person. */
export function modelViewPrompt(o: { view: ModelView; description: string; file: string }) {
  const v = MODEL_VIEW_SHOT[o.view];
  return passOn([
    'Image 1 is the identity reference: the new photo must show this exact same person (face shape, eyes, nose, lips, eyebrows, skin tone, any beauty mark, hair colour, length and texture, build). Ignore the framing, light, clothes and wall of Image 1.',
    'Create one photograph, portrait 4:5.',
    'Scene: The same clean light-grey wall and soft daylight from camera-left as Image 1, camera at chest height, natural depth of field, neutral white balance.',
    `Subject: ${v.subject}${o.description ? ` The person: ${o.description.trim().replace(/[.\s]+$/, '')}.` : ''}`,
    `Important Details: ${v.details} Clear, healthy skin with a soft matte finish; clean, sharp, rested and well groomed.`,
    'Use Case: a reference photo that keeps one person consistent across later shoots.',
    'Constraints: the same person as Image 1, no beauty retouching, no skin smoothing, no glamour look, no jewellery, no logos, no text.',
  ].join('\n\n'), o.file);
}

/**
 * "Fix this photo": one stated change to a finished photograph, in the Change / Preserve / Constraints form OpenAI's guide gives for edits (the course: keep editing the
 * strongest result instead of starting over). Image 1 is the photo, Image 2 the clean artwork (so a print fix can match it exactly).
 */
export function fixPrompt(o: { feedback: string; hasArtwork: boolean; sheet: boolean; file: string }) {
  const art = o.hasArtwork
    ? `The printed graphic: Image 2 is the clean artwork${o.sheet ? ' (several files side by side on grey: ignore the grey and the layout)' : ''}. Wherever the print shows in Image 1, keep it exactly as it is, unless the change is about the print: then draw it to match Image 2 exactly (the same drawing, the same colours, the same layout) as thin matte ink printed on the cloth that follows the folds, with no outline, glow or drop shadow.`
    : '';
  return passOn([
    'Image 1 is a photograph. Edit it: make exactly the one change below and leave everything else as it is.',
    `Change: ${o.feedback.trim().replace(/[.\s]+$/, '')}.`,
    'Preserve: the same person (face, hair, skin texture, expression and pose), the same garment (colour, cut, fit and folds), the same place, light, camera angle and framing, and every part of the picture the change does not touch.',
    art,
    'Constraints: one real photograph at the same size and framing as Image 1; nothing pasted or composited; no text added; hair and hands stay clear of the print.',
  ].filter(Boolean).join('\n\n'), o.file);
}

/**
 * A character sheet (the course's step between "one good photo" and "consistent scenes"): the same person from the front, the side, three-quarter, behind and full length in one 16:9
 * picture, made from the model's main photo. A shoot then sends this single picture as the identity reference, which shows the back of the hair and the build too and leaves reference
 * slots free (Codex takes at most 5 images). Tested: five panels came out as one person; four panels without the back view was the first try.
 */
export function characterSheetPrompt(o: { description: string; file: string }) {
  return passOn([
    'Image 1 is the identity reference: every panel must show this exact same person (face shape, eyes, nose, lips, eyebrows, skin tone, any beauty mark, hair colour, length and texture, build) in the same clothes. Ignore the framing, light and wall of Image 1.',
    'Create one character reference sheet, landscape 16:9, with five panels side by side separated by thin white gutters.',
    'Scene: The same clean, plain light-grey wall behind every panel, lit by the same soft daylight from camera-left with gentle falloff. No labels, no numbers and no text anywhere.',
    `Subject: The same person${o.description.trim() ? ` (${o.description.trim().replace(/[.\s]+$/, '')})` : ''} shown five ways, each time in the same clothes as Image 1 (the same garments, colours and fit, and the same shoes): panel 1 a front view from the head to the mid-thigh looking into the lens; panel 2 a side profile from the head to the mid-thigh; panel 3 a three-quarter view from the head to the mid-thigh; panel 4 a view from directly behind from the head to the mid-thigh, the face not visible, showing how the hair falls over the back and shoulders; panel 5 a full-length front view from the head to the feet, standing relaxed.`,
    'Important Details: The face, hair, proportions and skin texture are identical in every panel, exactly as in Image 1. Natural, clear, healthy skin with an even tone and a soft matte finish, fine pores that show only up close and fine vellus hair; the hair keeps its natural texture and flyaway strands. A soft natural half-smile in the front and three-quarter views and a relaxed closed mouth in the side view.',
    'Use Case: a character sheet that keeps one person consistent across later photo shoots.',
    'Constraints: the same person in all five panels, no jewellery, no logos, no beauty retouching, no skin smoothing, no text or watermark.',
  ].join('\n\n'), o.file);
}

/** A place for lifestyle shoots. "Wide establishing shot... like a real photograph" gave an oversaturated postcard, so this asks for an ordinary, worn, lived-in place with a stated light. */
const locationBlock = (description: string) => [
  'Create one photograph, portrait 4:5.',
  `Scene: ${description.trim().replace(/[.\s]+$/, '')}. A real place, a little worn and lived in, not a staged postcard: ordinary clutter, scuffs and everyday objects. The foreground at standing height is empty so a person can later stand there.`,
  'Camera: Shot like a good phone photo at about 1.5 m height, slightly wide, deep focus, a little noise in the shadows.',
  'Light: Natural light that matches the hour. If the scene names no light, low warm sun from camera-left about 25 degrees above the horizon with long soft shadows.',
  'Look: True-to-life colour, muted and restrained: no oversaturated sky or water, no teal-and-orange grade.',
  'Use Case: a place reference for later photo shoots.',
  'Constraints: no people, no text, no watermark.',
].join('\n\n');

/** A style is words only in a shoot (a style photo leaks its own subject), so its photo is just a small sample of the look on a plain object. */
const styleBlock = (description: string) => [
  'Create one photograph, portrait 4:5.',
  'Scene: A plain folded sweatshirt on a wooden chair beside a window in an empty room. Nothing else is in the picture.',
  `Look: ${description.trim().replace(/[.\s]+$/, '')}. Show the look through the light, the camera and the colour only.`,
  'Use Case: a small sample of a photographic look for later photo shoots.',
  'Constraints: no people, no text, no watermark.',
].join('\n\n');

/** A studio backdrop: an empty, clean photo-studio set (the colour and surface of the backdrop and the floor). It travels with the studio photos of a model so the backdrop colour is exact; a studio is not a worn place, so no clutter. */
const studioBlock = (description: string) => [
  'Create one photograph, portrait 4:5.',
  `Scene: An empty small photo studio seen from where the camera will stand. ${description.trim().replace(/[.\s]+$/, '')}. The backdrop fills the whole frame behind an empty floor where a person can later stand; there is nothing else in the picture: no people, no furniture, no props, no stands and no lights in the frame.`,
  'Camera: Camera at chest height, straight on, a clean sharp image with a natural depth of field.',
  'Light: Soft studio light from a large softbox camera-left at about 45 degrees with a gentle falloff toward the right; the backdrop is evenly lit and a little lighter at the top left.',
  'Look: True-to-life colour: the backdrop colour is exactly as described, with no colour cast.',
  'Use Case: a studio backdrop reference for later product photos.',
  'Constraints: no people, no text, no watermark.',
].join('\n\n');

export function presetPrompt(o: { kind: 'model' | 'location' | 'studio' | 'style'; description: string; file: string }) {
  const block = { model: modelBlock, location: locationBlock, studio: studioBlock, style: styleBlock }[o.kind](o.description);
  return passOn(block, o.file, false);
}
