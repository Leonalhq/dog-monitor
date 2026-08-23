import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAdminApp } from "../src/admin/app.js";
import { Database } from "../src/db/database.js";
import type { AppConfig, SourceConfig } from "../src/types.js";

const source: SourceConfig = {
  id: "test", name: "Test <Rescue>", enabled: true, adapter: "html", url: "https://example.test/dogs",
  schedule: "0 * * * *", allowEmpty: false, notifyRelisted: false, filters: {},
  selectors: { item: "article", name: "h2", link: "a" }
};
const config: AppConfig = { timezone: "America/Toronto", dailyDigestSchedule: "0 9 * * *", sources: [source] };

describe("operations dashboard", () => {
  it("renders source health and exposes a health endpoint", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dog-monitor-admin-"));
    const database = new Database(path.join(directory, "test.sqlite"));
    database.syncSources([source]);
    const app = createAdminApp(database, config, Date.now() - 5_000);

    const page = await app.request("/ops");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Test &lt;Rescue&gt;");
    expect(html).not.toContain("Test <Rescue>");
    const health = await app.request("/ops/api/health");
    expect(await health.json()).toMatchObject({ ok: true });

    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
