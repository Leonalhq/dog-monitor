import type { SourceAdapter } from "../adapters/adapter.js";
import { Database } from "../db/database.js";
import { logger } from "../lib/logger.js";
import type { AdapterKind, DogListing, SourceConfig, SourceRunSummary } from "../types.js";
import type { Notifier } from "./notifier.js";

function includesCaseInsensitive(values: string[] | undefined, candidate: string | undefined): boolean {
  if (!values || values.length === 0) return true;
  if (!candidate) return false;
  const normalized = candidate.toLocaleLowerCase();
  return values.some((value) => value.toLocaleLowerCase() === normalized);
}

export function matchesNotificationFilters(listing: DogListing, source: SourceConfig): boolean {
  const filters = source.filters;
  if (filters.includeNames?.length && !includesCaseInsensitive(filters.includeNames, listing.name)) return false;
  if (filters.excludeNames?.length && includesCaseInsensitive(filters.excludeNames, listing.name)) return false;
  if (filters.includeStatuses?.length && !includesCaseInsensitive(filters.includeStatuses, listing.status)) return false;
  return true;
}

export class MonitorService {
  private readonly activeSources = new Set<string>();

  constructor(
    private readonly database: Database,
    private readonly adapters: Record<AdapterKind, SourceAdapter>,
    private readonly notifier: Notifier
  ) {}

  async runSource(source: SourceConfig, options: { forceSeed?: boolean } = {}): Promise<SourceRunSummary> {
    if (this.activeSources.has(source.id)) {
      throw new Error(`Source ${source.id} is already running`);
    }
    this.activeSources.add(source.id);
    const started = Date.now();
    const observedAt = new Date().toISOString();
    const seededBeforeRun = this.database.isSeeded(source.id);
    const seedThisRun = options.forceSeed === true || !seededBeforeRun;
    this.database.markRunStarted(source.id, observedAt);

    try {
      const listings = await this.adapters[source.adapter].fetch(source);
      if (listings.length === 0 && !source.allowEmpty) {
        throw new Error(`Adapter returned zero listings for ${source.name}; refusing to treat the source as empty`);
      }
      const discoveries = this.database.persistListings(source.id, listings, observedAt);
      let notified = 0;

      for (const discovery of discoveries) {
        const currentStatus = discovery.listing.status ?? null;
        if (discovery.kind !== "new" && discovery.previousStatus != null && discovery.previousStatus !== currentStatus) {
          logger.info({
            sourceId: source.id,
            dogId: discovery.dogId,
            dogName: discovery.listing.name,
            from: discovery.previousStatus,
            to: currentStatus
          }, "Dog status changed");
        }
      }

      if (!seedThisRun) {
        for (const discovery of discoveries) {
          const notificationType = discovery.kind === "new"
            ? "new"
            : discovery.kind === "relisted" && source.notifyRelisted
              ? "relisted"
              : undefined;
          if (!notificationType || !matchesNotificationFilters(discovery.listing, source)) continue;
          if (!this.database.shouldSendNotification(discovery.dogId, notificationType, observedAt)) continue;

          try {
            const result = await this.notifier.sendDog(
              discovery.listing,
              source.name,
              notificationType,
              discovery.dogId
            );
            this.database.markNotificationSent(
              discovery.dogId,
              notificationType,
              new Date().toISOString(),
              result.messageId
            );
            notified += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.database.markNotificationFailed(discovery.dogId, notificationType, message);
            logger.error({ sourceId: source.id, dogId: discovery.dogId, err: message }, "Discord notification failed");
          }
        }
      }

      this.database.markRunSuccess(source.id, new Date().toISOString());
      const summary = {
        sourceId: source.id,
        discovered: listings.length,
        notified,
        seeded: seedThisRun,
        durationMs: Date.now() - started
      };
      logger.info(summary, "Source run completed");
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.database.markRunFailure(source.id, new Date().toISOString(), message);
      logger.error({ sourceId: source.id, err: message }, "Source run failed");
      throw error;
    } finally {
      this.activeSources.delete(source.id);
    }
  }

  async runAll(sources: SourceConfig[], options: { forceSeed?: boolean } = {}): Promise<PromiseSettledResult<SourceRunSummary>[]> {
    return Promise.allSettled(
      sources.filter((source) => source.enabled).map((source) => this.runSource(source, options))
    );
  }

  async sendDailyDigest(): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    await this.notifier.sendDailyDigest(this.database.getDigestSince(since), this.database.getHealth());
  }
}
