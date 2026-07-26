// OpenAI service: parameter extraction (GPT-4o-mini), image recognition
// (Vision), and embeddings for deduplication. All three are cached in Redis:
// text params by text hash (1h), vision results by image hash (permanent),
// embeddings by text hash (24h, internal).

import OpenAI from "openai";
import { env } from "../config/env.js";
import type { ParsedQuery } from "../types.js";
import { Cache, hashStr, hashBuffer } from "../utils/cache.js";
import { logger } from "../utils/logger.js";

const VISION_TIMEOUT_MS = 3000; // spec: fall back to text on timeout

export class OpenAIService {
  private client: OpenAI;
  private cache: Cache;

  constructor(cache?: Cache) {
    this.client = new OpenAI({
  apiKey: env.openaiApiKey,
  baseURL: env.openaiBaseUrl || undefined,
  timeout: 10_000,
  maxRetries: 1,
});
    this.cache = cache ?? new Cache();
  }

  // Extract structured parameters from a free-text search query.
  async extractParams(text: string): Promise<ParsedQuery> {
    const key = this.cache.llmParamsKey(text);
    const cached = await this.cache.getJson<ParsedQuery>(key);
    if (cached) return cached;

    const prompt = `Извлеки параметры товара из поискового запроса пользователя.
Верни СТРОГО JSON без markdown с полями:
brand (строка или null), model (строка или null), category (строка или null),
attributes (объект ключ-значение или null), minPrice (число или null), maxPrice (число или null).
Запрос: "${text.replace(/"/g, "")}"`;

    try {
      const completion = await this.client.chat.completions.create({
        model: env.aiChatModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Ты помогаешь извлекать структурированные параметры товаров для поиска." },
          { role: "user", content: prompt },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as Partial<ParsedQuery>;
      const result: ParsedQuery = {
        brand: parsed.brand ?? undefined,
        model: parsed.model ?? undefined,
        category: parsed.category ?? undefined,
        attributes: parsed.attributes ?? undefined,
        minPrice: parsed.minPrice ?? undefined,
        maxPrice: parsed.maxPrice ?? undefined,
        raw: text,
      };
      await this.cache.setJson(key, result, this.cache.llmTtl());
      return result;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "LLM extract failed, using raw");
      return { raw: text };
    }
  }

  // Recognize a product from a photo. Returns a short text query the user
  // can confirm, or null if recognition fails / times out (3s).
  async recognizeImage(imageBase64: string, mimeType = "image/jpeg"): Promise<string | null> {
    const imageHash = hashBuffer(Buffer.from(imageBase64, "base64"));
    const key = this.cache.visionKey(imageHash);
    const cached = await this.cache.getJson<string>(key);
    if (cached !== null) return cached;

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), VISION_TIMEOUT_MS);
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: env.aiChatModel,
          temperature: 0,
          max_tokens: 60,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Что изображено на фото? Назови товар кратко на русском (до 6 слов), без лишних слов." },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
              ],
            },
          ],
        },
        { signal: ac.signal },
      );
      const text = completion.choices[0]?.message?.content?.trim() ?? null;
      if (text) await this.cache.setJsonPermanent(key, text);
      return text;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Vision recognition failed/timed out");
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Embedding for a product title (used by deduplicator). Cached 24h.
  async embedTitle(title: string): Promise<number[]> {
    const key = `cache:emb:${hashStr(title)}`;
    const cached = await this.cache.getJson<number[]>(key);
    if (cached) return cached;
    const res = await this.client.embeddings.create({ model: env.aiEmbedModel, input: title });
    const vec = res.data[0]?.embedding ?? [];
    await this.cache.setJson(key, vec, 86400);
    return vec;
  }
}

let instance: OpenAIService | null = null;
export function getOpenAI(): OpenAIService {
  if (!instance) instance = new OpenAIService();
  return instance;
}
