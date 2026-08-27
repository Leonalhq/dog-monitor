import pino from "pino";
import { Writable } from "node:stream";

export type LogRecord = Record<string, unknown>;

const logRecords: LogRecord[] = [];

const logBuffer = new Writable({
  write(chunk, _encoding, callback) {
    for (const line of chunk.toString().split("\n")) {
      if (!line) continue;
      try {
        logRecords.push(JSON.parse(line) as LogRecord);
      } catch {
        logRecords.push({ time: Date.now(), level: 30, msg: line });
      }
    }
    if (logRecords.length > 500) logRecords.splice(0, logRecords.length - 500);
    callback();
  }
});

export function getRecentLogs(limit = 200): LogRecord[] {
  return logRecords.slice(-Math.max(0, limit)).reverse();
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: null
}, pino.multistream([{ stream: process.stdout }, { stream: logBuffer }]));
