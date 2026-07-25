// Product deduplicator. Combines identical products found across different
// sources. Strategy:
//   1. Normalize brand + model + key attrs → canonical key. Exact match merges.
//   2. Optional: cosine similarity of OpenAI title embeddings > 0.9 → merge.
// Merging keeps the cheapest variant and records all source URLs.

import type { Product } from "../types.js";
import { getOpenAI } from "../services/openai.service.js";
import { logger } from "./logger.js";

interface Deduped extends Product {
  duplicates?: { source: string; priceRub: number; url: string }[];
}

function canonicalKey(p: Product): string {
  const brand = (p.brand ?? "").toLowerCase().trim();
  const model = (p.model ?? p.title ?? "").toLowerCase().trim();
  const attrs = p.attributes
    ? Object.entries(p.attributes)
        .map(([k, v]) => `${k.toLowerCase()}=${v.toLowerCase()}`)
        .sort()
        .join("|")
    : "";
  return `${brand}::${model}::${attrs}`;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) * (a[i] ?? 0);
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export class Deduplicator {
  // useEmbeddings defaults off to keep latency low; admin can enable.
  async dedupe(products: Product[], useEmbeddings = false): Promise<Deduped[]> {
    const byKey = new Map<string, Deduped>();
    for (const p of products) {
      const k = canonicalKey(p);
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, { ...p, duplicates: [] });
        continue;
      }
      this.mergeInto(existing, p);
    }

    let out: Deduped[] = [...byKey.values()];

    if (useEmbeddings && out.length > 1) {
      try {
        const openai = getOpenAI();
        const vecs = await Promise.all(out.map((p) => openai.embedTitle(p.title)));
        const merged = new Array<boolean>(out.length).fill(false);
        const result: Deduped[] = [];
        for (let i = 0; i < out.length; i++) {
          if (merged[i]) continue;
          let cur = out[i] as Deduped;
          for (let j = i + 1; j < out.length; j++) {
            if (merged[j]) continue;
            if (cosine(vecs[i] ?? [], vecs[j] ?? []) > 0.9) {
              const other = out[j] as Deduped;
              cur = this.mergeKeep(cur, other);
              merged[j] = true;
            }
          }
          result.push(cur);
        }
        out = result;
      } catch (err) {
        logger.warn({ err: (err as Error).message }, "embedding dedup failed, skipping");
      }
    }

    return out;
  }

  private mergeInto(target: Deduped, src: Product): void {
    if (src.priceRub < target.priceRub) {
      target.duplicates?.push({ source: target.source, priceRub: target.priceRub, url: target.url });
      target.priceRub = src.priceRub;
      target.url = src.url;
      target.affiliateUrl = src.affiliateUrl ?? target.affiliateUrl;
      target.source = src.source;
    } else {
      target.duplicates?.push({ source: src.source, priceRub: src.priceRub, url: src.url });
    }
  }

  private mergeKeep(a: Deduped, b: Deduped): Deduped {
    const keep = a.priceRub <= b.priceRub ? a : b;
    const other = a.priceRub <= b.priceRub ? b : a;
    return {
      ...keep,
      duplicates: [...(keep.duplicates ?? []), { source: other.source, priceRub: other.priceRub, url: other.url }],
    };
  }
}
