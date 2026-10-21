// Reads the live Shopify store (read-only) and derives how each product family is set up there:
// product type, theme template, taxonomy category, sizes, price ladder, SKU series, inventory settings,
// tags, attribute metafields and sales channels. "Push to Shopify" copies these so new products match the store.
// Run:  cd studio && node scripts/shopify-profiles.mjs     (needs SHOPIFY_STORE_DOMAIN / SHOPIFY_ACCESS_TOKEN in studio/.env)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(STUDIO, '.env')); } catch { /* env may come from the shell */ }
const { SHOPIFY_STORE_DOMAIN: host, SHOPIFY_ACCESS_TOKEN: token, SHOPIFY_API_VERSION: version = '2026-07' } = process.env;
if (!host || !token) throw new Error('Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN in studio/.env');

async function gql(query, variables = {}) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`https://${host}/admin/api/${version}/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query, variables }) });
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); continue; }
    const j = await r.json();
    if (j.errors?.some(e => e.extensions?.code === 'THROTTLED')) { await new Promise(s => setTimeout(s, 2000 * (i + 1))); continue; }
    return j;
  }
  throw new Error('Shopify kept failing');
}

const FIELDS = `id title handle status productType vendor tags templateSuffix createdAt descriptionHtml seo { title description } category { id fullName }
  options { name values } metafields(first: 30) { nodes { namespace key type value } }
  variants(first: 60) { nodes { sku price compareAtPrice taxable inventoryPolicy inventoryItem { tracked requiresShipping } selectedOptions { name value } } }`;
const products = [];
for (let after = null; ;) {
  const r = await gql(`query($after: String) { products(first: 12, after: $after, sortKey: ID) { pageInfo { hasNextPage endCursor } nodes { ${FIELDS} } } }`, { after });
  const p = r.data?.products; if (!p) throw new Error(JSON.stringify(r.errors).slice(0, 300));
  products.push(...p.nodes); process.stdout.write(`\rpulling products… ${products.length}`);
  if (!p.pageInfo.hasNextPage) break; after = p.pageInfo.endCursor;
}
console.log();
const shop = (await gql('{ shop { name myshopifyDomain currencyCode weightUnit } }')).data.shop;
fs.mkdirSync(path.join(STUDIO, 'data/shopify'), { recursive: true });
fs.writeFileSync(path.join(STUDIO, 'data/shopify/snapshot.json'), JSON.stringify({ pulledAt: new Date().toISOString(), shop, products }));

// ---------- families ----------
const washed = p => p.tags.some(t => /^(washed tee|washed|acid wash tshirt)$/i.test(t));
const FAMILIES = {
  'crewneck':         { label: 'Crewneck sweatshirt', match: p => p.productType === 'Sweatshirt', tags: ['Sweatshirt', 'new arrival'], titleSuffix: 'Sweatshirt' },
  'oversized-hoodie': { label: 'Oversized hoodie', match: p => p.productType === 'Oversized Hoodie', tags: ['Oversized Hoodie', 'new arrival'], titleSuffix: 'Hoodie' },
  'washed-hoodie':    { label: 'Washed (acid wash) hoodie', match: p => p.productType === 'Washed Hoodie', tags: ['Acid wash hoodie', 'new arrival'], titleSuffix: 'Hoodie' },
  'tshirt':           { label: 'Oversized T-shirt', match: p => p.productType === 'Oversized T-Shirt' && p.templateSuffix === 't-shirts' && !washed(p), tags: ['Tee', 'Oversized', 'new arrival'], titleSuffix: 'T-Shirt', tiered: true },
  'washed-tee':       { label: 'Washed oversized T-shirt', match: p => p.productType === 'Oversized T-Shirt' && p.templateSuffix === 't-shirts' && washed(p) && !p.tags.some(t => /long sleeve/i.test(t)), tags: ['Tee', 'Oversized', 'washed', 'new arrival'], titleSuffix: 'T-Shirt', tiered: true },
  'long-sleeve':      { label: 'Washed long-sleeve T-shirt', match: p => p.templateSuffix === 'long-sleeves-washed-tee', tags: ['Long Sleeve T-shirt', 'Washed Tee', 'Oversized', 'Tee', 'new arrival'], titleSuffix: 'Long Sleeves T-Shirt', tiered: true },
};
/** Studio garment style -> store family. */
const STYLES = {
  'Boulevard Oversized T-shirt': 'tshirt', 'Custom Regular T-shirt': 'tshirt', 'Parasola Oversized T-shirt': 'tshirt', 'Washed Oversized T-shirt': 'washed-tee',
  'Premium Oversized Crewneck': 'crewneck', 'Premium Oversized Hoodie': 'oversized-hoodie', 'Washed Oversized Hoodie': 'washed-hoodie', 'Washed Oversized Long Sleeves': 'long-sleeve',
};
const META_KEYS = ['shopify.age-group', 'shopify.fabric', 'shopify.neckline', 'shopify.target-gender', 'shopify.top-length-type', 'shopify.sleeve-length-type',
  'mm-google-shopping.google_product_category', 'mc-facebook.google_product_category', 'mm-google-shopping.age_group'];

const modal = arr => { const m = new Map(); for (const x of arr) m.set(JSON.stringify(x), (m.get(JSON.stringify(x)) ?? 0) + 1); const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]; return top ? JSON.parse(top[0]) : undefined; };
const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);
const sizeOpt = p => p.options.find(o => /size/i.test(o.name));
const counters = {};
for (const p of products) if (p.createdAt >= '2025-01-01') for (const v of p.variants.nodes) { const m = /^([A-Za-z]+)(\d+)/.exec(v.sku || ''); if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, +m[2]); }

const families = {};
for (const [key, f] of Object.entries(FAMILIES)) {
  const pool = products.filter(f.match), active = pool.filter(p => p.status === 'ACTIVE');
  const regular = active.filter(p => !/sale/i.test(p.title) && !p.tags.some(t => /sale/i.test(t)));
  const sample = (regular.length >= 5 ? regular : active.length ? active : pool).sort(newest).slice(0, 15);
  if (!sample.length) { console.log('no products for family', key); continue; }
  const variants = sample.flatMap(p => p.variants.nodes);
  const sizeSets = sample.map(p => sizeOpt(p)?.values ?? []).filter(v => v.length >= 3);
  const pairs = sample.map(p => p.variants.nodes[0]).map(v => [Number(v.price), Number(v.compareAtPrice) > Number(v.price) ? Number(v.compareAtPrice) : null]);
  const base = modal(pairs) ?? [0, null];
  const higher = pairs.filter(([p]) => p > base[0]).sort((a, b) => a[0] - b[0])[0];
  const prefix = modal(variants.map(v => /^([A-Za-z]+)\d/.exec(v.sku || '')?.[1]).filter(Boolean)) ?? 'OVE';
  const metafields = [];
  for (const k of META_KEYS) { const [ns, key2] = k.split('.'); for (const p of sample) { const m = p.metafields.nodes.find(x => x.namespace === ns && x.key === key2); if (m) { metafields.push({ namespace: ns, key: key2, type: m.type, value: m.value }); break; } } }
  families[key] = {
    label: f.label, basedOn: `${sample.length} newest ${regular.length >= 5 ? 'regular active' : 'active'} store products (e.g. "${sample[0].title}")`, exemplar: sample[0].handle,
    productType: modal(sample.map(p => p.productType)), templateSuffix: modal(sample.map(p => p.templateSuffix)) ?? null, category: modal(sample.map(p => p.category?.id).filter(Boolean)) ?? null,
    vendor: modal(sample.map(p => p.vendor)), titleSuffix: f.titleSuffix,
    optionName: modal(sample.map(p => sizeOpt(p)?.name).filter(Boolean)) ?? 'Size', sizes: modal(sizeSets) ?? [],
    price: base[0], compareAt: base[1],
    // tees and long sleeves cost more with extra print areas (e.g. sleeves); other families have no evidence of that, so they keep one price
    morePrintsPrice: f.tiered && higher ? higher[0] : null, morePrintsCompareAt: f.tiered && higher ? higher[1] : null,
    skuPrefix: prefix, skuNext: (counters[prefix] ?? 0) + 1,
    inventoryPolicy: modal(variants.map(v => v.inventoryPolicy)), tracked: modal(variants.map(v => !!v.inventoryItem?.tracked)), taxable: modal(variants.map(v => !!v.taxable)), requiresShipping: modal(variants.map(v => v.inventoryItem?.requiresShipping !== false)),
    tags: f.tags, metafields,
  };
}
// sales channels the newest active products are on (drafts are on none until published)
const pubs = (await gql('{ publications(first: 30) { nodes { id name } } }')).data.publications.nodes;
const ids = products.filter(p => p.status === 'ACTIVE').sort(newest).slice(0, 12).map(p => p.id);
const on = (await gql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { resourcePublicationsV2(first:30){ nodes { isPublished publication { id } } } } } }`, { ids })).data.nodes;
const count = {}; for (const n of on) for (const x of n.resourcePublicationsV2.nodes) if (x.isPublished) count[x.publication.id] = (count[x.publication.id] ?? 0) + 1;
const publications = pubs.filter(p => (count[p.id] ?? 0) >= on.length * 0.8);

const out = { generatedAt: new Date().toISOString(), store: { name: shop.name, domain: shop.myshopifyDomain, currency: shop.currencyCode, weightUnit: shop.weightUnit, productCount: products.length }, publications, styles: STYLES, families };
fs.writeFileSync(path.join(STUDIO, 'server/shopify-profiles.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`${products.length} products read · ${Object.keys(families).length} families → server/shopify-profiles.json · snapshot → data/shopify/snapshot.json`);
for (const [k, f] of Object.entries(families)) console.log(`  ${k.padEnd(17)} ${f.productType} | ${f.templateSuffix} | ${f.category?.split('/').pop()} | "${f.optionName}": ${f.sizes.length} sizes | ${f.price}${f.compareAt ? '/was ' + f.compareAt : ''}${f.morePrintsPrice ? ' (more prints ' + f.morePrintsPrice + ')' : ''} | ${f.skuPrefix}${f.skuNext} | ${f.inventoryPolicy} tracked=${f.tracked} taxable=${f.taxable} | ${f.metafields.length} metafields`);
console.log('channels:', publications.map(p => p.name).join(', '));
