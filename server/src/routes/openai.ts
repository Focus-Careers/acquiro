import { Router, Request, Response } from 'express';
import { MODELS } from '../lib/models.js';
import { AI_BASE_URL, AI_REPORTING_TAGS, aiApiKey } from '../lib/openai.js';

const router = Router();

// Long enough for an advisor reply plus the model's reasoning, which counts against this budget;
// short enough that one request can't be made into an essay-length bill.
const MAX_OUTPUT_TOKENS = 8192;

type ChatTurn = { role: 'user' | 'assistant'; content: string };

function isChatTurns(value: unknown): value is ChatTurn[] {
  return Array.isArray(value) && value.length > 0 && value.every((t) =>
    t && typeof t === 'object'
    && (t.role === 'user' || t.role === 'assistant')
    && typeof t.content === 'string');
}

/**
 * POST /api/openai/stream
 *
 * Streams an advisor reply from the Responses API back to the client as SSE. The key never leaves
 * the server.
 *
 * Unauthenticated on purpose: the advisor builder at /builder is the public pre-signup flow. That
 * is exactly why the caller does not get to shape the upstream request. Only the conversation
 * (`input`) and the advisor brief (`instructions`) are taken from the body; the model, the output
 * budget and everything else are set here. A caller who sends `model` gets the advisor's model
 * regardless, so this cannot be used to reach an expensive one. Request size is already bounded by
 * express.json()'s 100kb default, and the route sits behind aiLimiter.
 */
router.post('/stream', async (req: Request, res: Response): Promise<void> => {
  const apiKey = aiApiKey();
  if (!apiKey) {
    res.status(500).json({ error: 'AI not configured on server' });
    return;
  }

  const { input, instructions } = (req.body ?? {}) as { input?: unknown; instructions?: unknown };
  if (!isChatTurns(input) || typeof instructions !== 'string' || !instructions.trim()) {
    res.status(400).json({ error: 'Expected { input: [{ role, content }], instructions: string }' });
    return;
  }

  let upstreamRes: globalThis.Response;
  try {
    upstreamRes = await fetch(`${AI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'ai-reporting-tags': AI_REPORTING_TAGS,
      },
      body: JSON.stringify({
        model: MODELS.standard,
        input,
        instructions,
        stream: true,
        max_output_tokens: MAX_OUTPUT_TOKENS,
      }),
    });
  } catch (err) {
    console.error('[ai proxy] Fetch error:', err);
    res.status(502).json({ error: 'Failed to reach the model' });
    return;
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => '');
    console.error(`[ai proxy] Upstream error ${upstreamRes.status}:`, text.substring(0, 200));
    res.status(upstreamRes.status).send(text);
    return;
  }

  if (!upstreamRes.body) {
    res.status(502).json({ error: 'Empty response body from the model' });
    return;
  }

  // Pipe the SSE stream straight through to the client
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    console.error('[ai proxy] Stream error:', err);
  } finally {
    reader.releaseLock();
    res.end();
  }
});

export default router;
