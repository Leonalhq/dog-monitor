import { describe, expect, it } from "vitest";
import { parseGoldenRescueListings } from "../src/adapters/goldenrescue.js";
import type { SourceConfig } from "../src/types.js";

const source: SourceConfig = {
  id: "golden-rescue",
  name: "Golden Rescue",
  enabled: true,
  adapter: "goldenrescue",
  url: "https://goldenrescue.ca/our-goldens/adopt-3/?status=available#adoptions",
  schedule: "22 * * * *",
  allowEmpty: false,
  notifyRelisted: false,
  filters: {}
};

describe("parseGoldenRescueListings", () => {
  it("extracts dog IDs, names, links, and images", () => {
    const listings = parseGoldenRescueListings(`
      <a class="adoption featured" href="/goldens/5192-arlo/">
        <article><img src="/uploads/arlo.jpg"><h3>#5192 Arlo</h3></article>
      </a>
      <div id="adoptions">
        <a class="adoption" href="/goldens/5183-sunny-5184-tito/">
          <article><img src="/uploads/sunny-tito.jpg"><h3>#5183 Sunny &amp; #5184 Tito</h3></article>
        </a>
      </div>
    `, source);

    expect(listings).toEqual([
      expect.objectContaining({ externalId: "5192", name: "Arlo" }),
      expect.objectContaining({ externalId: "5183+5184", name: "Sunny & Tito" })
    ]);
  });
});
