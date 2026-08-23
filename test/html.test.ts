import { describe, expect, it } from "vitest";
import { parseHtmlListings } from "../src/adapters/html.js";
import type { SourceConfig } from "../src/types.js";

const source: SourceConfig = {
  id: "simple",
  name: "Simple Rescue",
  enabled: true,
  adapter: "html",
  url: "https://example.test/dogs",
  schedule: "0 * * * *",
  allowEmpty: false,
  notifyRelisted: false,
  filters: {},
  selectors: {
    item: ".dog",
    name: ".name",
    link: "a",
    image: "img",
    breed: ".breed"
  }
};

describe("parseHtmlListings", () => {
  it("extracts stable links and resolves relative images", () => {
    const listings = parseHtmlListings(`
      <div class="dog"><a href="/dogs/nora"><span class="name"> Nora </span></a>
      <img data-src="/images/nora.jpg"><span class="breed">Shepherd mix</span></div>
    `, source);
    expect(listings).toEqual([expect.objectContaining({
      externalId: "https://example.test/dogs/nora",
      name: "Nora",
      profileUrl: "https://example.test/dogs/nora",
      imageUrl: "https://example.test/images/nora.jpg",
      breed: "Shepherd mix"
    })]);
  });
});
