// Ozon product search client using the official Ozon Seller API
// (API key + Client-Id headers). Endpoint: /v3/product/info/list or the
// product search endpoint. If credentials are missing we skip the source.

import type { Product } from "../../types.js";
import type { SearchContext, SourceClient } from "./base.js";
import { makeAxios, withUtm, classifyDelivery } from "./base.js";
import { env } from "../../config/env.js";
import { getRepositories } from "../../db/repositories/index.js";
import { logger } from "../../utils/logger.js";

interface OzonItem {
  product_id: number;
  name: string;
  offer_id?: string;
  price?: { price?: string; old_price?: string };
  marketing_price?: { price?: string };
  premium_price?: string;
  images?: string[];
  rating?: number;
  feedbacks_count?: number;
  availability?: number; // >0 → in stock
  fbs_shipping_days?: number;
}

interface OzonSearchResponse {
  items?: OzonItem[];
  total?: number;
}

export class OzonClient implements SourceClient {
  readonly source = "ozon" as const;
  private readonly base = makeAxios("https://api-seller.ozon.ru", 10_000, {
    "Api-Key": env.ozonApiKey,
    "Client-Id": env.ozonClientId,
    "Content-Type": "application/json",
  });

  async search(ctx: SearchContext, timeoutMs: number): Promise<Product[]> {
    const settings = await getRepositories().settings.get();
    if (!settings.enabledSources.includes("ozon")) return [];
    if (!env.ozonApiKey || !env.ozonClientId) {
      logger.debug("Ozon credentials missing, skipping");
      return [];
    }

    // Seller API does not expose a public text search; we use the product list
    // filter endpoint with a name-contains query.
    const body = {
      filter: {
        offer_id: ctx.brand ? ctx.brand : undefined,
        visibility: "ALL",
      },
      limit: 30,
      // text query is not officially supported here; we additionally fetch by
      // the parsed brand/model to narrow results.
    };

    try {
      const { data } = await this.base.post<OzonSearchResponse>("/v3/product/list", body, { timeout: timeoutMs });
      const items = data.items ?? [];
      const filtered = ctx.query
        ? items.filter((i) => i.name.toLowerCase().includes(ctx.query.toLowerCase()))
        : items;
      const thresholds = settings.deliveryThresholds;
      const out: Product[] = [];
      for (const i of filtered) {
        const price = Number.parseFloat(i.marketing_price?.price ?? i.price?.price ?? "0");
        if (!price) continue;
        const old = i.price?.old_price ? Number.parseFloat(i.price.old_price) : undefined;
        const idStr = String(i.product_id);
        out.push({
          id: idStr,
          source: "ozon",
          title: i.name,
          brand: ctx.brand,
          priceRub: price,
          oldPriceRub: old && old > price ? old : undefined,
          rating: i.rating,
          reviewsCount: i.feedbacks_count,
          url: `https://www.ozon.ru/product/${idStr}/`,
          affiliateUrl: withUtm("ozon", `https://www.ozon.ru/product/${idStr}/`),
          imageUrl: i.images?.[0],
          deliveryDays: i.fbs_shipping_days,
          deliveryCategory: classifyDelivery(i.fbs_shipping_days, false, thresholds),
          inStock: (i.availability ?? 0) > 0,
        });
      }
      logger.debug({ count: out.length }, "ozon results");
      return out;
    } catch (err) {
      // Ozon API frequently 4xx with bad filter; treat as no results, not fatal.
      logger.warn({ err: (err as Error).message }, "ozon search failed");
      return [];
    }
  }
}
