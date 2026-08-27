import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceAdapter } from "../src/adapters/adapter.js";
import { Database } from "../src/db/database.js";
import { MonitorService } from "../src/services/monitor.js";
import type { Notifier } from "../src/services/notifier.js";
import type { DogListing, SourceConfig } from "../src/types.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    id: "test-source",
    name: "Test Rescue",
    enabled: true,
    adapter: "petango",
    url: "https://example.test/dogs",
    schedule: "0 * * * *",
    allowEmpty: false,
    notifyRelisted: false,
    filters: {},
    ...overrides
  };
}

function dog(externalId: string, name: string): DogListing {
  return {
    sourceId: "test-source",
    externalId,
    name,
    profileUrl: `https://example.test/dogs/${externalId}`,
    imageUrl: `https://images.example/${externalId}.jpg`,
    sex: "Female"
  };
}

function setup(initialListings: DogListing[]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dog-monitor-test-"));
  temporaryDirectories.push(directory);
  const database = new Database(path.join(directory, "test.sqlite"));
  const config = source();
  database.syncSources([config]);
  let listings = initialListings;
  const adapter: SourceAdapter = { fetch: async () => listings };
  const sent: DogListing[] = [];
  let nextSendError: Error | undefined;
  const notifier: Notifier = {
    sendDog: async (listing) => {
      if (nextSendError) {
        const error = nextSendError;
        nextSendError = undefined;
        throw error;
      }
      sent.push(listing);
      return { messageId: `message-${sent.length}` };
    },
    sendDailyDigest: async () => ({})
  };
  const monitor = new MonitorService(database, {
    petango: adapter,
    adopets: adapter,
    adoptapet: adapter,
    safepaws: adapter,
    goldenrescue: adapter,
    ontariospca: adapter,
    welcomedogkorea: adapter,
    html: adapter
  }, notifier);
  return {
    database, config, monitor, sent,
    setListings: (next: DogListing[]) => { listings = next; },
    failNextSend: () => { nextSendError = new Error("Discord offline"); }
  };
}

describe("MonitorService", () => {
  it("seeds existing dogs and only notifies a newly observed ID", async () => {
    const context = setup([dog("1000001", "Existing Dog")]);

    const first = await context.monitor.runSource(context.config);
    expect(first.seeded).toBe(true);
    expect(context.sent).toHaveLength(0);

    await context.monitor.runSource(context.config);
    expect(context.sent).toHaveLength(0);

    context.setListings([dog("1000001", "Existing Dog"), dog("1000002", "New Dog")]);
    await context.monitor.runSource(context.config);
    expect(context.sent).toHaveLength(1);
    expect(context.sent[0]).toMatchObject({
      externalId: "1000002",
      imageUrl: "https://images.example/1000002.jpg"
    });

    await context.monitor.runSource(context.config);
    expect(context.sent).toHaveLength(1);
    expect((context.database.sqlite.prepare("SELECT COUNT(*) AS count FROM dogs").get() as { count: number }).count).toBe(2);
    expect((context.database.sqlite.prepare("SELECT COUNT(*) AS count FROM observations").get() as { count: number }).count).toBe(6);
    context.database.close();
  });

  it("can distinguish a relisted dog without calling an LLM", async () => {
    const context = setup([dog("1000001", "Returning Dog")]);
    context.config.allowEmpty = true;
    context.config.notifyRelisted = true;
    await context.monitor.runSource(context.config);
    context.setListings([]);
    await context.monitor.runSource(context.config);
    context.setListings([dog("1000001", "Returning Dog")]);
    await context.monitor.runSource(context.config);

    expect(context.sent).toHaveLength(1);
    context.database.close();
  });

  it("stores a status change without sending another notification", async () => {
    const available = { ...dog("1000001", "Waiting Dog"), status: "Available" };
    const context = setup([available]);
    await context.monitor.runSource(context.config);

    context.setListings([{ ...available, status: "Pending" }]);
    await context.monitor.runSource(context.config);

    expect(context.sent).toHaveLength(0);
    expect(context.database.sqlite.prepare(
      "SELECT status FROM dogs WHERE source_id = ? AND external_id = ?"
    ).get("test-source", "1000001")).toEqual({ status: "Pending" });
    expect(context.database.sqlite.prepare(
      "SELECT status FROM observations WHERE dog_id = (SELECT id FROM dogs WHERE external_id = ?) ORDER BY id"
    ).all("1000001")).toEqual([{ status: "Available" }, { status: "Pending" }]);
    context.database.close();
  });

  it("retries a failed notification on the next source run", async () => {
    const existing = dog("1000001", "Existing Dog");
    const newcomer = dog("1000002", "Retry Dog");
    const context = setup([existing]);
    await context.monitor.runSource(context.config);

    context.setListings([existing, newcomer]);
    context.failNextSend();
    await context.monitor.runSource(context.config);
    expect(context.sent).toHaveLength(0);

    await context.monitor.runSource(context.config);
    expect(context.sent).toEqual([newcomer]);
    expect(context.database.sqlite.prepare(
      "SELECT status, attempts FROM notifications WHERE dog_id = (SELECT id FROM dogs WHERE external_id = ?)"
    ).get("1000002")).toEqual({ status: "sent", attempts: 2 });
    context.database.close();
  });
});
