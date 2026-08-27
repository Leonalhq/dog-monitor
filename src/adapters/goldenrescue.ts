import * as cheerio from "cheerio";
import type { BrowserPool } from "../lib/browser-pool.js";
import type { DogListing, SourceConfig } from "../types.js";
import { deduplicateListings, type SourceAdapter } from "./adapter.js";

const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

export function parseGoldenRescueListings(html: string, source: SourceConfig): DogListing[] {
  const $ = cheerio.load(html);
  const listings: DogListing[] = [];

  $("a.adoption").each((_index, element) => {
    const card = $(element);
    const heading = clean(card.find("h3").first().text());
    const href = card.attr("href");
    if (!heading || !href) return;
    const profileUrl = new URL(href, source.url).toString();
    const ids = [...heading.matchAll(/#(\d+)/g)].map((match) => match[1]);
    const name = clean(heading.replace(/#\d+\s*/g, ""));
    if (!name || ids.length === 0) return;

    const imageSrc = card.find("img").first().attr("src");
    listings.push({
      sourceId: source.id,
      externalId: ids.join("+"),
      name,
      profileUrl,
      ...(imageSrc ? { imageUrl: new URL(imageSrc, source.url).toString() } : {}),
      status: "Available"
    });
  });

  return deduplicateListings(listings);
}

export class GoldenRescueAdapter implements SourceAdapter {
  constructor(private readonly browsers: BrowserPool) {}

  async fetch(source: SourceConfig): Promise<DogListing[]> {
    return this.browsers.withPage(async (page) => {
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.locator("a.adoption").first().waitFor({ state: "attached", timeout: 15_000 });
      return parseGoldenRescueListings(await page.content(), source);
    });
  }
}
