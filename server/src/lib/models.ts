/**
 * Every model name the Acquiro backend uses, in one place, keyed by the rung of the lineup a call
 * sits on rather than by whichever model fills that rung today. Call sites never name a model.
 *
 *   fast     — was gpt-4o-mini: buyer-profile and match helpers in bubble.ts, website summaries
 *   standard — was gpt-5-mini:  the advisor chat behind /api/openai/stream
 *
 * The "openai/" prefix is part of the name: AI Gateway routes on it, so a bare "gpt-6-luna" is a
 * 404 rather than a fallback. Each can be overridden by env var without a deploy.
 */
export const MODELS = {
  fast: process.env.MODEL_FAST ?? 'openai/gpt-6-luna',
  standard: process.env.MODEL_STANDARD ?? 'openai/gpt-6.1-terra',
};
