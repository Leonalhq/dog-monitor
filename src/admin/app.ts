import { Hono } from "hono";
import type { Database } from "../db/database.js";
import { getRecentLogs } from "../lib/logger.js";
import type { AppConfig } from "../types.js";

interface Counts {
  dogs: number;
  active: number;
  new_today: number;
  notifications: number;
  failed_notifications: number;
}

interface SourceRow {
  id: string;
  name: string;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  dogs: number;
}

interface DogRow {
  id: number;
  name: string;
  source_name: string;
  breed: string | null;
  status: string | null;
  profile_url: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface NotificationRow {
  id: number;
  dog_name: string;
  source_name: string;
  notification_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const displayTime = (value: string | null): string => value
  ? new Date(value).toLocaleString("en-CA", { timeZone: "America/Toronto" })
  : "Never";

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · Dog Monitor</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e8edf5;background:#0c111b}*{box-sizing:border-box}body{margin:0}a{color:#8ec5ff;text-decoration:none}nav{display:flex;gap:20px;padding:18px max(24px,calc((100% - 1180px)/2));background:#141c2a;border-bottom:1px solid #263247;position:sticky;top:0}main{max-width:1180px;margin:32px auto;padding:0 24px}h1{margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}.card{background:#141c2a;border:1px solid #263247;border-radius:12px;padding:18px}.number{font-size:30px;font-weight:700;margin-top:6px}.muted{color:#93a4bb}.ok{color:#67d391}.bad{color:#ff7b86}table{width:100%;border-collapse:collapse;background:#141c2a;border-radius:12px;overflow:hidden}th,td{text-align:left;padding:12px;border-bottom:1px solid #263247;vertical-align:top}th{color:#93a4bb;font-size:13px}tr:last-child td{border:0}code{white-space:pre-wrap;overflow-wrap:anywhere}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#263247}.section{margin-top:28px}@media(max-width:700px){table{display:block;overflow-x:auto}}
  </style></head><body><nav><a href="/ops">Dashboard</a><a href="/ops/dogs">Dogs</a><a href="/ops/notifications">Notifications</a><a href="/ops/logs">Logs</a></nav><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

function table(headers: string[], rows: string[][]): string {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="muted">No records</td></tr>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function createAdminApp(database: Database, config: AppConfig, startedAt = Date.now()): Hono {
  const app = new Hono();

  app.get("/ops", (context) => {
    const counts = database.sqlite.prepare(`
      SELECT COUNT(*) AS dogs,
        SUM(CASE WHEN disappeared_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN julianday(first_seen_at) >= julianday('now', '-1 day') THEN 1 ELSE 0 END) AS new_today,
        (SELECT COUNT(*) FROM notifications) AS notifications,
        (SELECT COUNT(*) FROM notifications WHERE status = 'failed') AS failed_notifications
      FROM dogs
    `).get() as Counts;
    const sources = database.sqlite.prepare(`
      SELECT s.id, s.name, s.last_success_at, s.last_error, s.consecutive_failures, COUNT(d.id) AS dogs
      FROM sources s LEFT JOIN dogs d ON d.source_id = s.id AND d.disappeared_at IS NULL
      WHERE s.enabled = 1 GROUP BY s.id ORDER BY s.name
    `).all() as SourceRow[];
    const schedules = new Map(config.sources.map((source) => [source.id, source.schedule]));
    const cards = [
      ["Dogs", counts.dogs], ["Currently listed", counts.active], ["First seen · 24h", counts.new_today],
      ["Notifications", counts.notifications], ["Failed notifications", counts.failed_notifications],
      ["Uptime", `${Math.floor((Date.now() - startedAt) / 60_000)} min`]
    ].map(([label, value]) => `<div class="card"><div class="muted">${escapeHtml(label)}</div><div class="number">${escapeHtml(value)}</div></div>`).join("");
    const sourceTable = table(["Source", "Schedule", "Dogs", "Health", "Last success"], sources.map((source) => [
      escapeHtml(source.name), escapeHtml(schedules.get(source.id) ?? "—"), escapeHtml(source.dogs),
      source.consecutive_failures > 0
        ? `<span class="bad">${source.consecutive_failures} failure(s): ${escapeHtml(source.last_error)}</span>`
        : '<span class="ok">Healthy</span>',
      escapeHtml(displayTime(source.last_success_at))
    ]));
    return context.html(layout("Operations", `<div class="grid">${cards}</div><div class="section"><h2>Sources</h2>${sourceTable}</div>`));
  });

  app.get("/ops/dogs", (context) => {
    const dogs = database.sqlite.prepare(`
      SELECT d.id, d.name, s.name AS source_name, d.breed, d.status, d.profile_url, d.first_seen_at, d.last_seen_at
      FROM dogs d JOIN sources s ON s.id = d.source_id ORDER BY d.last_seen_at DESC LIMIT 100
    `).all() as DogRow[];
    return context.html(layout("Recent dogs", table(
      ["Dog", "Source", "Breed", "Status", "First seen", "Last seen"],
      dogs.map((dog) => [
        `<a href="${escapeHtml(dog.profile_url)}" target="_blank" rel="noreferrer">${escapeHtml(dog.name)}</a>`,
        escapeHtml(dog.source_name), escapeHtml(dog.breed || "Unknown"), `<span class="pill">${escapeHtml(dog.status || "Unknown")}</span>`,
        escapeHtml(displayTime(dog.first_seen_at)), escapeHtml(displayTime(dog.last_seen_at))
      ])
    )));
  });

  app.get("/ops/notifications", (context) => {
    const notifications = database.sqlite.prepare(`
      SELECT n.id, d.name AS dog_name, s.name AS source_name, n.notification_type, n.status,
        n.attempts, n.last_error, n.created_at, n.sent_at
      FROM notifications n JOIN dogs d ON d.id = n.dog_id JOIN sources s ON s.id = d.source_id
      ORDER BY n.created_at DESC LIMIT 100
    `).all() as NotificationRow[];
    return context.html(layout("Recent notifications", table(
      ["Dog", "Source", "Type", "Status", "Attempts", "Created", "Error"],
      notifications.map((item) => [
        escapeHtml(item.dog_name), escapeHtml(item.source_name), escapeHtml(item.notification_type),
        `<span class="pill">${escapeHtml(item.status)}</span>`, escapeHtml(item.attempts),
        escapeHtml(displayTime(item.sent_at ?? item.created_at)), escapeHtml(item.last_error || "—")
      ])
    )));
  });

  app.get("/ops/logs", (context) => context.html(layout("Live logs", `
    <p class="muted">The latest 500 in-process log records are kept in memory. This page refreshes every 2 seconds.</p>
    <div id="logs"></div><script>
    const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function refresh(){const rows=await fetch('/ops/api/logs').then(r=>r.json());document.getElementById('logs').innerHTML=rows.map(x=>'<div class="card" style="margin-bottom:8px"><span class="muted">'+esc(new Date(x.time).toLocaleString())+'</span> <strong>'+esc(x.msg||'')+'</strong><br><code>'+esc(JSON.stringify(x))+'</code></div>').join('')||'<p class="muted">No logs yet</p>'}refresh();setInterval(refresh,2000);
    </script>`)));

  app.get("/ops/api/logs", (context) => context.json(getRecentLogs()));
  app.get("/ops/api/health", (context) => context.json({ ok: true, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000) }));
  return app;
}
