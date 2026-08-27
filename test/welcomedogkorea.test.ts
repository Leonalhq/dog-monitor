import { describe, expect, it } from "vitest";
import { parseWelcomeDogKoreaPage } from "../src/adapters/welcomedogkorea.js";
import type { SourceConfig } from "../src/types.js";

const source: SourceConfig = {
  id: "welcome-dog-korea-toronto-large",
  name: "Welcome Dog Korea - Toronto Large Dogs",
  enabled: true,
  adapter: "welcomedogkorea",
  url: "https://www.welcomedogkorea.org/find-a-dog?location=Toronto&size=large",
  schedule: "37 * * * *",
  allowEmpty: true,
  notifyRelisted: false,
  filters: {}
};

const card = (id: string, name: string, location: string, size: string): string => `
  <div class="border">
    <a class="relative" href="/dog/${id}"><div><img src="/dogs/${id}.jpg"></div><div>Available</div></a>
    <h3>${name}</h3>
    <div><span>Age:</span><span>About 4 years old</span></div>
    <div><span>Size:</span><span>${size}</span></div>
    <div><span>Gender:</span><span>male</span></div>
    <div><span>Location:</span><span>${location}</span></div>
  </div>`;

describe("parseWelcomeDogKoreaPage", () => {
  it("keeps only large Toronto dogs and extracts stable details", () => {
    const result = parseWelcomeDogKoreaPage(`
      ${card("1084", "Puni", "Toronto", "large")}
      ${card("999", "Small Dog", "Toronto", "small")}
      <a href="/find-a-dog?page=3&location=Toronto&size=large">3</a>
    `, source, "Toronto", "large");

    expect(result.totalPages).toBe(3);
    expect(result.listings).toEqual([expect.objectContaining({
      externalId: "1084",
      name: "Puni",
      profileUrl: "https://www.welcomedogkorea.org/dog/1084",
      imageUrl: "https://www.welcomedogkorea.org/dogs/1084.jpg",
      age: "About 4 years old",
      sex: "Male",
      location: "Toronto",
      status: "Available"
    })]);
  });
});
