// Shared domain types used across services, parsers, queues and bot handlers.
// Keeping them in one place avoids circular imports between layers.

export type Source = "wildberries" | "ozon" | "aliexpress" | "mvideo" | "dns" | "citilink";

export const ALL_SOURCES: Source[] = [
  "wildberries",
  "ozon",
  "aliexpress",
  "mvideo",
  "dns",
  "citilink",
];

export const API_SOURCES: Source[] = ["wildberries", "ozon", "aliexpress"];
export const PARSER_SOURCES: Source[] = ["mvideo", "dns", "citilink"];

// Delivery bucket shown to the user as an emoji.
export type DeliveryCategory = "fast" | "medium" | "slow" | "abroad";

export const DELIVERY_LABEL: Record<DeliveryCategory, string> = {
  fast: "🟢 Доставка 0–1 день",
  medium: "🟡 Доставка 2–4 дня",
  slow: "🔴 Доставка 5+ дней",
  abroad: "✈️ Доставка из-за рубежа 14–30 дней",
};

// A normalized product coming out of any source. Parsers and API clients
// all return this shape so deduplication and rendering can be source-agnostic.
export interface Product {
  id: string;
  source: Source;
  title: string;
  brand?: string;
  model?: string;
  category?: string;
  attributes?: Record<string, string>;
  priceRub: number;
  oldPriceRub?: number;
  rating?: number;
  reviewsCount?: number;
  url: string;
  affiliateUrl?: string;
  imageUrl?: string;
  cityFrom?: string;
  deliveryDays?: number;
  deliveryCategory: DeliveryCategory;
  inStock?: boolean;
}

// Parameters extracted by the LLM from free-text queries.
export interface ParsedQuery {
  brand?: string;
  model?: string;
  category?: string;
  attributes?: Record<string, string>;
  minPrice?: number;
  maxPrice?: number;
  raw: string;
}

export interface SearchRequest {
  userId: bigint;
  telegramId: bigint;
  city: string | null;
  query: string;
  parsed: ParsedQuery;
  photoFileId?: string;
  // pagination offset for "show more"
  offset: number;
}

export interface SearchResults {
  requestId: string;
  query: string;
  city: string | null;
  parsed: ParsedQuery;
  products: Product[];
  fetchedAt: number; // epoch ms
  fromCache: boolean;
  cacheAgeMs?: number;
  failedSources: Source[];
}

export interface PriceCheckResult {
  productId: string;
  source: Source;
  currentPriceRub: number | null;
  url: string;
}

// Settings stored in the `settings` table, editable via admin chat.
export interface AdminSettings {
  enabledSources: Source[];
  deliveryThresholds: {
    fastMaxDays: number;
    mediumMaxDays: number;
  };
  proxyList: string[];
  buyButtonVariants: string[]; // A/B test labels for "Купить"
}
