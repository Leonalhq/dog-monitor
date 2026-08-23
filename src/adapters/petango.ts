import * as cheerio from "cheerio";
import type { BrowserPool } from "../lib/browser-pool.js";
import { fetchText } from "../lib/http.js";
import type { DogListing, SourceConfig } from "../types.js";
import { deduplicateListings, type SourceAdapter } from "./adapter.js";

const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

function statusFrom(text: string): string {
  if (/\bpending\b/i.test(text)) return "Pending";
  if (/\badopted\b/i.test(text)) return "Adopted";
  return "Available";
}

function absoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function externalIdFrom(text: string, href: string): string | undefined {
  return href.match(/(?:animalID|id|PetID)=?(\d{6,})/i)?.[1]
    ?? href.match(/\b(\d{7,})\b/)?.[1]
    ?? text.match(/\b(\d{7,})\b/)?.[1];
}

function nameFrom(text: string, fallback?: string): string {
  const dogPattern = text.match(/(?:^|\b)Dog\s+(.+?)\s+(?:Female|Male|Unknown)\b/i)?.[1];
  if (dogPattern) return clean(dogPattern);
  if (fallback && clean(fallback)) return clean(fallback);
  const beforeSex = text.split(/\b(?:Female|Male|Unknown)\b/i)[0] ?? text;
  return clean(beforeSex.replace(/^(?:Kitchener|Stratford|Cambridge)\s+Dog\s+/i, ""));
}

export function parsePetangoHtml(html: string, source: SourceConfig, baseUrl = source.url): DogListing[] {
  const $ = cheerio.load(html);
  const listings: DogListing[] = [];

  $(".list-item").each((_index, element) => {
    const card = $(element);
    const externalId = clean(card.find(".list-animal-id").first().text());
    const name = clean(card.find(".list-animal-name").first().text());
    if (!externalId || !name) return;
    const rawHref = card.find(".list-animal-name a").first().attr("href") ?? "";
    const detailPath = rawHref.match(/poptastic\('([^']+)/i)?.[1];
    const profileUrl = absoluteUrl(detailPath, baseUrl) ?? source.publicUrl ?? source.url;
    const imageUrl = absoluteUrl(card.find("img.list-animal-photo").first().attr("src"), baseUrl);
    const rawSex = clean(card.find(".list-animal-sexSN").first().text());
    const sex = rawSex.split("/")[0];
    const breed = clean(card.find(".list-animal-breed").first().text());
    const age = clean(card.find(".list-animal-age").first().text());
    const status = statusFrom(`${name} ${card.text()}`);

    listings.push({
      sourceId: source.id,
      externalId,
      name,
      profileUrl,
      ...(imageUrl ? { imageUrl } : {}),
      ...(sex ? { sex } : {}),
      ...(breed ? { breed } : {}),
      ...(age ? { age } : {}),
      status,
      rawData: { text: clean(card.text()) }
    });
  });

  if (listings.length > 0) return deduplicateListings(listings);

  $(".resource-card--animal").each((_index, element) => {
    const card = $(element);
    const link = card.find("a[href*='petango.com']").first();
    const href = absoluteUrl(link.attr("href"), baseUrl);
    const name = clean(card.find(".resource-card__title").first().text());
    const externalId = externalIdFrom(card.text(), href ?? "");
    if (!href || !externalId || !name) return;
    const image = card.find("img").first();
    const imageUrl = absoluteUrl(image.attr("src") ?? image.attr("data-src"), baseUrl);
    const location = clean(card.find(".resource-card__location").first().text());
    const description = card.find(".resource-card__desc").first();
    const descriptionParts = (description.html() ?? "")
      .split(/<br\s*\/?>/i)
      .map((part) => clean(cheerio.load(part).text()))
      .filter(Boolean);
    const sex = descriptionParts[0];
    const breed = descriptionParts[1];
    const age = descriptionParts[2];

    listings.push({
      sourceId: source.id,
      externalId,
      name,
      profileUrl: href,
      ...(imageUrl ? { imageUrl } : {}),
      ...(sex ? { sex } : {}),
      ...(breed ? { breed } : {}),
      ...(age ? { age } : {}),
      ...(location ? { location } : {}),
      status: statusFrom(card.text()),
      rawData: { text: clean(card.text()) }
    });
  });

  if (listings.length > 0) return deduplicateListings(listings);

  $("a").each((_index, element) => {
    const anchor = $(element);
    const href = absoluteUrl(anchor.attr("href"), baseUrl);
    if (!href || !/petango\.com|AdoptableAnimalDetails/i.test(href)) return;

    let container = anchor.parent();
    for (let depth = 0; depth < 4 && container.length; depth += 1) {
      if (container.find("img").length || /Female|Male|Unknown/i.test(container.text())) break;
      container = container.parent();
    }

    const text = clean(container.text() || anchor.text());
    const externalId = externalIdFrom(text, href);
    if (!externalId) return;
    const explicitName = container.find("[class*='name'], [data-testid*='name']").first().text()
      || anchor.attr("title")
      || anchor.find("img").first().attr("alt");
    const name = nameFrom(text, explicitName);
    if (!name || /^view|details$/i.test(name)) return;

    const image = container.find("img").first();
    const imageUrl = absoluteUrl(
      image.attr("src") ?? image.attr("data-src") ?? image.attr("data-lazy-src"),
      baseUrl
    );
    const sex = text.match(/\b(Female|Male|Unknown)\b/i)?.[1];
    const age = text.match(/\b(\d+\s+(?:year|month|week)s?(?:\s+\d+\s+months?)?)\b/i)?.[1];
    const location = text.match(/^\s*(Kitchener|Stratford|Cambridge)\s+Dog\b/i)?.[1];

    listings.push({
      sourceId: source.id,
      externalId,
      name,
      profileUrl: href,
      ...(imageUrl ? { imageUrl } : {}),
      ...(sex ? { sex } : {}),
      ...(age ? { age } : {}),
      ...(location ? { location } : {}),
      status: statusFrom(text),
      rawData: { text }
    });
  });

  return deduplicateListings(listings);
}

export class PetangoAdapter implements SourceAdapter {
  constructor(private readonly browsers: BrowserPool) {}

  async fetch(source: SourceConfig): Promise<DogListing[]> {
    let mainHtml: string;
    try {
      mainHtml = await fetchText(source.url);
    } catch {
      mainHtml = await this.browsers.withPage(async (page) => {
        await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        return page.content();
      });
    }

    const $ = cheerio.load(mainHtml);
    const iframeSource = $("iframe[src*='petango.com']").first().attr("src");
    if (!iframeSource) {
      const direct = parsePetangoHtml(mainHtml, source);
      if (direct.length > 0) return direct;
      return this.parseRendered(source, source.url);
    }

    const iframeUrl = new URL(iframeSource, source.url).toString();
    try {
      const iframeHtml = await fetchText(iframeUrl);
      const parsed = parsePetangoHtml(iframeHtml, source, iframeUrl);
      if (parsed.length > 0) return parsed;
    } catch {
      // Browser fallback below handles JavaScript and bot protection.
    }
    return this.parseRendered(source, iframeUrl);
  }

  private async parseRendered(source: SourceConfig, url: string): Promise<DogListing[]> {
    return this.browsers.withPage(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2_000);
      const nestedIframe = await page.locator("iframe[src*='petango.com']").first()
        .getAttribute("src", { timeout: 2_000 })
        .catch(() => null);
      if (nestedIframe) {
        const iframeUrl = new URL(nestedIframe, url).toString();
        await page.goto(iframeUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(1_000);
        return parsePetangoHtml(await page.content(), source, iframeUrl);
      }
      return parsePetangoHtml(await page.content(), source, url);
    });
  }
}
