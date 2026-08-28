import { describe, expect, it } from "vitest";
import { parseShopifyProducts } from "../src/adapters/shopify.js";
import type { SourceConfig } from "../src/types.js";

const source: SourceConfig = {
  id: "hbspca",
  name: "Hamilton/Burlington SPCA",
  enabled: true,
  adapter: "shopify",
  url: "https://www.hbspca.shop/collections/adoptable-dogs",
  schedule: "42 * * * *",
  allowEmpty: true,
  notifyRelisted: false,
  filters: { includeStatuses: ["Available"] }
};

describe("parseShopifyProducts", () => {
  it("maps adoptable dogs and ignores unrelated products", () => {
    const listings = parseShopifyProducts([
      { id: 123, title: "Maverick", handle: "maverick", product_type: "Adoptable Dog", body_html: "<p>Friendly boy</p>", variants: [{ available: true, option2: "1 Year Old - 66LBS", option3: "Neutered Male" }], images: [{ src: "https://images.test/maverick.jpg" }] },
      { id: 456, title: "Donation", handle: "donation", product_type: "Donation" }
    ], source);

    expect(listings).toEqual([expect.objectContaining({
      externalId: "123",
      name: "Maverick",
      profileUrl: "https://www.hbspca.shop/products/maverick",
      imageUrl: "https://images.test/maverick.jpg",
      age: "1 Year Old - 66LBS",
      sex: "Neutered Male",
      status: "Available",
      description: "Friendly boy"
    })]);
  });
});
