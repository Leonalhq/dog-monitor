import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { listingHash } from "../lib/hash.js";
import type { DogListing, PersistedDiscovery, SourceConfig } from "../types.js";
import { schemaSql } from "./schema.js";

interface DogRow {
  id: number;
  content_hash: string;
  disappeared_at: string | null;
}

export interface HealthRow {
  id: string;
  name: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

export interface DigestRow {
  source_name: string;
  name: string;
  profile_url: string;
  image_url: string | null;
  sent_at: string;
}

export interface StoredDog {
  id: number;
  source_id: string;
  source_name: string;
  name: string;
  profile_url: string;
  image_url: string | null;
  breed: string | null;
  age: string | null;
  sex: string | null;
  location: string | null;
  status: string | null;
  description: string | null;
  raw_data_json: string | null;
  interest: number | null;
  analysis_json: string | null;
  analysis_content_hash: string | null;
}

export class Database {
  readonly sqlite: BetterSqlite3.Database;

  constructor(databasePath = process.env.DATABASE_PATH ?? "./data/dog-monitor.sqlite") {
    const resolvedPath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.sqlite = new BetterSqlite3(resolvedPath);
    this.sqlite.exec(schemaSql);
    this.migrate();
  }

  private migrate(): void {
    const columns = (table: string): Set<string> => new Set(
      (this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name)
    );
    const dogColumns = columns("dogs");
    if (!dogColumns.has("interest")) this.sqlite.exec("ALTER TABLE dogs ADD COLUMN interest INTEGER CHECK(interest IN (0, 1))");
    if (!dogColumns.has("analysis_json")) this.sqlite.exec("ALTER TABLE dogs ADD COLUMN analysis_json TEXT");
    if (!dogColumns.has("analysis_content_hash")) this.sqlite.exec("ALTER TABLE dogs ADD COLUMN analysis_content_hash TEXT");
    if (!columns("notifications").has("hidden_at")) {
      this.sqlite.exec("ALTER TABLE notifications ADD COLUMN hidden_at TEXT");
    }
  }

  close(): void {
    this.sqlite.close();
  }

  syncSources(sources: SourceConfig[]): void {
    const statement = this.sqlite.prepare(`
      INSERT INTO sources (id, name, adapter, url, enabled)
      VALUES (@id, @name, @adapter, @url, @enabled)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        adapter = excluded.adapter,
        url = excluded.url,
        enabled = excluded.enabled
    `);
    const sync = this.sqlite.transaction((items: SourceConfig[]) => {
      for (const source of items) {
        statement.run({
          id: source.id,
          name: source.name,
          adapter: source.adapter,
          url: source.url,
          enabled: source.enabled ? 1 : 0
        });
      }
    });
    sync(sources);
  }

  isSeeded(sourceId: string): boolean {
    const row = this.sqlite.prepare("SELECT seeded_at FROM sources WHERE id = ?").get(sourceId) as
      | { seeded_at: string | null }
      | undefined;
    return row?.seeded_at != null;
  }

  markRunStarted(sourceId: string, timestamp: string): void {
    this.sqlite.prepare("UPDATE sources SET last_started_at = ? WHERE id = ?").run(timestamp, sourceId);
  }

  markRunSuccess(sourceId: string, timestamp: string): void {
    this.sqlite.prepare(`
      UPDATE sources
      SET seeded_at = COALESCE(seeded_at, @timestamp),
          last_success_at = @timestamp,
          last_error = NULL,
          consecutive_failures = 0
      WHERE id = @sourceId
    `).run({ sourceId, timestamp });
  }

  markRunFailure(sourceId: string, timestamp: string, error: string): void {
    this.sqlite.prepare(`
      UPDATE sources
      SET last_error_at = @timestamp,
          last_error = @error,
          consecutive_failures = consecutive_failures + 1
      WHERE id = @sourceId
    `).run({ sourceId, timestamp, error: error.slice(0, 2_000) });
  }

  persistListings(sourceId: string, listings: DogListing[], observedAt: string): PersistedDiscovery[] {
    const findDog = this.sqlite.prepare(
      "SELECT id, content_hash, disappeared_at FROM dogs WHERE source_id = ? AND external_id = ?"
    );
    const insertDog = this.sqlite.prepare(`
      INSERT INTO dogs (
        source_id, external_id, name, profile_url, image_url, breed, age, sex,
        location, status, description, content_hash, first_seen_at, last_seen_at, raw_data_json
      ) VALUES (
        @sourceId, @externalId, @name, @profileUrl, @imageUrl, @breed, @age, @sex,
        @location, @status, @description, @contentHash, @observedAt, @observedAt, @rawDataJson
      )
    `);
    const updateDog = this.sqlite.prepare(`
      UPDATE dogs SET
        name = @name,
        profile_url = @profileUrl,
        image_url = @imageUrl,
        breed = @breed,
        age = @age,
        sex = @sex,
        location = @location,
        status = @status,
        description = @description,
        content_hash = @contentHash,
        last_seen_at = @observedAt,
        disappeared_at = NULL,
        raw_data_json = @rawDataJson
      WHERE id = @id
    `);
    const insertObservation = this.sqlite.prepare(`
      INSERT INTO observations (dog_id, observed_at, content_hash, status)
      VALUES (?, ?, ?, ?)
    `);

    const persist = this.sqlite.transaction(() => {
      const discoveries: PersistedDiscovery[] = [];
      const seenIds: number[] = [];

      for (const listing of listings) {
        const contentHash = listingHash(listing);
        const existing = findDog.get(sourceId, listing.externalId) as DogRow | undefined;
        const params = {
          sourceId,
          externalId: listing.externalId,
          name: listing.name,
          profileUrl: listing.profileUrl,
          imageUrl: listing.imageUrl ?? null,
          breed: listing.breed ?? null,
          age: listing.age ?? null,
          sex: listing.sex ?? null,
          location: listing.location ?? null,
          status: listing.status ?? null,
          description: listing.description ?? null,
          contentHash,
          observedAt,
          rawDataJson: listing.rawData === undefined ? null : JSON.stringify(listing.rawData)
        };

        let dogId: number;
        let kind: PersistedDiscovery["kind"];
        let changed: boolean;
        if (!existing) {
          dogId = Number(insertDog.run(params).lastInsertRowid);
          kind = "new";
          changed = true;
        } else {
          dogId = existing.id;
          kind = existing.disappeared_at ? "relisted" : "existing";
          changed = existing.content_hash !== contentHash;
          updateDog.run({ ...params, id: dogId });
        }

        insertObservation.run(dogId, observedAt, contentHash, listing.status ?? null);
        seenIds.push(dogId);
        discoveries.push({ dogId, kind, listing, changed });
      }

      if (seenIds.length === 0) {
        this.sqlite.prepare(`
          UPDATE dogs SET disappeared_at = COALESCE(disappeared_at, ?)
          WHERE source_id = ? AND disappeared_at IS NULL
        `).run(observedAt, sourceId);
      } else {
        const placeholders = seenIds.map(() => "?").join(",");
        this.sqlite.prepare(`
          UPDATE dogs SET disappeared_at = COALESCE(disappeared_at, ?)
          WHERE source_id = ? AND disappeared_at IS NULL AND id NOT IN (${placeholders})
        `).run(observedAt, sourceId, ...seenIds);
      }

      return discoveries;
    });

    return persist();
  }

  shouldSendNotification(dogId: number, notificationType: string, now: string): boolean {
    const existing = this.sqlite.prepare(`
      SELECT status FROM notifications WHERE dog_id = ? AND notification_type = ?
    `).get(dogId, notificationType) as { status: string } | undefined;
    if (existing?.status === "sent") return false;

    this.sqlite.prepare(`
      INSERT INTO notifications (dog_id, notification_type, status, created_at)
      VALUES (?, ?, 'pending', ?)
      ON CONFLICT(dog_id, notification_type) DO UPDATE SET status = 'pending'
    `).run(dogId, notificationType, now);
    return true;
  }

  markNotificationSent(dogId: number, notificationType: string, sentAt: string, messageId?: string): void {
    this.sqlite.prepare(`
      UPDATE notifications
      SET status = 'sent', attempts = attempts + 1, sent_at = ?, discord_message_id = ?, last_error = NULL
      WHERE dog_id = ? AND notification_type = ?
    `).run(sentAt, messageId ?? null, dogId, notificationType);
  }

  markNotificationFailed(dogId: number, notificationType: string, error: string): void {
    this.sqlite.prepare(`
      UPDATE notifications
      SET status = 'failed', attempts = attempts + 1, last_error = ?
      WHERE dog_id = ? AND notification_type = ?
    `).run(error.slice(0, 2_000), dogId, notificationType);
  }

  getDog(dogId: number): StoredDog | undefined {
    return this.sqlite.prepare(`
      SELECT d.*, s.name AS source_name
      FROM dogs d JOIN sources s ON s.id = d.source_id
      WHERE d.id = ?
    `).get(dogId) as StoredDog | undefined;
  }

  saveAnalysis(dogId: number, contentHash: string, analysisJson: string): void {
    this.sqlite.prepare(`
      UPDATE dogs SET analysis_content_hash = ?, analysis_json = ? WHERE id = ?
    `).run(contentHash, analysisJson, dogId);
  }

  setInterest(dogId: number, interested: boolean): void {
    this.sqlite.prepare("UPDATE dogs SET interest = ? WHERE id = ?").run(interested ? 1 : 0, dogId);
  }

  markNotificationHidden(dogId: number, messageId: string, hiddenAt: string): void {
    this.sqlite.prepare(`
      UPDATE notifications SET hidden_at = ?
      WHERE dog_id = ? AND discord_message_id = ?
    `).run(hiddenAt, dogId, messageId);
  }

  getDigestSince(since: string): DigestRow[] {
    return this.sqlite.prepare(`
      SELECT s.name AS source_name, d.name, d.profile_url, d.image_url, n.sent_at
      FROM notifications n
      JOIN dogs d ON d.id = n.dog_id
      JOIN sources s ON s.id = d.source_id
      WHERE n.status = 'sent' AND n.notification_type IN ('new', 'relisted') AND n.sent_at >= ?
      ORDER BY n.sent_at DESC
    `).all(since) as DigestRow[];
  }

  getHealth(): HealthRow[] {
    return this.sqlite.prepare(`
      SELECT id, name, last_success_at, last_error_at, last_error, consecutive_failures
      FROM sources WHERE enabled = 1 ORDER BY name
    `).all() as HealthRow[];
  }
}
