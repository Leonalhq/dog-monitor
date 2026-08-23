import { describe, expect, it } from "vitest";
import { extractReadableText } from "../src/services/analysis.js";

describe("extractReadableText", () => {
  it("keeps profile evidence and removes page chrome", () => {
    const text = extractReadableText(`
      <html><head><meta name="description" content="Meet Nora"></head><body>
      <nav>Navigation noise</nav><main><h1>Nora</h1><p>Likes calm walks.</p></main>
      <script>secretNoise()</script></body></html>
    `);
    expect(text).toContain("Meet Nora Nora Likes calm walks.");
    expect(text).not.toContain("Navigation noise");
    expect(text).not.toContain("secretNoise");
  });
});
