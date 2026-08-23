import { describe, expect, it } from "vitest";
import { parseSafePawsHtml } from "../src/adapters/safepaws.js";
import type { SourceConfig } from "../src/types.js";

const source: SourceConfig = {
  id: "safepaws",
  name: "Safe Paws Animal Rescue of Ontario",
  enabled: true,
  adapter: "safepaws",
  url: "https://www.safepawsanimalrescue.com/animalsforadoption",
  schedule: "57 * * * *",
  allowEmpty: false,
  notifyRelisted: false,
  filters: {}
};

function card(path: string, lines: string[], extra = ""): string {
  return `<section data-mesh-id="comp-inlineContent-gridContainer">
    <h2>${lines.join("<br>")}</h2>
    <a href="${path}"><img src="/images/${lines[0]}.jpg"></a>
    <p>${extra}</p>
  </section>`;
}

describe("Safe Paws parser", () => {
  it("keeps linked dogs, excludes cats, and parses card fields", () => {
    const html = card("/adoptable3", ["Max", "5 year old Male", "Corgi/Jack Russel", "17lbs"])
      + card("/adoptable1", ["Eva", "2 year old Female", "Domestic Shorthair", "8lbs"])
      + card("/adoptable5", ["Hunter", "1 year old male", "Husky Mix", "70lbs"], "Adoption pending");

    const dogs = parseSafePawsHtml(html, source);

    expect(dogs).toHaveLength(2);
    expect(dogs[0]).toMatchObject({
      externalId: "/adoptable3#max",
      name: "Max",
      profileUrl: "https://www.safepawsanimalrescue.com/adoptable3",
      imageUrl: "https://www.safepawsanimalrescue.com/images/Max.jpg",
      breed: "Corgi/Jack Russel",
      age: "5 year old",
      sex: "Male",
      status: "Available",
      description: "17lbs"
    });
    expect(dogs[1]).toMatchObject({ name: "Hunter", sex: "Male", status: "Pending" });
  });
});
