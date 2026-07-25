// DNS parser. Same shape as M.Video: navigate to the search URL, wait for
// product tiles, extract via DOM. Selectors are DNS-specific.

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

export class DnsParser implements MarketplaceParser {
  readonly source = "dns" as const;
  private proxyPool = new ProxyPool();

  async parse(ctx: SearchContext, timeoutMs: number): Promise<Product[]> {
    const settings = await getRepositories().settings.get();
    if (!settings.enabledSources.includes("dns")) return [];
    await this.proxyPool.seed(settings.proxyList);

    const { browser, proxy } = await launchRoutedBrowser({ proxyPool: this.proxyPool, timeoutMs });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      );
      const url = `https://www.dns-shop.ru/search/?q=${encodeURIComponent(ctx.query)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

      if (await this.isCaptcha(page)) {
        if (proxy) await this.proxyPool.markBad(proxy);
        logger.warn("dns captcha, skipping");
        return [];
      }

      if (!(await waitForSelector(page, ".catalog-product", timeoutMs))) return [];
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
    const url = r.url.startsWith("http") ? r.url : `https://www.dns-shop.ru${r.url}`;
    return {
      id: `dns:${encodeURIComponent(r.url)}`,
      source: "dns",
      title: r.title.trim(),
      priceRub: price,
      oldPriceRub: r.oldPriceText ? parsePrice(r.oldPriceText) : undefined,
      rating: r.ratingText ? Number.parseFloat(r.ratingText) : undefined,
      reviewsCount: r.reviewsText ? Number.parseInt(r.reviewsText.replace(/\D/g, ""), 10) || undefined : undefined,
      url,
      affiliateUrl: withUtm("dns", url),
      imageUrl: r.imageUrl,
      cityFrom: "ДНС",
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
  const cards = Array.from(document.querySelectorAll(".catalog-product"));
  return cards.slice(0, 30).map((card) => {
    const titleEl = card.querySelector(".catalog-product__name");
    const linkEl = card.querySelector<HTMLAnchorElement>("a.catalog-product__name");
    const priceEl = card.querySelector(".product-buy__price, .catalog-product__price-actual");
    const oldEl = card.querySelector(".product-buy__old-price, .catalog-product__price-old");
    const ratingEl = card.querySelector(".catalog-product__rating");
    const reviewsEl = card.querySelector(".catalog-product__rating-count");
    const imgEl = card.querySelector<HTMLImageElement>(".catalog-product__image img");
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
