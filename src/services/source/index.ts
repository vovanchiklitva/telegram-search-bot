// Source registry: maps Source → client, and exposes ready-to-use instances.

import type { Source } from "../../types.js";
import { API_SOURCES } from "../../types.js";
import type { SourceClient } from "./base.js";
import { WildberriesClient } from "./wildberries.client.js";
import { OzonClient } from "./ozon.client.js";
import { AliExpressClient } from "./aliexpress.client.js";

const apiClients: Record<string, SourceClient> = {
  wildberries: new WildberriesClient(),
  ozon: new OzonClient(),
  aliexpress: new AliExpressClient(),
};

export function getApiClient(source: Source): SourceClient | null {
  if (!API_SOURCES.includes(source)) return null;
  return apiClients[source] ?? null;
}

export function getApiClients(): SourceClient[] {
  return API_SOURCES.map((s) => apiClients[s]).filter(Boolean) as SourceClient[];
}

// Parser clients are built lazily by the worker (Puppeteer is heavy).
export { type SourceClient };
