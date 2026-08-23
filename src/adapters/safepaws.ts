import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
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

function headingLines(heading: cheerio.Cheerio<AnyNode>): string[] {
  const copy = heading.clone();
  copy.find("br").replaceWith("\n");
  return copy.text().split("\n").map(clean).filter(Boolean);
}

function statusFrom(text: string): string {
  if (/\bpending\b/i.test(text)) return "Pending";
  if (/\badopted\b/i.test(text)) return "Adopted";
  return "Available";
}

function isCat(breed: string): boolean {
  return /\b(?:cat|kitten|domestic\s+short\s*hair|dsh)\b/i.test(breed);
}

export function parseSafePawsHtml(html: string, source: SourceConfig): DogListing[] {
  const $ = cheerio.load(html);
  const listings: DogListing[] = [];

  $("[data-mesh-id$='inlineContent-gridContainer']").each((_index, element) => {
    const item = $(element);
    const link = item.find("a[href*='/adoptable']").first();
    const profileUrl = absoluteUrl(link.attr("href"), source.url);
    const lines = headingLines(item.find("h2").first());
    if (!profileUrl || lines.length < 3) return;

    const [name, ageAndSex, breed, weight] = lines;
    if (!name || !ageAndSex || !breed || isCat(breed)) return;

    const sexMatch = ageAndSex.match(/\b(Female|Male)\b/i)?.[1];
    const sex = sexMatch ? sexMatch[0]!.toUpperCase() + sexMatch.slice(1).toLowerCase() : undefined;
    const age = clean(ageAndSex.replace(/\b(?:Female|Male)\b/i, "").replace(/[|,\-]+$/, "")) || undefined;
    const image = link.find("img").first();
    const srcset = image.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
    const imageUrl = absoluteUrl(image.attr("src") ?? image.attr("data-src") ?? srcset, source.url);
    const pathname = new URL(profileUrl).pathname.replace(/\/+$/, "") || "/";
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    listings.push({
      sourceId: source.id,
      externalId: `${pathname}#${normalizedName}`,
      name,
      profileUrl,
      ...(imageUrl ? { imageUrl } : {}),
      breed,
      ...(age ? { age } : {}),
      ...(sex ? { sex } : {}),
      status: statusFrom(item.text()),
      ...(weight ? { description: weight } : {}),
      rawData: { lines }
    });
  });

  return deduplicateListings(listings);
}

export class SafePawsAdapter implements SourceAdapter {
  async fetch(source: SourceConfig): Promise<DogListing[]> {
    return parseSafePawsHtml(await fetchText(source.url), source);
  }
}
