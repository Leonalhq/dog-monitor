import { describe, expect, it } from "vitest";
import { parseOntarioSpcaAnimals } from "../src/adapters/ontariospca.js";
import type { SourceConfig } from "../src/types.js";

const source: SourceConfig = {
  id: "ontario-spca-orangeville",
  name: "Ontario SPCA - Orangeville",
  enabled: true,
  adapter: "ontariospca",
  url: "https://ontariospca.ca/adopt/?location=orangeville",
  schedule: "27 * * * *",
  allowEmpty: true,
  notifyRelisted: false,
  filters: {}
};

describe("parseOntarioSpcaAnimals", () => {
  it("keeps only Orangeville dogs and maps their details", () => {
    const listings = parseOntarioSpcaAnimals([
      { animalId: "262162", name: "Faith", slug: "faith-262162", species: "Dog", location: "Orangeville", breed: "Labrador", ageYears: "10", sex: "Female", status: "Available", photos: ["https://images.test/faith.jpg"] },
      { animalId: "264733", name: "Tiger", slug: "tiger-264733", species: "Cat", location: "Orangeville" },
      { animalId: "999", name: "Elsewhere", slug: "elsewhere-999", species: "Dog", location: "Barrie" }
    ], source, "orangeville");

    expect(listings).toEqual([expect.objectContaining({
      externalId: "262162",
      name: "Faith",
      profileUrl: "https://ontariospca.ca/adopt/faith-262162",
      imageUrl: "https://images.test/faith.jpg",
      breed: "Labrador",
      age: "10 years",
      sex: "Female",
      location: "Orangeville",
      status: "Available"
    })]);
  });
});
