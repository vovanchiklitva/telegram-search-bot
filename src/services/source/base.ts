// Shared interface and helpers for every product source.
// Each source implements `search()` returning normalized Products.
// Errors are caught at the queue-worker level; clients throw on failure.

import axios, { type AxiosInstance } from "axios";
import { env } from "../../config/env.js";
import type { Product, Source, DeliveryCategory } from "../../types.js";

export interface SearchContext {
  query: string;
  city: string | null;
  // parsed LLM parameters (optional - clients may ignore fields they can't map)
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  attributes?: Record<string, string>;
}

export interface SourceClient {
  readonly source: Source;
  search(ctx: SearchContext, timeoutMs: number): Promise<Product[]>;
}

export function makeAxios(baseURL: string, timeoutMs: number, headers?: Record<string, string>): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: { "User-Agent": "shop-search-bot/1.0", ...headers },
  });
}

// Build a partner/affiliate URL with UTM tags. For sources we don't have a
// partner program for, we return the plain product URL.
export function withUtm(source: Source, url: string): string {
  const utm =
    source === "wildberries" ? env.partnerUtm.wb :
    source === "ozon" ? env.partnerUtm.ozon :
    source === "aliexpress" ? env.partnerUtm.aliexpress : "";
  if (!utm) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}utm_source=shopbot&utm_medium=referral&utm_campaign=${encodeURIComponent(utm)}`;
}

// Classify a delivery-days value into the user-facing bucket.
export function classifyDelivery(days: number | undefined, abroad: boolean, thresholds: { fastMaxDays: number; mediumMaxDays: number }): DeliveryCategory {
  if (abroad) return "abroad";
  if (days === undefined) return "medium";
  if (days <= thresholds.fastMaxDays) return "fast";
  if (days <= thresholds.mediumMaxDays) return "medium";
  return "slow";
}
