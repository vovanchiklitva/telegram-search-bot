// M.Video parser. Loads the search results page, waits for product cards,
// and extracts title / price / rating / link via DOM selectors. M.Video has
// aggressive bot protection; we rely on proxy rotation + stealth flags and
// fail fast (return []) if the captcha page appears.

import type { Page } from "puppeteer";
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

export class MVideoParser implements MarketplaceParser {
  readonly source = "mvideo" as const;
  private proxyPool = new ProxyPool();

  async parse(ctx: SearchContext, timeoutMs: number): Promise<Product[]> {
    const settings = await getRepositories().settings.get();
    if (!settings.enabledSources.includes("mvideo")) return [];

    await this.proxyPool.seed(settings.proxyList);
    const { browser, proxy } = await launchRoutedBrowser({ proxyPool: this.proxyPool, timeoutMs });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      );
      const url = `https://www.mvideo.ru/search?q=${encodeURIComponent(ctx.query)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

      // captcha / block detection
      if (await this.isCaptcha(page)) {
        if (proxy) await this.proxyPool.markBad(proxy);
        logger.warn("mvideo captcha, skipping");
        return [];
      }

      if (!(await waitForSelector(page, '[data-testid="product-card"]', timeoutMs))) {
        // try alternative selector
        if (!(await waitForSelector(page, ".product-card", timeoutMs))) return [];
      }

      // scroll to load lazy items
      await autoScroll(page).catch(() => undefined);

      const raw = await page.evaluate(extractCards);
      const thresholds = settings.deliveryThresholds;
      return raw.slice(0, 30).map((r) => this.normalize(r, thresholds));
    } finally {
      await closeBrowser(browser);
    }
  }

  private async isCaptcha(page: Page): Promise<boolean> {
    try {
      const text = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "");
      return text.includes("captcha") || (text.includes("проверка") && text.includes("браузер"));
    } catch {
      return false;
    }
  }

  private normalize(r: RawCard, thresholds: { fastMaxDays: number; mediumMaxDays: number }): Product {
    const price = parsePrice(r.priceText);
    const url = r.url.startsWith("http") ? r.url : `https://www.mvideo.ru${r.url}`;
    return {
      id: `mvideo:${encodeURIComponent(r.url)}`,
      source: "mvideo",
      title: r.title.trim(),
      priceRub: price,
      oldPriceRub: r.oldPriceText ? parsePrice(r.oldPriceText) : undefined,
      rating: r.ratingText ? Number.parseFloat(r.ratingText) : undefined,
      reviewsCount: r.reviewsText ? Number.parseInt(r.reviewsText.replace(/\D/g, ""), 10) || undefined : undefined,
      url,
      affiliateUrl: withUtm("mvideo", url),
      imageUrl: r.imageUrl,
      cityFrom: "М.Видео",
      deliveryDays: 1,
      deliveryCategory: classifyDelivery(1, false, thresholds),
      inStock: true,
    };
  }
}

function parsePrice(s: string): number {
  return Number.parseFloat(s.replace(/[^\d.,]/g, "").replace(/\s+/g, "").replace(",", ".")) || 0;
}

async function autoScroll(page: Page): Promise<void> {
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

// runs in the page context
function extractCards(): RawCard[] {
  const cards = Array.from(document.querySelectorAll('[data-testid="product-card"], .product-card'));
  return cards
    .slice(0, 30)
    .map((card) => {
      const titleEl = card.querySelector("a.product-card-title, .product-card__name, h3");
      const linkEl = card.querySelector<HTMLAnchorElement>("a.product-card-title, a[href*='/products/'], a");
      const priceEl = card.querySelector(".price .c-pink, .product-card-price .price, [data-testid='price']");
      const oldEl = card.querySelector(".price .c-text-gray, .product-card-old-price");
      const ratingEl = card.querySelector(".star-rating, .product-card-rating");
      const reviewsEl = card.querySelector(".product-card-rating-count, .rating-count");
      const imgEl = card.querySelector<HTMLImageElement>("img.product-card-img, img");
      return {
        title: titleEl?.textContent?.trim() ?? "",
        url: linkEl?.getAttribute("href") ?? "",
        priceText: priceEl?.textContent?.trim() ?? "",
        oldPriceText: oldEl?.textContent?.trim() || undefined,
        ratingText: (ratingEl?.getAttribute("title") || ratingEl?.textContent) ?? undefined,
        reviewsText: reviewsEl?.textContent ?? undefined,
        imageUrl: imgEl?.src || undefined,
      };
    })
    .filter((r) => r.title && r.priceText);
}
