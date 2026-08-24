import { serve, type ServerType } from "@hono/node-server";
import type { Database } from "../db/database.js";
import { logger } from "../lib/logger.js";
import type { AppConfig } from "../types.js";
import type { MonitorService } from "../services/monitor.js";
import type { Scheduler } from "../services/scheduler.js";
import { createAdminApp } from "./app.js";

export function startAdminServer(
  database: Database,
  config: AppConfig,
  monitor: MonitorService,
  scheduler: Scheduler
): ServerType {
  const port = Number(process.env.ADMIN_PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("ADMIN_PORT must be an integer from 1 to 65535");
  const server = serve({
    fetch: createAdminApp(database, config, {
      isSchedulerRunning: () => scheduler.isRunning(),
      getActiveSourceIds: () => monitor.getActiveSourceIds(),
      runSource: (source) => monitor.runSource(source),
      runAll: () => monitor.runAll(config.sources)
    }).fetch,
    hostname: "127.0.0.1",
    port
  });
  logger.info({ url: `http://127.0.0.1:${port}/ops` }, "Operations dashboard is running");
  return server;
}
