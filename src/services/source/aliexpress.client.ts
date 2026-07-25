// AliExpress affiliate search client (AliExpress Open Platform /dsapi).
// Requires ALIEXPRESS_APP_KEY + ALIEXPRESS_APP_SECRET. We sign requests per
// the Open Platform spec. AliExpress is always classified as "abroad" delivery.

import crypto from "node:crypto";
import type { Product } from "../../types.js";
import type { SearchContext, SourceClient } from "./base.js";
import { makeAxios, withUtm } from "./base.js";
import { env } from "../../config/env.js";
import { getRepositories } from "../../db/repositories/index.js";
import { logger } from "../../utils/logger.js";

interface AliItem {
  item_id?: string;
  product_title?: string;
  product_title_short?: string;
  sale_price?: string;
  original_price?: string;
  product_image_url?: string;
  product_rating?: string;
  valid_shop?: string;
  // affiliate link returned by the API
  promotion_link?: string;
}

interface AliSearchResponse {
  aliexpress_affiliate_product_query_response?: {
    resp_result?: {
      result?: {
        products?: { product?: AliItem[] };
      };
      resp_code?: number;
      resp_msg?: string;
    };
  };
}

function sign(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
  return crypto.createHmac("md5", secret + "&").update(sorted).digest("hex").toUpperCase();
}

export class AliExpressClient implements SourceClient {
  readonly source = "aliexpress" as const;
  private readonly base = makeAxios("https://api-sg.aliexpress.com", 15_000);

  async search(ctx: SearchContext, timeoutMs: number): Promise<Product[]> {
    const settings = await getRepositories().settings.get();
    if (!settings.enabledSources.includes("aliexpress")) return [];
    if (!env.aliexpressAppKey || !env.aliexpressAppSecret) {
      logger.debug("AliExpress credentials missing, skipping");
      return [];
    }

    const params: Record<string, string> = {
      app_key: env.aliexpressAppKey,
      method: "aliexpress.affiliate.product.query",
      sign_method: "md5",
      timestamp: String(Date.now()),
      format: "json",
      v: "1.0",
      keywords: ctx.query,
      target_currency: "RUB",
      target_language: "RU",
      tracking_id: env.partnerUtm.aliexpress || "shopbot",
      page_size: "30",
      ship_to_country: "RU",
    };
    params.sign = sign(params, env.aliexpressAppSecret);

    try {
      const { data } = await this.base.get<AliSearchResponse>("/sync", { params, timeout: timeoutMs });
      const items = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ?? [];
      const out: Product[] = [];
      for (const i of items) {
        const price = Number.parseFloat(i.sale_price ?? "0");
        if (!price || !i.item_id) continue;
        const idStr = String(i.item_id);
        const url = i.promotion_link || `https://aliexpress.ru/item/${idStr}.html`;
        out.push({
          id: idStr,
          source: "aliexpress",
          title: i.product_title || i.product_title_short || "AliExpress",
          priceRub: price,
          oldPriceRub: i.original_price ? Number.parseFloat(i.original_price) : undefined,
          rating: i.product_rating ? Number.parseFloat(i.product_rating) : undefined,
          url,
          affiliateUrl: withUtm("aliexpress", url),
          imageUrl: i.product_image_url,
          cityFrom: "Китай",
          deliveryDays: 22,
          deliveryCategory: "abroad",
          inStock: true,
        });
      }
      logger.debug({ count: out.length }, "aliexpress results");
      return out;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "aliexpress search failed");
      return [];
    }
  }
}
