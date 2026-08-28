import * as cheerio from "cheerio";
import type { DogListing, SourceConfig } from "../types.js";
import { deduplicateListings, type SourceAdapter } from "./adapter.js";

interface ShopifyProduct {
  id?: number;
  title?: string;
  handle?: string;
  body_html?: string;
  product_type?: string;
  tags?: string[];
  variants?: Array<{ available?: boolean; option2?: string; option3?: string }>;
  images?: Array<{ src?: string }>;
}

const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

export function parseShopifyProducts(products: ShopifyProduct[], source: SourceConfig): DogListing[] {
  return deduplicateListings(products.flatMap((product) => {
    if (
      product.product_type !== "Adoptable Dog"
      || product.id == null || !product.title || !product.handle
    ) return [];
    const variant = product.variants?.[0];
    const description = product.body_html ? clean(cheerio.load(product.body_html).text()) : undefined;
    return [{
      sourceId: source.id,
      externalId: String(product.id),
      name: clean(product.title),
      profileUrl: new URL(`/products/${product.handle}`, source.url).toString(),
      ...(product.images?.[0]?.src ? { imageUrl: product.images[0].src } : {}),
      ...(variant?.option2 ? { age: variant.option2 } : {}),
      ...(variant?.option3 ? { sex: variant.option3 } : {}),
      status: product.variants?.some((item) => item.available) ? "Available" : "Unavailable",
      ...(description ? { description } : {})
    } satisfies DogListing];
  }));
}

export class ShopifyAdapter implements SourceAdapter {
  async fetch(source: SourceConfig): Promise<DogListing[]> {
    const sourceUrl = new URL(source.url);
    const endpoint = new URL(`${sourceUrl.pathname.replace(/\/$/, "")}/products.json`, sourceUrl.origin);
    const products: ShopifyProduct[] = [];

    for (let page = 1; page <= 20; page += 1) {
      endpoint.searchParams.set("limit", "250");
      endpoint.searchParams.set("page", String(page));
      const response = await fetch(endpoint, {
        headers: { accept: "application/json", "user-agent": "AdoptableDogMonitor/0.1" },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`Shopify returned HTTP ${response.status}`);
      const payload = await response.json() as { products?: ShopifyProduct[] };
      if (!Array.isArray(payload.products)) throw new Error("Shopify returned an invalid payload");
      products.push(...payload.products);
      if (payload.products.length < 250) return parseShopifyProducts(products, source);
    }

    throw new Error("Shopify collection exceeded the 5,000-product safety limit");
  }
}
