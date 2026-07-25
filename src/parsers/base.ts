// Shared parser contract and helpers. A parser scrapes one marketplace using
// Puppeteer and returns normalized Products. Failures (captcha, block, timeout)
// must be swallowed by the worker so other sources continue.

import type { Product } from "../types.js";
import type { SearchContext } from "../services/source/base.js";

export interface MarketplaceParser {
  readonly source: "mvideo" | "dns" | "citilink";
  parse(ctx: SearchContext, timeoutMs: number): Promise<Product[]>;
}

// Common wait-for selector helper with a shorter timeout than the overall one.
export async function waitForSelector(
  page: import("puppeteer").Page,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: Math.min(timeoutMs, 6000), visible: true });
    return true;
  } catch {
    return false;
  }
}
