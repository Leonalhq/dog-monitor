export type AdapterKind = "adopets" | "petango" | "adoptapet" | "safepaws" | "goldenrescue" | "ontariospca" | "html";

export interface HtmlSelectors {
  item: string;
  name: string;
  link: string;
  image?: string | undefined;
  externalId?: string | undefined;
  breed?: string | undefined;
  age?: string | undefined;
  sex?: string | undefined;
  status?: string | undefined;
  description?: string | undefined;
}

export interface SourceFilters {
  includeNames?: string[] | undefined;
  excludeNames?: string[] | undefined;
  includeStatuses?: string[] | undefined;
}

export interface SourceConfig {
  id: string;
  name: string;
  enabled: boolean;
  adapter: AdapterKind;
  url: string;
  publicUrl?: string | undefined;
  schedule: string;
  allowEmpty: boolean;
  notifyRelisted: boolean;
  filters: SourceFilters;
  selectors?: HtmlSelectors | undefined;
}

export interface AppConfig {
  timezone: string;
  dailyDigestSchedule: string;
  sources: SourceConfig[];
}

export interface DogListing {
  sourceId: string;
  externalId: string;
  name: string;
  profileUrl: string;
  imageUrl?: string;
  breed?: string;
  age?: string;
  sex?: string;
  location?: string;
  status?: string;
  description?: string;
  rawData?: unknown;
}

export type DiscoveryKind = "new" | "existing" | "relisted";

export interface PersistedDiscovery {
  dogId: number;
  kind: DiscoveryKind;
  listing: DogListing;
  changed: boolean;
  previousStatus?: string | null;
}

export interface SourceRunSummary {
  sourceId: string;
  discovered: number;
  notified: number;
  seeded: boolean;
  durationMs: number;
}
