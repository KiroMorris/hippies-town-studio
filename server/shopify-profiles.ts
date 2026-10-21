// The store's conventions per product family (product type, theme template, taxonomy, sizes, price ladder, SKU series,
// inventory settings, tags, attribute metafields) plus its sales channels. Derived from the live store by
// scripts/shopify-profiles.mjs, so "Push to Shopify" produces products that look like the store's own.
import fs from 'node:fs';

export interface Family {
  label: string; basedOn: string; exemplar: string;
  productType: string; templateSuffix: string | null; category: string | null; vendor: string; titleSuffix: string;
  optionName: string; sizes: string[];
  price: number; compareAt: number | null; morePrintsPrice: number | null; morePrintsCompareAt: number | null;
  skuPrefix: string; skuNext: number;
  inventoryPolicy: 'CONTINUE' | 'DENY'; tracked: boolean; taxable: boolean; requiresShipping: boolean;
  tags: string[]; metafields: { namespace: string; key: string; type: string; value: string }[];
}
export interface Profiles {
  generatedAt: string;
  store: { name: string; domain: string; currency: string; weightUnit: string; productCount: number };
  publications: { id: string; name: string }[];
  styles: Record<string, string>;
  families: Record<string, Family>;
}

let cache: Profiles | null | undefined;
export function loadProfiles(): Profiles | null {
  if (cache === undefined) {
    try { cache = JSON.parse(fs.readFileSync(new URL('./shopify-profiles.json', import.meta.url), 'utf8')) as Profiles; } catch { cache = null; }
  }
  return cache;
}

/** The store family a garment style belongs to ("Premium Oversized Crewneck" -> crewneck). */
export function profileForStyle(style: string) {
  const p = loadProfiles();
  const key = p?.styles[style];
  const family = key ? p?.families[key] : undefined;
  return key && family ? { key, family } : null;
}
