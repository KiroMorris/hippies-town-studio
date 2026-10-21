// What the store's own pages and smart collections teach us, which the product copy depends on: the tag vocabulary (a tag is
// what puts a product into a collection) and the collection each garment family and theme links to on a product page.

// Hippies Town (bhippie.com, read 2026-10): the live store tags little (winter, Twash, basics, sale), so the vocabulary is the season and wash
// tags that drive its collections plus theme words for the designs.
export const TAG_VOCAB = {
  style: ['Peace', 'Flowers', 'Butterfly', 'Boho', 'Hippie', 'Retro', 'Cartoon', 'Collage', 'Slogan', 'Cats', 'Space', 'Zodiac'],
  line: ['winter', 'summer', 'Twash', 'basics'],
  artist: [] as string[],
};
export const ALLOWED_TAGS = [...TAG_VOCAB.style, ...TAG_VOCAB.line, ...TAG_VOCAB.artist];

type Link = { handle: string; label: string };
/** Collections that exist on bhippie.com (collections.json), keyed by tag. */
const THEME_LINKS: Record<string, Link> = {
  winter: { handle: 'hoodies-sweet-shirts', label: 'Winter Collection' },
  summer: { handle: 'all-summer-t-shirts', label: 'Summer Collection' },
  basics: { handle: 'basics', label: 'Premium Basics' },
  Zodiac: { handle: 'horoscope-t-shirts', label: 'Zodiacs collection' },
};
const FAMILY_LINKS: Record<string, Link> = {
  crewneck: { handle: 'crewneck-winter', label: 'crewnecks' },
  'oversized-hoodie': { handle: 'unisex-hoodie', label: 'hoodies' },
  'washed-hoodie': { handle: 'unisex-hoodie', label: 'hoodies' },
  tshirt: { handle: 'all-summer-t-shirts', label: 'summer t-shirts' },
  'washed-tee': { handle: 'all-summer-t-shirts', label: 'summer t-shirts' },
  'long-sleeve': { handle: 'long-sleeve-summer-acid-washed-t-shirts', label: 'long sleeves t-shirts' },
};

/** The last line of a product page: a link to the theme collection (when a tag has one) and to the garment family. */
export function closingLinks(famKey: string, tags: string[]): string {
  const fam = FAMILY_LINKS[famKey] ?? FAMILY_LINKS.tshirt;
  const have = new Set(tags.map(t => t.trim().toLowerCase()));
  const theme = [...TAG_VOCAB.line, ...TAG_VOCAB.style, ...TAG_VOCAB.artist].find(t => THEME_LINKS[t] && have.has(t.toLowerCase()));
  const a = (l: Link) => `<a href="/collections/${l.handle}">${l.label}</a>`;
  return theme ? `See more in the ${a(THEME_LINKS[theme])} or browse all ${a(fam)}.` : `Browse all ${a(fam)}.`;
}
