import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type MessageCreateOptions
} from "discord.js";
import type { Database, DigestRow, HealthRow } from "../db/database.js";
import { logger } from "../lib/logger.js";
import type { DogListing } from "../types.js";
import { DogAnalyzer, formatAnalysis } from "./analysis.js";
import type { NotificationResult, Notifier } from "./notifier.js";

const truncate = (value: string, maximum: number): string =>
  value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;

const detailLine = (label: string, value?: string): string => `**${label}:** ${value || "Unknown"}`;

export class DiscordBotNotifier implements Notifier {
  private readonly client = new Client({ intents: [GatewayIntentBits.Guilds] });
  private readonly analyzer: DogAnalyzer;
  private started = false;

  constructor(
    private readonly database: Database,
    private readonly token = process.env.DISCORD_BOT_TOKEN,
    private readonly channelId = process.env.DISCORD_CHANNEL_ID,
    private readonly ownerUserId = process.env.DISCORD_OWNER_USER_ID
  ) {
    this.analyzer = new DogAnalyzer(database);
    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isButton()) return;
      void this.handleButton(interaction).catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(`操作失败：${truncate(message, 1_800)}`).catch(() => undefined);
        } else {
          await interaction.reply({ content: `操作失败：${truncate(message, 1_800)}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
      });
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!this.token || !this.channelId) throw new Error("DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID are required");
    this.started = true;
    await this.client.login(this.token);
    logger.info({ bot: this.client.user?.tag }, "Discord bot is online");
  }

  isReady(): boolean {
    return this.client.isReady();
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }

  private async send(payload: MessageCreateOptions): Promise<NotificationResult> {
    await this.start();
    const channel = await this.client.channels.fetch(this.channelId!);
    if (!channel?.isSendable()) throw new Error("DISCORD_CHANNEL_ID is not a sendable channel");
    const message = await channel.send(payload);
    return { messageId: message.id };
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (this.ownerUserId && interaction.user.id !== this.ownerUserId) {
      await interaction.reply({ content: "这个按钮只允许 monitor owner 使用。", flags: MessageFlags.Ephemeral });
      return;
    }
    const match = interaction.customId.match(/^dog:(analyze|interest|hide):(\d+)$/);
    if (!match) return;
    const action = match[1];
    const dogId = Number(match[2]);

    if (action === "analyze") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await this.analyzer.analyze(dogId);
      await interaction.editReply(formatAnalysis(result.analysis, result.cached));
      return;
    }
    if (action === "interest") {
      this.database.setInterest(dogId, true);
      await interaction.reply({ content: "⭐ 已记录为感兴趣。", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();
    this.database.setInterest(dogId, false);
    this.database.markNotificationHidden(dogId, interaction.message.id, new Date().toISOString());
    await interaction.message.delete();
  }

  sendDog(listing: DogListing, sourceName: string, kind: "new" | "relisted", dogId: number): Promise<NotificationResult> {
    const description = [
      detailLine("Breed", listing.breed),
      detailLine("Age", listing.age),
      detailLine("Sex", listing.sex),
      detailLine("Location", listing.location),
      detailLine("Status", listing.status)
    ].join("\n");
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`dog:analyze:${dogId}`).setLabel("解析").setEmoji("🔍").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`dog:interest:${dogId}`).setLabel("感兴趣").setEmoji("⭐").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`dog:hide:${dogId}`).setLabel("不感兴趣").setEmoji("🗑️").setStyle(ButtonStyle.Secondary)
    );
    return this.send({
      allowedMentions: { parse: [] },
      embeds: [{
        title: `${kind === "new" ? "🐶 New adoptable dog" : "↩️ Dog relisted"}: ${truncate(listing.name, 180)}`,
        url: listing.profileUrl,
        description: truncate(description, 4_000),
        color: kind === "new" ? 0x57F287 : 0xFEE75C,
        author: { name: truncate(sourceName, 250) },
        ...(listing.imageUrl ? { image: { url: listing.imageUrl } } : {}),
        footer: { text: `ID ${listing.externalId} · detected automatically` },
        timestamp: new Date().toISOString()
      }],
      components: [row]
    });
  }

  sendDailyDigest(rows: DigestRow[], health: HealthRow[]): Promise<NotificationResult> {
    const additions = rows.length === 0
      ? "No new dogs were sent in the last 24 hours."
      : rows.slice(0, 20).map((row) => `• [${row.name}](${row.profile_url}) — ${row.source_name}`).join("\n");
    const healthText = health.map((row) => row.consecutive_failures > 0
      ? `❌ ${row.name}: ${row.consecutive_failures} failure(s)`
      : `✅ ${row.name}: healthy`).join("\n");
    return this.send({ embeds: [{
      title: `Daily dog monitor report · ${rows.length} notification${rows.length === 1 ? "" : "s"}`,
      color: health.some((row) => row.consecutive_failures > 0) ? 0xED4245 : 0x5865F2,
      fields: [
        { name: "New or relisted dogs", value: truncate(additions, 1_024) },
        { name: "Source health", value: truncate(healthText || "No enabled sources", 1_024) }
      ],
      timestamp: new Date().toISOString()
    }] });
  }
}
