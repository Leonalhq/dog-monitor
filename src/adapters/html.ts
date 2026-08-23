import * as cheerio from "cheerio";
import { fetchText } from "../lib/http.js";
import type { DogListing, SourceConfig } from "../types.js";
import { deduplicateListings, type SourceAdapter } from "./adapter.js";

const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

function absoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export function parseHtmlListings(html: string, source: SourceConfig): DogListing[] {
  const selectors = source.selectors;
  if (!selectors) throw new Error(`HTML source ${source.id} has no selectors`);
  const $ = cheerio.load(html);
  const listings: DogListing[] = [];

  $(selectors.item).each((_index, element) => {
    const item = $(element);
    const name = clean(item.find(selectors.name).first().text());
    const link = item.find(selectors.link).first();
    const profileUrl = absoluteUrl(link.attr("href"), source.url);
    if (!name || !profileUrl) return;

    const image = selectors.image ? item.find(selectors.image).first() : undefined;
    const srcset = image?.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
    const imageUrl = absoluteUrl(
      image?.attr("src") ?? image?.attr("data-src") ?? srcset,
      source.url
    );
    const text = (selector: string | undefined): string | undefined => {
      if (!selector) return undefined;
      return clean(item.find(selector).first().text()) || undefined;
    };
    const externalId = text(selectors.externalId) ?? profileUrl;
    const breed = text(selectors.breed);
    const age = text(selectors.age);
    const sex = text(selectors.sex);
    const description = text(selectors.description);

    listings.push({
      sourceId: source.id,
      externalId,
      name,
      profileUrl,
      ...(imageUrl ? { imageUrl } : {}),
      ...(breed ? { breed } : {}),
      ...(age ? { age } : {}),
      ...(sex ? { sex } : {}),
      ...(description ? { description } : {})
    });
  });

  return deduplicateListings(listings);
}

export class HtmlAdapter implements SourceAdapter {
  async fetch(source: SourceConfig): Promise<DogListing[]> {
    return parseHtmlListings(await fetchText(source.url), source);
  }
}
