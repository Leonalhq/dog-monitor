import type { DogListing, SourceConfig } from "../types.js";
import { deduplicateListings, type SourceAdapter } from "./adapter.js";

interface OntarioSpcaAnimal {
  animalId?: string;
  name?: string;
  slug?: string;
  ageMonths?: string;
  ageYears?: string;
  ageWeeks?: string;
  breed?: string;
  photos?: string[];
  status?: string;
  species?: string;
  location?: string;
  sex?: string;
}

interface OntarioSpcaPayload {
  data: OntarioSpcaAnimal[];
  totalPages: number;
}

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function formatAge(animal: OntarioSpcaAnimal): string | undefined {
  const parts = [
    [animal.ageYears, "year"],
    [animal.ageMonths, "month"],
    [animal.ageWeeks, "week"]
  ].flatMap(([value, unit]) => Number(value) > 0 ? [`${value} ${unit}${value === "1" ? "" : "s"}`] : []);
  return parts.join(", ") || undefined;
}

export function parseOntarioSpcaAnimals(
  animals: OntarioSpcaAnimal[],
  source: SourceConfig,
  location: string
): DogListing[] {
  const baseUrl = new URL(source.url).origin;
  return deduplicateListings(animals.flatMap((animal) => {
    if (
      animal.species?.toLowerCase() !== "dog"
      || animal.location?.toLowerCase() !== location.toLowerCase()
      || !animal.animalId || !animal.name || !animal.slug
    ) return [];
    const age = formatAge(animal);
    return [{
      sourceId: source.id,
      externalId: animal.animalId,
      name: animal.name,
      profileUrl: new URL(`/adopt/${animal.slug}`, baseUrl).toString(),
      ...(animal.photos?.[0] ? { imageUrl: animal.photos[0] } : {}),
      ...(animal.breed ? { breed: animal.breed } : {}),
      ...(age ? { age } : {}),
      ...(animal.sex ? { sex: animal.sex } : {}),
      location: animal.location,
      ...(animal.status ? { status: animal.status } : {})
    } satisfies DogListing];
  }));
}

export class OntarioSpcaAdapter implements SourceAdapter {
  async fetch(source: SourceConfig): Promise<DogListing[]> {
    const sourceUrl = new URL(source.url);
    const location = sourceUrl.searchParams.get("location");
    if (!location) throw new Error(`Ontario SPCA source ${source.id} requires a location query parameter`);

    const fetchPage = async (pageNumber: number): Promise<OntarioSpcaPayload> => {
      const apiUrl = new URL("/wp-json/ontariospca/v1/animals", sourceUrl);
      apiUrl.searchParams.set("location", location);
      apiUrl.searchParams.set("order", "default");
      apiUrl.searchParams.set("pageNumber", String(pageNumber));
      const response = await fetch(apiUrl, {
        headers: { accept: "application/json, text/plain, */*", referer: source.url, "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`Ontario SPCA returned HTTP ${response.status}`);
      const payload = await response.json() as Partial<OntarioSpcaPayload>;
      if (!Array.isArray(payload.data) || !Number.isInteger(payload.totalPages) || payload.totalPages! < 1) {
        throw new Error("Ontario SPCA returned an invalid payload");
      }
      return payload as OntarioSpcaPayload;
    };

    const firstPage = await fetchPage(1);
    const remainingPages = await Promise.all(
      Array.from({ length: firstPage.totalPages - 1 }, (_value, index) => fetchPage(index + 2))
    );
    return parseOntarioSpcaAnimals(
      [firstPage, ...remainingPages].flatMap((page) => page.data),
      source,
      location
    );
  }
}
