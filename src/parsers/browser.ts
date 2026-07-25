// Shared browser lifecycle for Puppeteer parsers.
// We launch a fresh browser per parse job (one tab), routed through a proxy
// from the pool, with a hard navigation timeout. Browsers are closed in a
// `finally` block by the caller. Anti-bot hardening flags are applied.

import puppeteer, { type Browser, type LaunchOptions } from "puppeteer";
import type { ProxyPool } from "./proxy-pool.js";
import { logger } from "../utils/logger.js";

export interface ParseOptions {
  proxyPool: ProxyPool;
  timeoutMs: number;
  // if true, never use a proxy (e.g. for local debugging)
  noProxy?: boolean;
}

export async function launchRoutedBrowser(
  opts: ParseOptions,
): Promise<{ browser: Browser; proxy: string | null }> {
  const proxy = opts.noProxy ? null : await opts.proxyPool.acquire();
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--lang=ru-RU,ru",
  ];
  if (proxy) args.push(`--proxy-server=${proxy}`);
  const launchOpts: LaunchOptions = {
    headless: true,
    args,
    defaultViewport: { width: 1366, height: 900 },
  };
  const browser = await puppeteer.launch(launchOpts);
  // stealth: overwrite webdriver flag on every new page
  browser.on("targetcreated", async (target) => {
    const page = await target.page().catch(() => null);
    if (page) {
      await page
        .evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        })
        .catch(() => undefined);
    }
  });
  logger.debug({ proxy }, "Launched browser");
  return { browser, proxy };
}

export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // ignore
  }
}
