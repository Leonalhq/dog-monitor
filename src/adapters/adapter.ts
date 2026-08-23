import type { DogListing, SourceConfig } from "../types.js";

export interface SourceAdapter {
  fetch(source: SourceConfig): Promise<DogListing[]>;
}

export function deduplicateListings(listings: DogListing[]): DogListing[] {
  return [...new Map(listings.map((listing) => [listing.externalId, listing])).values()];
}
