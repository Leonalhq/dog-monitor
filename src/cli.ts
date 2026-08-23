import "./lib/logger.js";
import { createAdapters } from "./adapters/index.js";
import { loadConfig } from "./config.js";
import { Database } from "./db/database.js";
import { BrowserPool } from "./lib/browser-pool.js";
import { logger } from "./lib/logger.js";
import { DiscordNotifier } from "./services/discord.js";
import { DiscordBotNotifier } from "./services/discord-bot.js";
import { MonitorService } from "./services/monitor.js";
import { Scheduler } from "./services/scheduler.js";

type Command = "serve" | "run-once" | "seed" | "digest" | "source:check";

async function main(): Promise<void> {
  const command = (process.argv[2] ?? "serve") as Command;
  if (!["serve", "run-once", "seed", "digest", "source:check"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const config = await loadConfig();
  const browsers = new BrowserPool();
  const adapters = createAdapters(browsers);

  if (command === "source:check") {
    const sourceId = process.argv[3];
    const source = config.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error(`Unknown source: ${sourceId ?? "(missing)"}`);
    const listings = await adapters[source.adapter].fetch(source);
    const uniqueIds = new Set(listings.map((listing) => listing.externalId));
    const uniqueProfiles = new Set(listings.map((listing) => listing.profileUrl));
    const invalid = listings.filter((listing) =>
      !listing.externalId || !listing.name || !URL.canParse(listing.profileUrl)
      || Boolean(listing.imageUrl && !URL.canParse(listing.imageUrl))
    );
    console.log(JSON.stringify({
      source: source.id,
      fetched: listings.length,
      uniqueIds: uniqueIds.size,
      uniqueProfiles: uniqueProfiles.size,
      images: listings.filter((listing) => listing.imageUrl).length,
      invalid: invalid.length,
      samples: listings.slice(0, 3).map(({ externalId, name, profileUrl, imageUrl }) => ({ externalId, name, profileUrl, imageUrl }))
    }, null, 2));
    await browsers.close();
    if (
      listings.length === 0 || invalid.length > 0
      || uniqueIds.size !== listings.length || uniqueProfiles.size !== listings.length
    ) process.exitCode = 1;
    return;
  }

  const database = new Database();
  database.syncSources(config.sources);
  const bot = process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID
    ? new DiscordBotNotifier(database)
    : undefined;
  const monitor = new MonitorService(database, adapters, bot ?? new DiscordNotifier());

  const close = async (): Promise<void> => {
    await browsers.close();
    await bot?.stop();
    database.close();
  };

  await bot?.start();

  if (command === "run-once" || command === "seed") {
    const results = await monitor.runAll(config.sources, { forceSeed: command === "seed" });
    await close();
    if (results.some((result) => result.status === "rejected")) process.exitCode = 1;
    return;
  }

  if (command === "digest") {
    await monitor.sendDailyDigest();
    await close();
    return;
  }

  const scheduler = new Scheduler(monitor, config);
  await monitor.runAll(config.sources);
  scheduler.start();
  logger.info({ timezone: config.timezone }, "Dog monitor is running");

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutting down");
    scheduler.stop();
    void close().finally(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, "Fatal error");
  process.exitCode = 1;
});
