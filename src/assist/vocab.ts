// The phrase lists behind the Assist button: curated, concrete, visible facts that you click to add to a prompt box.
// Built from the AI Video Bootcamp lessons (light logic, camera as language, depth, skin imperfections), the OpenAI and Google prompting guides,
// and tests on this Studio's own shoots. Rules for every phrase: say what is VISIBLE (a source of light, a fold, a pore), never praise
// ("stunning", "perfect", "8K"); no commas inside a phrase; make sense on their own, whatever else is in the box.

export type AssistField = 'shoot' | 'model' | 'location' | 'studio' | 'style' | 'design' | 'refine';

export interface AssistGroup {
  id: string;
  label: string;
  /** One line shown above the phrases: how to think about this group. */
  tip: string;
  /** 'line': each click starts a new line (for a box with one idea per line). Default: the phrase joins the text with a comma. */
  mode?: 'line';
  items: string[];
}

export const ASSIST_TITLE: Record<AssistField, string> = {
  shoot: 'Art direction', model: 'Model', location: 'Location', studio: 'Studio', style: 'Style', design: 'Design ideas', refine: 'Changes',
};

const shoot: AssistGroup[] = [
  {
    id: 'pose', label: 'Pose & action', tip: 'Real people are caught between moves. Give a small action, an uneven stance, and keep hands and hair off the print.',
    items: [
      'weight on one leg and one shoulder a touch lower', 'caught mid-step walking toward the camera', 'walking away from the camera and glancing back over one shoulder',
      'one hand adjusting the hem of the sweatshirt', 'thumbs hooked in the pockets of the jeans', 'one hand lifting the hood behind the neck',
      'pulling one sleeve cuff down over the hand', 'leaning a shoulder against a wall with the arms loose', 'sitting on a low step with the forearms on the knees',
      'crossing the street between two steps', 'turning the head three-quarters away from the camera', 'tucking a strand of hair behind one ear',
      'holding a coffee cup in one hand with the other hand loose', 'one arm out a little from the body to show the sleeve print', 'arms hanging loose a hand-width from the body',
      'looking down at a phone with a small smile', 'adjusting the collar with one hand', 'laughing at something off-camera', 'stepping off a kerb with the free hand swinging',
      'standing in a doorway with one hand on the frame', 'a slight twist at the waist so the chest turns a little from the camera', 'caught mid-turn with the hair moving',
    ],
  },
  {
    id: 'face', label: 'Expression & gaze', tip: 'Neutral or half-caught expressions look more real than a posed smile. Closed lips also avoid odd teeth.',
    items: [
      'calm neutral expression with the lips closed', 'small genuine smile with the eyes to the lens', 'looking just past the camera', 'caught mid-laugh with the eyes crinkled',
      'relaxed jaw and soft eyes a little tired', 'serious direct stare into the lens', 'half-smile at someone off-frame', 'eyes down looking at the ground ahead',
      'squinting slightly against the sun', 'one eyebrow raised and a small smirk', 'mouth slightly open as if mid-word', 'chin down and eyes up to the camera',
    ],
  },
  {
    id: 'skin', label: 'Skin & hair', tip: 'Skin is the biggest giveaway: ask for fine texture on clear, even skin. Words like redness, blemishes or uneven tone come out as dirty, blotchy skin.',
    items: [
      'visible pores across the nose and cheeks', 'fine vellus hair along the jaw and cheeks', 'natural eyebrows with fine individual hairs', 'a soft natural glow on the cheeks',
      'an even skin tone with a natural matte finish', 'a faint shine on the forehead and nose with matte skin elsewhere', 'clear skin with fine pores that show only up close', 'bright rested eyes with natural lashes',
      'natural lip texture with no gloss', 'slight asymmetry in the face and one eyebrow a little higher', 'creases at the corners of the eyes when smiling', 'flyaway strands at the crown',
      'baby hairs at the hairline', 'natural frizz in the hair and not combed flat', 'a few loose strands across one shoulder', 'hair moved by a light breeze',
      'a light natural sheen on the cheekbones', 'short even stubble along the jaw', 'no airbrushing and no beauty-filter look',
    ],
  },
  {
    id: 'garment', label: 'Garment & fabric', tip: 'Cloth is never smooth. Ask for the wrinkles that gravity and movement make, and say how the fabric takes light.',
    items: [
      'heavy brushed fleece with a soft nap', 'faded garment-dyed cotton with a mottled surface', 'real wrinkles at the elbows and underarms', 'soft pull lines across the chest',
      'creases where the hem meets the hips', 'ribbed cuffs slightly stretched', 'oversized fit with dropped shoulders and some bunching at the elbows', 'sleeves long down to the ribbed cuff',
      'hood resting behind the neck with the drawstrings uneven', 'hem sitting over the waistband', 'a little lint and pilling on the fabric', 'fabric that absorbs the light and stays matte',
    ],
  },
  {
    id: 'print', label: 'Print on cloth', tip: 'Describe what the print DOES on cloth, not what it is. This is what stops the flat sticker look.',
    items: [
      'the ink is matte and the knit texture shows through it', 'folds and wrinkles cross the print and bend the artwork', 'the print curves with the chest and turns away toward the sides',
      'sleeve prints wrap around the arm and look narrower from the front', 'the print takes the same light and shadow as the cloth around it', 'no outline and no glow or drop shadow around the print',
      'print edges crisp but not razor-sharp', 'a deep fold partly swallows the print', 'the print slightly softer on the shadow side', 'same drawing and colours as the file and only the cloth acts on it',
    ],
  },
  {
    id: 'light', label: 'Light', tip: 'Name the source, the side it comes from, and hard or soft. Light that comes from nowhere looks rendered.',
    items: [
      'soft daylight from a large window on the left with a gentle shadow on the right', 'low sun from camera-left with long soft shadows', 'open shade with a bright sky overhead and no hard shadows',
      'bright overcast sky acting as one big softbox', 'hard noon sun with short sharp shadows under the chin and sleeves', 'golden-hour backlight with a warm rim on the hair',
      'on-camera flash at night with a hard shadow on the wall behind', 'warm shop light mixed with cool daylight from the street', 'one tungsten lamp at the side with the rest of the room dark',
      'softbox at 45 degrees on camera-left with a white bounce card on the right', 'the shadow side one stop darker than the lit side', 'light skimming across the cloth so the knit texture shows',
      'warm light on the skin and cool ambient light in the background', 'the same light direction as the other shots of this set', 'light bouncing up from pale ground into the face',
      'dappled light through leaves across the shoulders', 'skin catching a faint sheen while the fabric stays matte', 'window glare at the edge of the frame',
    ],
  },
  {
    id: 'angle', label: 'Angle', tip: 'Where the camera stands sets the mood: low feels strong, high feels small, behind feels private. Pick one angle per photo.',
    items: [
      'eye-level and slightly off-centre', 'frontal view with the shoulders square to the camera', 'three-quarter angle from the left', 'side profile with the camera level with the face',
      'from directly behind showing the back print', 'over-the-shoulder view from behind the person', 'low angle from knee height', 'worm\'s-eye view from the ground looking up',
      'high angle from above looking down at the person', 'Dutch angle with the horizon tilted about ten degrees', 'overhead flat lay shot straight down', 'first-person view with the hands and sleeves in front of the lens',
      'frame tilted about two degrees', 'awkward crop with an object entering at the edge of the frame',
    ],
  },
  {
    id: 'size', label: 'Shot size', tip: 'How much of the person we see: wide shows the place, medium shows the garment, close shows the face or a detail.',
    items: [
      'extreme wide shot with the person small in a large place', 'wide shot showing the person and the whole street', 'full-length shot from head to toe', 'medium-wide shot from the knees up',
      'waist-up to mid-thigh framing', 'medium shot from the waist up', 'chest-up crop with the whole print inside the frame', 'medium close-up from the chest up', 'close-up of the face and the collar',
      'extreme close-up of the print and the knit texture', 'macro close-up 30 cm from the cloth', 'detail shot of the sleeve print wrapping the arm',
    ],
  },
  {
    id: 'lens', label: 'Lens & aperture', tip: 'Wide lenses stretch space and pull things close; long lenses compress it. A low f-number melts the background, a high one keeps everything sharp.',
    items: [
      'wide 24mm lens that stretches the space and exaggerates the nearest hand', '35mm lens at f/5.6 with the street in focus behind', '50mm lens at eye level and f/2.8', '85mm portrait lens at chest height and f/4',
      '200mm telephoto compressing the background into flat layers', 'f/1.4 so the background melts into soft shapes', 'f/8 with everything from the sleeve to the far street sharp',
      'subject two metres from the background so it softens naturally', 'a wall ten metres behind that blurs completely at f/1.4', 'shot like a good phone photo with the main camera at chest height',
      'iPhone 15 Pro rear camera 24mm held by hand',
    ],
  },
  {
    id: 'body', label: 'Camera & lens look', tip: 'A named camera carries its own colour and contrast, a lens family its own softness and flares. Pick one of each, and skip them for phone-style photos.',
    items: [
      'ARRI Alexa look with soft highlight roll-off and natural skin', 'Sony Venice 2 look with clean low-light detail', 'RED V-Raptor look with a crisp high-speed feel',
      'Hasselblad medium format look with very fine detail and a gentle tonal range', 'clean modern lenses with crisp edges and neutral colour', 'warm organic Cooke-style lenses with soft skin and gentle falloff',
      'vintage lenses with lower contrast and a little glow around highlights', 'anamorphic lens with oval out-of-focus lights and a horizontal flare', '35mm film look with fine grain at ISO 400',
      'compact flash camera look with a hard flash',
    ],
  },
  {
    id: 'depth', label: 'Depth & framing', tip: 'AI builds flat by default and pastes the person on. Add something close to the lens and something far away.',
    items: [
      'out-of-focus leaves in the foreground close to the lens', 'a railing in the foreground cutting across one corner', 'a parked scooter in the foreground with the street falling away behind',
      'subject on the right third looking into open space on the left', 'kerb and wall lines leading toward the subject', 'light haze in the distance', 'dust floating in a sunbeam',
      'three layers: a foreground object and the subject and a far background',
    ],
  },
  {
    id: 'place', label: 'Place details', tip: 'Real places are a little worn and a little messy. Add two or three ordinary details and no postcard views.',
    items: [
      'peeling plaster walls and a faded blue wooden door', 'tangled cables and AC units on the wall', 'plastic stools and crates stacked by the shop front', 'laundry hanging from a balcony',
      'a parked scooter and a small car down the street', 'cracked pavement with a few dry leaves', 'bare concrete with old paint marks', 'a corrugated metal shutter half-lowered',
      'an old tiled stairwell with a worn iron railing', 'a flat roof with water tanks and satellite dishes', 'a dry riverbed with pebbles and tyre tracks', 'a sandy lot with a rusted oil drum',
      'a tea stall with small glasses on a metal tray', 'a plain painted wall with lived-in scuffs',
    ],
  },
  {
    id: 'colour', label: 'Colour look', tip: 'Pick one grade and say where it shows. Do not stack looks, and keep it matched to the light.',
    items: [
      'true-to-life colour and neutral white balance', 'warm cream highlights and soft sage shadows', 'muted colour with lifted blacks and fine grain', 'mild phone HDR with slightly lifted shadows',
      '35mm colour-negative look with low contrast and fine grain', 'faded film look with warm shadows', 'cool overcast tones with restrained saturation', 'deep shadows with highlights that roll off softly',
      'one accent colour repeated somewhere in the frame', 'sun-bleached colours with a slight warm cast',
    ],
  },
  {
    id: 'mood', label: 'Mood', tip: 'One short line about how the moment feels.',
    items: [
      'relaxed and unposed like a moment between takes', 'quiet confidence', 'playful and loose', 'casual weekend streetwear lookbook', 'calm and a little tired', 'energetic and mid-movement',
    ],
  },
];

const model: AssistGroup[] = [
  {
    id: 'who', label: 'Who', tip: 'Age, origin and build in a line. Keep it specific.',
    items: [
      'Egyptian woman in her mid-twenties', 'Egyptian woman in her early thirties', 'Egyptian man in his late twenties', 'Egyptian man in his early twenties', 'tall and slim with a long neck',
      'petite and athletic', 'lean build with broad shoulders', 'average height and a soft build', 'stocky and strong with rounded shoulders',
    ],
  },
  {
    id: 'face', label: 'Face', tip: 'Three or four features that make this face THIS face.',
    items: [
      'oval face with high cheekbones', 'long narrow face with a prominent nose bridge', 'round face with a soft jawline', 'strong jawline and a straight nose', 'heavy-lidded dark brown eyes',
      'almond-shaped hazel eyes', 'thick dark eyebrows with a soft arch', 'full natural lips', 'a straight nose with a rounded tip', 'wide-set eyes', 'a soft smile with closed lips', 'dimples when smiling',
    ],
  },
  {
    id: 'marks', label: 'Distinctive marks', tip: 'Keep it to one small mark: a mole or a dimple. Scars, acne and spots come out as dirty skin.',
    items: [
      'a dimple in the left cheek', 'a beauty mark above the right side of the lip', 'a faint mole near the jaw', 'a slightly asymmetrical smile', 'a cleft in the chin',
      'a small dimple in the chin', 'a defined upper lip line', 'small neat ears', 'eyebrows with a gentle natural arch',
    ],
  },
  {
    id: 'skin', label: 'Skin', tip: 'Colour and finish only. Say clear and even; never acne, redness or dry patches.',
    items: [
      'warm olive skin with an even tone', 'light-tan skin with a healthy colour', 'medium-brown skin with a warm golden undertone', 'fine pores that show only up close',
      'deep brown skin with a warm undertone', 'fair skin with a neutral undertone', 'healthy colour with a matte finish',
    ],
  },
  {
    id: 'hair', label: 'Hair', tip: 'Length and texture, neatly styled.',
    items: [
      'long dark brown hair with loose waves and a side part', 'short dark curly hair with faded sides', 'shoulder-length bob with a middle part', 'tight curls with a defined hairline',
      'straight black hair tucked behind the ears', 'a low loose bun', 'flyaway strands at the crown', 'a full beard trimmed neatly', 'light stubble',
    ],
  },
  {
    id: 'photo', label: 'The photo', tip: 'A clean test shot: plain current clothes and a light wall, so the clothes and background do not leak into your shoots.',
    items: [
      'a plain relaxed off-white tee with light-wash jeans and white sneakers', 'no jewellery and no logos', 'no makeup apart from tinted lip balm', 'a clean light-grey wall',
      'soft daylight from a large window on the left', 'head to mid-thigh and standing relaxed', 'looking into the lens with a soft natural half-smile', 'clear and even skin with fine pores',
    ],
  },
];

const location: AssistGroup[] = [
  {
    id: 'place', label: 'Place', tip: 'A real kind of place beats a mood. Name the district, the street or the object.',
    items: [
      'a flat rooftop in Cairo with water tanks and satellite dishes', 'a narrow limestone lane in old Cairo', 'a downtown Cairo café with plastic chairs on cracked pavement',
      'a quiet tree-lined street in Zamalek', 'a dusty coast road on the Sinai coast', 'a dry wadi with pale limestone walls', 'a concrete flyover underpass', 'a 1950s stairwell with worn cement tiles',
      'a side street at night with an open shopfront', 'the Nile corniche with a low stone wall', 'a bus stop on a dusty avenue', 'a rooftop pool deck at a small hotel',
    ],
  },
  {
    id: 'time', label: 'Time & weather', tip: 'Give an hour. It decides the light and the shadows.',
    items: [
      '45 minutes before sunset', 'mid-morning', 'late afternoon', 'bright overcast', 'hot hazy noon', 'blue hour just after sunset', '9 pm after dark', 'early morning with long shadows', 'a little dust in the air',
    ],
  },
  {
    id: 'light', label: 'Light', tip: 'Where the sun or lamp is, and what it does to the shadows.',
    items: [
      'low sun from camera-left', 'sun behind a wall so the ground is in open shade', 'sun on the upper wall and open shade below', 'hard white sun from high camera-right', 'a thin salt haze in the air',
      'warm tungsten light from the shopfront', 'cool daylight from the open end of the lane', 'one orange street lamp and white tube light from the shop',
    ],
  },
  {
    id: 'wear', label: 'Materials & wear', tip: 'Scuffs, patches and clutter make a place believable.',
    items: [
      'peeling ochre plaster', 'rusted rebar stubs', 'worn wooden doors', 'tangled cables', 'faded blue paint', 'scuffed tiles', 'a cracked kerb', 'patched cement', 'dusty windows', 'sun-bleached awnings',
      'plastic stools and crates', 'a parked scooter', 'half-lowered shutters', 'a rusted oil drum',
    ],
  },
  {
    id: 'depth', label: 'Depth layers', tip: 'Something near the camera, the subject in the middle, and a far background.',
    items: [
      'foreground: a railing or a parked scooter', 'midground: the person on the pavement', 'far background: hazy blocks and minarets', 'the lane running back about 25 metres to a bright end',
      'a few small figures out of focus far down the street',
    ],
  },
];

const style: AssistGroup[] = [
  {
    id: 'camera', label: 'Camera look', tip: 'Name a real camera or film. Each one has its own colour, grain and light.',
    items: [
      'unedited iPhone photo with the 26mm main camera', 'on-camera flash at night', 'disposable 35mm flash camera', '35mm colour negative film', 'full-frame camera with an 85mm lens at f/4',
      'compact digital camera from the mid 2000s', 'film photograph with faint halation around bright lights', 'phone photo with mild HDR and slight over-sharpening',
    ],
  },
  {
    id: 'light', label: 'Light', tip: 'The same camera looks different under different light. Pick one setup.',
    items: [
      'one large softbox at 45 degrees with a white bounce card', 'window light with visible falloff', 'bright overcast sky', 'hard noon sun', 'golden-hour backlight', 'a single tungsten lamp',
      'mixed sodium street light and cool LED', 'fluorescent tube light',
    ],
  },
  {
    id: 'colour', label: 'Colour & grain', tip: 'Restraint reads as real. Avoid teal-and-orange grades.',
    items: [
      'true-to-life colour', 'muted colour with lifted blacks', 'low contrast and fine grain', 'warm highlights and cool shadows', 'sun-bleached colours', 'faded greens and warm skin',
      'heavy grain in the shadows', 'no teal-and-orange grade',
    ],
  },
  {
    id: 'flaws', label: 'Imperfections', tip: 'A little wrong is right. Pick two.',
    items: [
      'the frame tilted slightly', 'an awkward crop', 'faint sensor noise in the shadows', 'a window a little overexposed', 'slight motion blur on one hand', 'a small lens flare in the corner', 'a fingerprint smear on the lens',
    ],
  },
];

const design: AssistGroup[] = [
  {
    id: 'subject', label: 'Subject', mode: 'line', tip: 'One clear subject per line. Each line becomes its own set. Add the style, palette and layout after it.',
    items: [
      'a peace sign made of daisies', 'a butterfly with patterned wings', 'two smiling hippie girls in bandanas', 'a retro cartoon cat with a grin', 'a sun with a smiling face', 'a VW camper van with flowers',
      'a mushroom cluster in retro colours', 'a boho sunburst pattern', 'a collage of flowers and old photos', 'round peace-sign sunglasses', 'the slogan Chill Out in bubble letters', 'the slogan Always Find The Light',
      'a cat curled on a crescent moon', 'a daisy in full bloom',
    ],
  },
  {
    id: 'style', label: 'Art style', tip: 'One style per design.',
    items: [
      'a bold simplified graphic with fewer larger shapes', 'ornamental and highly detailed with rich pattern work', 'minimal line art with a limited palette', 'a vintage emblem inside a medallion of lotus petals',
      'a symmetrical iconic centerpiece', 'dark and moody with jewel tones and metallic gold accents', 'heraldic with mirrored lotus or cobras on both sides', 'tomb-painting style with flat profile figures and bold outlines',
      'art-deco geometry with sunburst rays', 'woodcut or linocut with carved strokes and two or three flat inks', 'a dramatic close-up crop', 'celestial with sun and moon and stars',
    ],
  },
  {
    id: 'palette', label: 'Palette', tip: 'Name exact colours, and keep the count small. Fewer inks print cleaner.',
    items: [
      'lapis blue and gold', 'black and ivory with one red', 'terracotta and turquoise and cream', 'two flat colours only', 'metallic gold on black', 'faded earth tones', 'sage and cream',
    ],
  },
  {
    id: 'layout', label: 'Layout', tip: 'Where the print will sit decides the shape.',
    items: [
      'a centred emblem with generous empty margin', 'a tall narrow strip for a sleeve', 'a wide horizontal band across the chest', 'a large back print with room to breathe', 'a small left-chest mark',
      'framed by a circular border made from the artwork itself',
    ],
  },
  {
    id: 'rules', label: 'Print rules', tip: 'DTF prints best with hard edges and flat colour.',
    items: [
      'hard crisp edges', 'no gradients that fade to transparent', 'no lines thinner than a pencil stroke', 'a limited set of flat colours', 'no text unless specified', 'artwork only with no garment or frame', 'transparent background',
    ],
  },
];

const refine: AssistGroup[] = [
  {
    id: 'size', label: 'Size & position', tip: 'One change at a time works best.',
    items: [
      'make the main subject larger', 'make the main subject smaller with more empty margin', 'centre the artwork', 'move the subject to the left', 'crop in tighter on the face', 'show more of the body',
    ],
  },
  {
    id: 'colour', label: 'Colour', tip: 'Name the colour and where it is.',
    items: [
      'use fewer colours', 'swap the gold for silver', 'make the background elements darker', 'make the main colour warmer', 'make the colours more muted', 'add one red accent',
    ],
  },
  {
    id: 'detail', label: 'Detail', tip: 'Say what to remove or simplify.',
    items: [
      'remove the stars', 'simplify the background elements', 'make the outlines thicker', 'remove the small ornaments', 'add more pattern to the border', 'keep everything else exactly the same',
    ],
  },
  {
    id: 'safe', label: 'Print safety', tip: 'Things that keep a DTF print clean.',
    items: [
      'remove any thin hairline strokes', 'remove gradients and soft glows', 'keep the background transparent', 'leave a small empty margin around the edge',
    ],
  },
];

const studio: AssistGroup[] = [
  {
    id: 'backdrop', label: 'Backdrop colour', tip: 'Name the colour and give a hex code: the studio photo then keeps that colour exact in every shot.',
    items: [
      'seamless paper in muted terracotta #B8664A', 'seamless paper in soft sage green #9DAE92', 'seamless paper in warm sand #D9C7AC', 'seamless paper in pale grey #CFCFCF',
      'seamless paper in deep charcoal #2F3133', 'seamless paper in dusty rose #D9AFA3', 'seamless paper in ink blue #1F2F4D', 'seamless paper in mustard yellow #D9A93B',
      'seamless paper in cream white #F2EEE6', 'seamless paper in olive green #6B6F3A', 'seamless paper in burgundy #6E2A35', 'seamless paper in powder blue #B9CCDA',
    ],
  },
  {
    id: 'surface', label: 'Backdrop surface', tip: 'Paper, plaster, fabric or wood: say the material and one visible detail.',
    items: [
      'a limewash plaster wall with soft cloud-like texture', 'a smooth painted wall with a faint roller texture', 'a heavy cotton curtain falling in soft vertical folds', 'vertical oak slat panels with fine grain',
      'seamless paper that curves smoothly down to the floor', 'a faint soft crease in the paper near the floor', 'a plaster wall with a subtle hand-troweled finish', 'a matte concrete wall with fine pores',
      'a whitewashed brick wall with soft shadows in the mortar', 'a pale linen backdrop with a visible weave',
    ],
  },
  {
    id: 'floor', label: 'Floor', tip: 'At full length the camera sees as much floor as wall: name its material and colour.',
    items: [
      'a pale concrete floor', 'a pale oak floor with fine grain', 'a pale terrazzo floor with small grey and white chips', 'a matte black floor',
      'a warm grey resin floor', 'light birch floorboards', 'a polished concrete floor with a soft reflection', 'the same paper continuing from the wall onto the floor',
    ],
  },
  {
    id: 'set', label: 'Set', tip: 'Keep the set empty: a clean backdrop works best, and each shot adds its own light.',
    items: [
      'an empty set with nothing else in the frame', 'a soft gradient from lighter at the top left to darker at the bottom right', 'a wide backdrop that fills the whole frame',
      'a clean edge where the wall meets the floor', 'a very light vignette toward the corners', 'a flat even backdrop with no gradient',
    ],
  },
];

export const ASSIST: Record<AssistField, AssistGroup[]> = { shoot, model, location, studio, style, design, refine };
