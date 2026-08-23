# Adoptable Dog Monitor

A deterministic, token-free monitor for nearby dog rescue listings. It checks each configured source on its own schedule, stores every observed dog in SQLite, and sends Discord embeds—with images—only when a database-backed rule says a listing is new or relisted.

## Included sources

- Guelph Humane Society (Adopets)
- Cambridge & District Humane Society (Petango)
- Humane Society of Kitchener Waterloo & Stratford Perth (Petango)
- Oxford County Animal Rescue (Adopt-a-Pet)
- Safe Paws Animal Rescue of Ontario (Wix)

The source adapter, schedule, empty-result policy, relisting behavior, and notification filters are independently configurable in `config/sources.yaml`.

## How new-dog detection works

`dogs` has a unique constraint on `(source_id, external_id)`. Every successful scan updates `last_seen_at` and writes an `observations` row. Discord delivery is stored separately in `notifications`, with a unique constraint on `(dog_id, notification_type)`.

The first successful scan of each source is an automatic seed: all current dogs are saved but none are announced. Later scans notify only IDs that were not already present. No LLM is used anywhere in this path.

## Local setup

Requirements: Node.js 22+, npm, and enough disk space for headless Chromium.

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Set `DISCORD_WEBHOOK_URL` in `.env`, then export the variables or use your preferred dotenv runner. The application itself deliberately does not load `.env` implicitly in production.

Useful commands:

```bash
npm test
npm run typecheck
npm run seed
npm run run-once
npm run source:check -- cambridge
npm run dev
npm run digest
```

- `seed` records the currently visible dogs without sending new-dog messages.
- `run-once` executes all enabled sources once.
- `dev` performs a startup scan and then runs the hourly and daily schedules.
- `source:check -- <id>` parses one source without touching SQLite or Discord and prints validation samples.

## Interactive Discord bot

Set `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, and optionally `DISCORD_OWNER_USER_ID` to send future dog cards through a bot with Analyze, Interested, and Hide buttons. Hide records the choice and deletes the bot message for everyone in that channel. Without these values, the existing webhook remains the fallback.

Analyze fetches the profile only when clicked, calls Gemini using `GEMINI_API_KEY`, and caches the structured result until the source content changes. The monitor never uses an LLM to decide whether a dog is new.

## VPS deployment

Copy the project to a small Linux VPS with Docker, create `.env`, and run:

```bash
docker compose up -d --build
docker compose logs -f dog-monitor
```

The named Docker volume `dog-monitor-data` keeps SQLite data across container restarts and image upgrades. Back up that volume before moving servers; the database is what prevents duplicate notifications.

## Discord messages

Each new dog is sent as one Discord embed containing:

- shelter and dog name;
- profile link;
- known age, sex, breed, location, and status;
- original listing image when the source exposes one;
- stable external ID and detection time.

If a source blocks Discord from loading its image URL, add an image proxy or object-storage cache for only that source. The MVP intentionally avoids downloading and storing every image.

## Adding another website

If it uses Adopets, Petango, or Adopt-a-Pet, add another source entry and reuse the adapter. A genuinely new platform implements the small `SourceAdapter` interface:

```ts
interface SourceAdapter {
  fetch(source: SourceConfig): Promise<DogListing[]>;
}
```

The adapter only extracts data. Scheduling, persistence, missing/relisted tracking, filtering, Discord delivery, and retries remain shared.

For a static HTML site, use `adapter: html` plus `selectors` for `item`, `name`, `link`, and optional fields. Run `npm run source:check -- <id>` before enabling it.

## Operational safety

- Empty adapter results fail closed by default, so a parser break does not mark every dog as disappeared.
- A single source failure does not stop other source jobs.
- Failed Discord messages remain retryable; successfully sent message types are never sent twice.
- Each source has an in-process overlap lock.
- Hourly jobs are offset to avoid hitting all organizations simultaneously.

Use polite polling intervals and review each site's terms and robots policy before production deployment.
