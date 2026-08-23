import type { DogListing } from "../types.js";
import type { DigestRow, HealthRow } from "../db/database.js";

export interface NotificationResult {
  messageId?: string;
}

export interface Notifier {
  sendDog(listing: DogListing, sourceName: string, kind: "new" | "relisted", dogId: number): Promise<NotificationResult>;
  sendDailyDigest(rows: DigestRow[], health: HealthRow[]): Promise<NotificationResult>;
}
