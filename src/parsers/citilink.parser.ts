// Citilink parser. Search URL: https://www.citilink.ru/search/?text=...
// Cards live under .ProductCard; prices under data attributes + .price.

import type { Product } from "../types.js";
import type { SearchContext } from "../services/source/base.js";
import type { MarketplaceParser } from "./base.js";
import { waitForSelector } from "./base.js";
import { launchRoutedBrowser, closeBrowser } from "./browser.js";
import { ProxyPool } from "./proxy-pool.js";
import { getRepositories } from "../db/repositories/index.js";
import { classifyDelivery, withUtm } from "../services/source/base.js";
import { logger } from "../utils/logger.js";

interface RawCard {
  title: string;
  url: string;
  priceText: string;
  oldPriceText?: string;
  ratingText?: string;
  reviewsText?: string;
  imageUrl?: string;
}

export class CitilinkParser implements MarketplaceParser {
  readonly source = "citilink" as const;
  private proxyPool = new ProxyPool();

  async parse(ctx: SearchContext, timeoutMs: number): Promise<Product[]> {
    const settings = await getRepositories().settings.get();
    if (!settings.enabledSources.includes("citilink")) return [];
    await this.proxyPool.seed(settings.proxyList);

    const { browser, proxy } = await launchRoutedBrowser({ proxyPool: this.proxyPool, timeoutMs });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      );
      const url = `https://www.citilink.ru/search/?text=${encodeURIComponent(ctx.query)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

      if (await this.isCaptcha(page)) {
        if (proxy) await this.proxyPool.markBad(proxy);
        logger.warn("citilink captcha, skipping");
        return [];
      }

      if (!(await waitForSelector(page, ".ProductCard", timeoutMs))) {
        if (!(await waitForSelector(page, "[data-meta-name='product-card']", timeoutMs))) return [];
      }
      await autoScroll(page).catch(() => undefined);

      const raw = await page.evaluate(extractCards);
      const thresholds = settings.deliveryThresholds;
      return raw.slice(0, 30).map((r) => this.normalize(r, thresholds));
    } finally {
      await closeBrowser(browser);
    }
  }

  private async isCaptcha(page: import("puppeteer").Page): Promise<boolean> {
    try {
      const text = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "");
      return text.includes("captcha") || text.includes("подтвердите, что вы не робот");
    } catch {
      return false;
    }
  }

  private normalize(r: RawCard, thresholds: { fastMaxDays: number; mediumMaxDays: number }): Product {
    const price = parsePrice(r.priceText);
    const url = r.url.startsWith("http") ? r.url : `https://www.citilink.ru${r.url}`;
    return {
      id: `citilink:${encodeURIComponent(r.url)}`,
      source: "citilink",
      title: r.title.trim(),
      priceRub: price,
      oldPriceRub: r.oldPriceText ? parsePrice(r.oldPriceText) : undefined,
      rating: r.ratingText ? Number.parseFloat(r.ratingText) : undefined,
      reviewsCount: r.reviewsText ? Number.parseInt(r.reviewsText.replace(/\D/g, ""), 10) || undefined : undefined,
      url,
      affiliateUrl: withUtm("citilink", url),
      imageUrl: r.imageUrl,
      cityFrom: "Ситилинк",
      deliveryDays: 1,
      deliveryCategory: classifyDelivery(1, false, thresholds),
      inStock: true,
    };
  }
}

function parsePrice(s: string): number {
  return Number.parseFloat(s.replace(/[^\d.,]/g, "").replace(/\s+/g, "").replace(",", ".")) || 0;
}

async function autoScroll(page: import("puppeteer").Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= 4000 || window.innerHeight + window.scrollY >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });
}

function extractCards(): RawCard[] {
  const cards = Array.from(document.querySelectorAll(".ProductCard, [data-meta-name='product-card']"));
  return cards.slice(0, 30).map((card) => {
    const titleEl = card.querySelector(".ProductCardHeader, .product-card__title, [data-meta-name='product-card__title']");
    const linkEl = card.querySelector<HTMLAnchorElement>("a.ProductCardHeader, a.product-card__link, a");
    const priceEl = card.querySelector(".ProductCardPrice, .price, [data-meta-name='product-card__price']");
    const oldEl = card.querySelector(".ProductCardOldPrice, .old-price");
    const ratingEl = card.querySelector(".ProductCardRating, .rating");
    const reviewsEl = card.querySelector(".ProductCardRatingCount, .rating-count");
    const imgEl = card.querySelector<HTMLImageElement>("img");
    return {
      title: titleEl?.textContent?.trim() ?? "",
      url: linkEl?.getAttribute("href") ?? "",
      priceText: priceEl?.textContent?.trim() ?? "",
      oldPriceText: oldEl?.textContent?.trim() || undefined,
      ratingText: ratingEl?.textContent ?? undefined,
      reviewsText: reviewsEl?.textContent ?? undefined,
      imageUrl: imgEl?.src || undefined,
    };
  }).filter((r) => r.title && r.priceText);
}
