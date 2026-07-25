// Parser registry. The worker constructs parsers here (Puppeteer is heavy,
// so we keep them out of the bot process).

import type { Source } from "../types.js";
import { PARSER_SOURCES } from "../types.js";
import type { MarketplaceParser } from "./base.js";
import { MVideoParser } from "./mvideo.parser.js";
import { DnsParser } from "./dns.parser.js";
import { CitilinkParser } from "./citilink.parser.js";

const parsers: Record<string, MarketplaceParser> = {
  mvideo: new MVideoParser(),
  dns: new DnsParser(),
  citilink: new CitilinkParser(),
};

export function getParser(source: Source): MarketplaceParser | null {
  if (!PARSER_SOURCES.includes(source)) return null;
  return parsers[source] ?? null;
}

export function getAllParsers(): MarketplaceParser[] {
  return PARSER_SOURCES.map((s) => parsers[s]).filter(Boolean) as MarketplaceParser[];
}

export { type MarketplaceParser } from "./base.js";
