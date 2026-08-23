import type { BrowserPool } from "../lib/browser-pool.js";
import type { DogListing, SourceConfig } from "../types.js";
import { deduplicateListings, type SourceAdapter } from "./adapter.js";

interface AdopetsCard {
  externalId: string;
  name: string;
  sex?: string;
  imageUrl?: string;
}

interface AdopetsPet {
  uuid: string;
  code: string;
  name: string;
  age_key?: string;
  sex_key?: string;
  status_key?: string;
  breed_primary_name?: string;
  breed_secondary_name?: string;
  picture?: string;
  description?: string;
  specie_name?: string;
}

interface AdopetsPayload {
  data?: { result?: Array<{ organization_pet?: AdopetsPet }> };
}

export class AdopetsAdapter implements SourceAdapter {
  constructor(private readonly browsers: BrowserPool) {}

  async fetch(source: SourceConfig): Promise<DogListing[]> {
    return this.browsers.withPage(async (page) => {
      const apiResponses: Array<Promise<AdopetsPayload | undefined>> = [];
      page.on("response", (response) => {
        if (response.url().includes("/adopter/pet/find")) {
          apiResponses.push(response.json().catch(() => undefined) as Promise<AdopetsPayload | undefined>);
        }
      });
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.getByRole("button", { name: "Species" }).click({ timeout: 15_000 });
      await page.getByRole("checkbox", { name: "Dog", exact: true }).check({ timeout: 10_000 });
      await page.getByRole("button", { name: "Apply", exact: true }).click({ timeout: 10_000 });
      await page.waitForTimeout(1_000);

      for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
        const loadMore = page.getByRole("button", { name: /load more pets/i });
        if (!(await loadMore.isVisible().catch(() => false))) break;
        await loadMore.click();
        await page.waitForTimeout(500);
      }

      const cards = await page.locator("[data-testid^='container-pet-card-']").evaluateAll((elements) =>
        elements.map((element) => {
          const name = element.querySelector("[data-testid='pet-name']")?.textContent?.trim() ?? "";
          const externalId = element.querySelector("[data-testid='pet-code']")?.textContent?.trim() ?? "";
          const sex = element.querySelector("[data-testid='pet-sex']")?.textContent?.trim() || undefined;
          const picture = element.querySelector<HTMLElement>("[data-testid='pet-picture']");
          const background = picture?.style.backgroundImage ?? "";
          const imageUrl = background.match(/url\(["']?(.*?)["']?\)/)?.[1];
          return { externalId, name, sex, imageUrl };
        })
      ) as AdopetsCard[];

      const payloads = await Promise.all(apiResponses);
      const pets = payloads.flatMap((payload) => payload?.data?.result ?? [])
        .map((item) => item.organization_pet)
        .filter((pet): pet is AdopetsPet => pet?.specie_name === "Dog" && Boolean(pet.uuid && pet.code && pet.name));
      if (pets.length > 0) {
        return deduplicateListings(pets.map((pet) => {
          const breeds = [...new Set([pet.breed_primary_name, pet.breed_secondary_name].filter(Boolean))];
          return {
            sourceId: source.id,
            externalId: pet.code,
            name: pet.name,
            profileUrl: `https://adopt.adopets.com/pet/${pet.uuid}`,
            ...(pet.picture ? { imageUrl: pet.picture } : {}),
            ...(pet.sex_key ? { sex: pet.sex_key[0] + pet.sex_key.slice(1).toLowerCase() } : {}),
            ...(pet.age_key ? { age: pet.age_key[0] + pet.age_key.slice(1).toLowerCase() } : {}),
            ...(breeds.length ? { breed: breeds.join(" / ") } : {}),
            ...(pet.status_key ? { status: pet.status_key[0] + pet.status_key.slice(1).toLowerCase() } : {}),
            ...(pet.description ? { description: pet.description } : {}),
            rawData: { uuid: pet.uuid, code: pet.code, specie: pet.specie_name }
          };
        }));
      }

      return deduplicateListings(cards.filter((card) => card.externalId && card.name).map((card) => ({
        sourceId: source.id,
        externalId: card.externalId,
        name: card.name,
        profileUrl: source.publicUrl ?? source.url,
        ...(card.sex ? { sex: card.sex } : {}),
        ...(card.imageUrl ? { imageUrl: card.imageUrl } : {}),
        rawData: card
      })));
    });
  }
}
