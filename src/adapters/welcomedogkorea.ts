import * as cheerio from "cheerio";
import type { DogListing, SourceConfig } from "../types.js";
import { deduplicateListings, type SourceAdapter } from "./adapter.js";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

export function parseWelcomeDogKoreaPage(
  html: string,
  source: SourceConfig,
  expectedLocation: string,
  expectedSize: string
): { listings: DogListing[]; totalPages: number } {
  const $ = cheerio.load(html);
  const listings: DogListing[] = [];

  $("a.relative[href^='/dog/']").each((_index, element) => {
    const link = $(element);
    const card = link.closest("div.border");
    const href = link.attr("href");
    const externalId = href?.match(/^\/dog\/(\d+)/)?.[1];
    const name = clean(card.find("h3").first().text());
    const detail = (label: string): string | undefined => {
      const labelElement = card.find("span").filter((_i, span) => clean($(span).text()) === label).first();
      return clean(labelElement.next("span").text()) || undefined;
    };
    const location = detail("Location:");
    const size = detail("Size:");
    if (
      !href || !externalId || !name
      || location?.toLowerCase() !== expectedLocation.toLowerCase()
      || size?.toLowerCase() !== expectedSize.toLowerCase()
    ) return;

    const imageSrc = link.find("img").first().attr("src");
    const status = clean(link.children("div").last().text());
    const age = detail("Age:");
    const sex = detail("Gender:");
    listings.push({
      sourceId: source.id,
      externalId,
      name,
      profileUrl: new URL(href, source.url).toString(),
      ...(imageSrc ? { imageUrl: new URL(imageSrc, source.url).toString() } : {}),
      ...(age ? { age } : {}),
      ...(sex ? { sex: sex.charAt(0).toUpperCase() + sex.slice(1) } : {}),
      location,
      ...(status ? { status } : {}),
      rawData: { size }
    });
  });

  const pageNumbers = $("a[href*='/find-a-dog?']").map((_index, element) => {
    const href = $(element).attr("href");
    return Number(new URL(href ?? "", source.url).searchParams.get("page"));
  }).get().filter(Number.isInteger);
  return { listings: deduplicateListings(listings), totalPages: Math.max(1, ...pageNumbers) };
}

export class WelcomeDogKoreaAdapter implements SourceAdapter {
  async fetch(source: SourceConfig): Promise<DogListing[]> {
    const sourceUrl = new URL(source.url);
    const location = sourceUrl.searchParams.get("location");
    const size = sourceUrl.searchParams.get("size");
    if (!location || !size) throw new Error(`Welcome Dog Korea source ${source.id} requires location and size filters`);

    const fetchPage = async (page: number): Promise<string> => {
      const url = new URL(sourceUrl);
      url.searchParams.set("page", String(page));
      const response = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`Welcome Dog Korea returned HTTP ${response.status}`);
      return response.text();
    };

    const first = parseWelcomeDogKoreaPage(await fetchPage(1), source, location, size);
    const remaining = await Promise.all(
      Array.from({ length: first.totalPages - 1 }, async (_value, index) =>
        parseWelcomeDogKoreaPage(await fetchPage(index + 2), source, location, size).listings)
    );
    return deduplicateListings([first.listings, ...remaining].flat());
  }
}
