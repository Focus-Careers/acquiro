import OpenAI from 'openai';

/**
 * Where model traffic goes, decided once. Every route uses these rather than reading a key or
 * building a client of its own.
 *
 * It goes through Vercel AI Gateway rather than straight to OpenAI: one bill across the products,
 * Acquiro spend separable in gateway reporting, and a model change that costs an env var. Still the
 * OpenAI wire format, so call sites didn't change shape. Model names live in ./models.
 *
 * The base URL is an env var rather than a literal because it is the rollback: point it at another
 * OpenAI-compatible endpoint, set the key and the model names to match, redeploy.
 */
export const AI_BASE_URL = (process.env.AI_GATEWAY_BASE_URL ?? 'https://ai-gateway.vercel.sh/v1').replace(/\/+$/, '');

/** Separates Acquiro's backend spend from the scraper's, and from the other products. */
export const AI_REPORTING_TAGS = 'service:acquiro';

export function aiApiKey(): string | undefined {
  return process.env.AI_GATEWAY_API_KEY;
}

let client: OpenAI | null = null;

/**
 * The shared SDK client, built on first use so a missing key fails the request that needed it
 * rather than the whole function at import.
 */
export function ai(): OpenAI {
  const apiKey = aiApiKey();
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY not configured');
  if (!client) {
    client = new OpenAI({ apiKey, baseURL: AI_BASE_URL, defaultHeaders: { 'ai-reporting-tags': AI_REPORTING_TAGS } });
  }
  return client;
}
