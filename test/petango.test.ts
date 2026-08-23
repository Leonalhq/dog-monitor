import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePetangoHtml } from "../src/adapters/petango.js";
import type { SourceConfig } from "../src/types.js";

const source: SourceConfig = {
  id: "kwsp",
  name: "KWSP",
  enabled: true,
  adapter: "petango",
  url: "https://example.test/dogs",
  schedule: "0 * * * *",
  allowEmpty: false,
  notifyRelisted: false,
  filters: {}
};

describe("parsePetangoHtml", () => {
  it("extracts stable IDs, names, images, sex, age, and location", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "test/fixtures/petango.html"), "utf8");
    const listings = parsePetangoHtml(html, source);

    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      externalId: "2000463387",
      name: "Flint",
      sex: "Male",
      age: "1 year 8 months",
      location: "Kitchener",
      imageUrl: "https://images.example/flint.jpg"
    });
    expect(listings[1]).toMatchObject({
      externalId: "2000464854",
      name: "Apollo",
      imageUrl: "https://example.test/apollo.jpg"
    });
  });

  it("parses the list-item structure used by Cambridge", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "test/fixtures/petango-cambridge.html"), "utf8");
    const listings = parsePetangoHtml(html, source, "https://ws.petango.com/webservices/adoptablesearch/list.aspx");

    expect(listings).toEqual([expect.objectContaining({
      externalId: "2000451653",
      name: "DR HUNTER SHEPHERD",
      sex: "Male",
      breed: "German Shepherd/Siberian Husky",
      age: "3 years 7 months",
      status: "Available",
      imageUrl: "https://images.example/hunter.jpg",
      profileUrl: "https://ws.petango.com/webservices/adoptablesearch/wsAdoptableAnimalDetails2.aspx?id=2000451653&PopUp=true"
    })]);
  });

  it("uses the visible title instead of the KWSP image alt text", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "test/fixtures/petango-kwsp.html"), "utf8");
    const listings = parsePetangoHtml(html, source);

    expect(listings).toEqual([expect.objectContaining({
      externalId: "2000387067",
      name: "Swift",
      sex: "Female",
      breed: "Mixed Breed, Large",
      age: "2 years 7 months",
      location: "Kitchener",
      imageUrl: "https://images.example/swift.jpg"
    })]);
  });
});
