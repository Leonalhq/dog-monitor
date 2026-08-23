import type { BrowserPool } from "../lib/browser-pool.js";
import type { AdapterKind } from "../types.js";
import { AdoptAPetAdapter } from "./adoptapet.js";
import { AdopetsAdapter } from "./adopets.js";
import { HtmlAdapter } from "./html.js";
import type { SourceAdapter } from "./adapter.js";
import { PetangoAdapter } from "./petango.js";

export function createAdapters(browsers: BrowserPool): Record<AdapterKind, SourceAdapter> {
  return {
    adopets: new AdopetsAdapter(browsers),
    petango: new PetangoAdapter(browsers),
    adoptapet: new AdoptAPetAdapter(browsers),
    html: new HtmlAdapter()
  };
}
