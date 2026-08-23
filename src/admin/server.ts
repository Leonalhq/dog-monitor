import { serve, type ServerType } from "@hono/node-server";
import type { Database } from "../db/database.js";
import { logger } from "../lib/logger.js";
import type { AppConfig } from "../types.js";
import { createAdminApp } from "./app.js";

export function startAdminServer(database: Database, config: AppConfig): ServerType {
  const port = Number(process.env.ADMIN_PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("ADMIN_PORT must be an integer from 1 to 65535");
  const server = serve({ fetch: createAdminApp(database, config).fetch, hostname: "127.0.0.1", port });
  logger.info({ url: `http://127.0.0.1:${port}/ops` }, "Operations dashboard is running");
  return server;
}
