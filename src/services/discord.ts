import type { DigestRow, HealthRow } from "../db/database.js";
import type { DogListing } from "../types.js";
import type { NotificationResult, Notifier } from "./notifier.js";

interface DiscordResponse {
  id?: string;
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function detailLine(label: string, value?: string): string {
  return `**${label}:** ${value || "Unknown"}`;
}

export class DiscordNotifier implements Notifier {
  constructor(private readonly webhookUrl: string | undefined = process.env.DISCORD_WEBHOOK_URL) {}

  private async post(payload: unknown): Promise<NotificationResult> {
    if (!this.webhookUrl) {
      throw new Error("DISCORD_WEBHOOK_URL is not configured");
    }
    const url = new URL(this.webhookUrl);
    url.searchParams.set("wait", "true");
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      throw new Error(`Discord webhook returned HTTP ${response.status}: ${truncate(await response.text(), 500)}`);
    }
    const result = await response.json().catch(() => ({})) as DiscordResponse;
    return result.id ? { messageId: result.id } : {};
  }

  sendDog(listing: DogListing, sourceName: string, kind: "new" | "relisted", _dogId: number): Promise<NotificationResult> {
    const description = [
      detailLine("Breed", listing.breed),
      detailLine("Age", listing.age),
      detailLine("Sex", listing.sex),
      detailLine("Location", listing.location),
      detailLine("Status", listing.status)
    ].join("\n");

    return this.post({
      username: "Adoptable Dog Monitor",
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `${kind === "new" ? "🐶 New adoptable dog" : "↩️ Dog relisted"}: ${truncate(listing.name, 180)}`,
        url: listing.profileUrl,
        description: truncate(description, 4_000),
        color: kind === "new" ? 0x57F287 : 0xFEE75C,
        author: { name: truncate(sourceName, 250) },
        ...(listing.imageUrl ? { image: { url: listing.imageUrl } } : {}),
        footer: { text: `ID ${listing.externalId} · detected automatically` },
        timestamp: new Date().toISOString()
      }]
    });
  }

  sendDailyDigest(rows: DigestRow[], health: HealthRow[]): Promise<NotificationResult> {
    const additions = rows.length === 0
      ? "No new dogs were sent in the last 24 hours."
      : rows.slice(0, 20).map((row) => `• [${row.name}](${row.profile_url}) — ${row.source_name}`).join("\n");
    const healthText = health.map((row) => {
      if (row.consecutive_failures > 0) return `❌ ${row.name}: ${row.consecutive_failures} failure(s)`;
      return `✅ ${row.name}: healthy`;
    }).join("\n");

    return this.post({
      username: "Adoptable Dog Monitor",
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `Daily dog monitor report · ${rows.length} notification${rows.length === 1 ? "" : "s"}`,
        color: health.some((row) => row.consecutive_failures > 0) ? 0xED4245 : 0x5865F2,
        fields: [
          { name: "New or relisted dogs", value: truncate(additions, 1_024) },
          { name: "Source health", value: truncate(healthText || "No enabled sources", 1_024) }
        ],
        timestamp: new Date().toISOString()
      }]
    });
  }
}
