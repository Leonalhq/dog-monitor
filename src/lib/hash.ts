import { createHash } from "node:crypto";
import type { DogListing } from "../types.js";

export function listingHash(listing: DogListing): string {
  const stable = {
    name: listing.name,
    profileUrl: listing.profileUrl,
    imageUrl: listing.imageUrl ?? null,
    breed: listing.breed ?? null,
    age: listing.age ?? null,
    sex: listing.sex ?? null,
    location: listing.location ?? null,
    status: listing.status ?? null,
    description: listing.description ?? null
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
