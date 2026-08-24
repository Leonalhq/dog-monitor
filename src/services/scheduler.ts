import { CronJob } from "cron";
import { logger } from "../lib/logger.js";
import type { AppConfig } from "../types.js";
import type { MonitorService } from "./monitor.js";

export class Scheduler {
  private readonly jobs: CronJob[] = [];

  constructor(private readonly monitor: MonitorService, private readonly config: AppConfig) {}

  start(): void {
    for (const source of this.config.sources.filter((item) => item.enabled)) {
      const job = new CronJob(
        source.schedule,
        () => void this.monitor.runSource(source).catch(() => undefined),
        null,
        true,
        this.config.timezone
      );
      this.jobs.push(job);
      logger.info({ sourceId: source.id, schedule: source.schedule }, "Scheduled source");
    }

    const digestJob = new CronJob(
      this.config.dailyDigestSchedule,
      () => void this.monitor.sendDailyDigest().catch((error: unknown) => {
        logger.error({ err: error instanceof Error ? error.message : String(error) }, "Daily digest failed");
      }),
      null,
      true,
      this.config.timezone
    );
    this.jobs.push(digestJob);
    logger.info({ schedule: this.config.dailyDigestSchedule }, "Scheduled daily digest");
  }

  stop(): void {
    for (const job of this.jobs) job.stop();
    this.jobs.length = 0;
  }

  isRunning(): boolean {
    return this.jobs.length > 0;
  }
}
