// Wildberries search client.
// Uses the public search endpoint at search.wb.ru which returns catalog data
// without requiring the supplier Statistics API key. Falls back gracefully
// if the key is absent. Response shape is normalized into our Product type.

import type { Product } from "../../types.js";
import type { SearchContext, SourceClient } from "./base.js";
import { makeAxios, withUtm, classifyDelivery } from "./base.js";
import { getRepositories } from "../../db/repositories/index.js";
import { logger } from "../../utils/logger.js";

interface WbShardProduct {
  id: number;
  name: string;
  brand?: string;
  priceU?: number; // price in kopecks
  salePriceU?: number;
  rating?: number;
  feedbacks?: number;
  // delivery info
  deliveryTime?: number; // days from nearest wh
  s?: { name?: string }; // supplier / warehouse
  pics?: number;
}

interface WbSearchResponse {
  data?: {
    products?: WbShardProduct[];
  };
  metadata?: { total?: number };
}

export class WildberriesClient implements SourceClient {
  readonly source = "wildberries" as const;
  private readonly base = makeAxios("https://search.wb.ru", 10_000);

  async search(ctx: SearchContext, timeoutMs: number): Promise<Product[]> {
    const settings = await getRepositories().settings.get();
    if (!settings.enabledSources.includes("wildberries")) return [];

    const dest = await this.resolveDest(ctx.city);
    const url = "/exact/search/0";
    const params = {
      query: ctx.query,
      dest: dest ?? -1257786, // Moscow fallback
      limit: 30,
    };
    const { data } = await this.base.get<WbSearchResponse>(url, { params, timeout: timeoutMs });
    const products = data?.data?.products ?? [];
    const thresholds = settings.deliveryThresholds;

    const out: Product[] = [];
    for (const p of products) {
      if (p.priceU === undefined && p.salePriceU === undefined) continue;
      const price = (p.salePriceU ?? p.priceU ?? 0) / 100;
      const old = p.priceU ? p.priceU / 100 : undefined;
      const idStr = String(p.id);
      out.push({
        id: idStr,
        source: "wildberries",
        title: p.name,
        brand: p.brand,
        priceRub: price,
        oldPriceRub: old !== price ? old : undefined,
        rating: p.rating,
        reviewsCount: p.feedbacks,
        url: `https://www.wildberries.ru/catalog/${idStr}/detail.aspx`,
        affiliateUrl: withUtm("wildberries", `https://www.wildberries.ru/catalog/${idStr}/detail.aspx`),
        imageUrl: p.pics ? `https://basket-01.wbbasket.ru/vol${Math.floor(p.id / 1_000_000)}/part${Math.floor((p.id % 1_000_000) / 1000)}/${p.id}/images/big/1.jpg` : undefined,
        deliveryDays: p.deliveryTime,
        deliveryCategory: classifyDelivery(p.deliveryTime, false, thresholds),
        inStock: true,
      });
    }
    logger.debug({ count: out.length }, "wb results");
    return out;
  }

  // Wildberries uses numeric delivery destination codes (dest). We map a few
  // big cities; unknown cities fall back to Moscow. For a production bot you'd
  // call /api/v1/delivery/dest, but that endpoint is volatile; the map is stable.
  private async resolveDest(city: string | null): Promise<number | null> {
    if (!city) return null;
    const map: Record<string, number> = {
      москва: -1257786,
      "санкт-петербург": -1257410,
      петербург: -1257410,
      спб: -1257410,
      новосибирск: -1257442,
      екатеринбург: -1257276,
      казань: -1257410,
      нижний: -1257138,
      новгород: -1257138,
      самара: -1257166,
      уфа: -1257276,
      краснодар: -1257387,
      челябинск: -1257276,
      ростов: -1257387,
      омск: -1257442,
      красноярск: -1257442,
      владивосток: -1257138,
      иркутск: -1257442,
      хабаровск: -1257138,
    };
    const key = city.trim().toLowerCase();
    return map[key] ?? null;
  }
}
