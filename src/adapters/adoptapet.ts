import type { Frame } from "playwright";
import type { BrowserPool } from "../lib/browser-pool.js";
import type { DogListing, SourceConfig } from "../types.js";
import { deduplicateListings, type SourceAdapter } from "./adapter.js";

interface AdoptAPetCard {
  href: string;
  name: string;
  imageUrl?: string;
  breed?: string;
  age?: string;
  sex?: string;
  text: string;
}

async function listingsFromFrame(frame: Frame, source: SourceConfig): Promise<DogListing[]> {
  const cards = await frame.locator("a[href*='adoptapet.com/pet/'], a[href*='/pet/']").evaluateAll((anchors) =>
    anchors.map((anchor) => {
      const link = anchor as HTMLAnchorElement;
      const container = link.closest("article, li, tr, [class*='card'], [class*='pet']") ?? link.parentElement ?? link;
      const image = container.querySelector("img") as HTMLImageElement | null;
      const heading = container.querySelector("h1, h2, h3, h4, [class*='name']");
      const cells = [...container.querySelectorAll("td")].map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() || "");
      return {
        href: link.href,
        name: heading?.textContent?.trim() || cells[1] || link.textContent?.trim() || image?.alt?.replace(/^Adopt A Pet ::\s*|\s*-.*$/g, "").trim() || "",
        imageUrl: image?.src || undefined,
        breed: cells[2] || undefined,
        age: cells[3] || undefined,
        sex: cells[4] || undefined,
        text: container.textContent?.replace(/\s+/g, " ").trim() || ""
      };
    })
  ) as AdoptAPetCard[];

  return cards.flatMap((card) => {
    const externalId = card.href.match(/\/pet\/(\d+)/)?.[1];
    if (!externalId || !card.name) return [];
    const sex = card.sex ?? card.text.match(/\b(Female|Male)\b/i)?.[1];
    return [{
      sourceId: source.id,
      externalId,
      name: card.name,
      profileUrl: card.href,
      ...(card.imageUrl ? { imageUrl: card.imageUrl } : {}),
      ...(card.breed ? { breed: card.breed } : {}),
      ...(card.age ? { age: card.age } : {}),
      ...(sex ? { sex } : {}),
      rawData: { text: card.text }
    } satisfies DogListing];
  });
}

export class AdoptAPetAdapter implements SourceAdapter {
  constructor(private readonly browsers: BrowserPool) {}

  async fetch(source: SourceConfig): Promise<DogListing[]> {
    return this.browsers.withPage(async (page) => {
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(3_000);
      const listings = (await Promise.all(page.frames().map((frame) => listingsFromFrame(frame, source)))).flat();
      return deduplicateListings(listings);
    });
  }
}
