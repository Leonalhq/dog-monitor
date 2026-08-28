import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  adapter: z.enum(["adopets", "petango", "adoptapet", "safepaws", "goldenrescue", "ontariospca", "welcomedogkorea", "shopify", "html"]),
  url: z.string().url(),
  publicUrl: z.string().url().optional(),
  schedule: z.string().min(1).default("17 * * * *"),
  allowEmpty: z.boolean().default(false),
  notifyRelisted: z.boolean().default(false),
  filters: z.object({
    includeNames: z.array(z.string()).optional(),
    excludeNames: z.array(z.string()).optional(),
    includeStatuses: z.array(z.string()).optional()
  }).default({}),
  selectors: z.object({
    item: z.string().min(1),
    name: z.string().min(1),
    link: z.string().min(1),
    image: z.string().min(1).optional(),
    externalId: z.string().min(1).optional(),
    breed: z.string().min(1).optional(),
    age: z.string().min(1).optional(),
    sex: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    description: z.string().min(1).optional()
  }).optional()
}).superRefine((source, ctx) => {
  if (source.adapter === "html" && !source.selectors) {
    ctx.addIssue({ code: "custom", message: "HTML sources require selectors" });
  }
});

const appConfigSchema = z.object({
  timezone: z.string().default("America/Toronto"),
  dailyDigestSchedule: z.string().default("0 9 * * *"),
  sources: z.array(sourceSchema).min(1)
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const source of value.sources) {
    if (ids.has(source.id)) {
      ctx.addIssue({ code: "custom", message: `Duplicate source id: ${source.id}` });
    }
    ids.add(source.id);
  }
});

export async function loadConfig(configPath = process.env.CONFIG_PATH ?? "./config/sources.yaml"): Promise<AppConfig> {
  const resolvedPath = path.resolve(configPath);
  const source = await fs.readFile(resolvedPath, "utf8");
  return appConfigSchema.parse(YAML.parse(source));
}
