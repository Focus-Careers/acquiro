import { Router, Request, Response } from 'express';

const router = Router();

// Models this proxy is allowed to call. Prevents callers from requesting
// expensive models (e.g. o1, gpt-4-turbo) and draining OpenAI quota.
const ALLOWED_MODELS = new Set([
  'gpt-5-mini',
  'gpt-4o-mini',
  'gpt-4o',
]);

/**
 * POST /api/openai/stream
 *
 * Proxies a request to the OpenAI Responses API and pipes the SSE stream
 * back to the client. The API key never leaves the server.
 *
 * Body: the full OpenAI Responses API payload (model, input, instructions, stream, etc.)
 */
router.post('/stream', async (req: Request, res: Response): Promise<void> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OpenAI not configured on server' });
    return;
  }

  // Enforce model allowlist — reject anything outside the approved set
  const requestedModel = req.body?.model as string | undefined;
  if (!requestedModel || !ALLOWED_MODELS.has(requestedModel)) {
    res.status(400).json({ error: `Model not allowed. Permitted: ${[...ALLOWED_MODELS].join(', ')}` });
    return;
  }

  let upstreamRes: globalThis.Response;
  try {
    upstreamRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    });
  } catch (err) {
    console.error('[openai proxy] Fetch error:', err);
    res.status(502).json({ error: 'Failed to reach OpenAI' });
    return;
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => '');
    console.error(`[openai proxy] OpenAI error ${upstreamRes.status}:`, text.substring(0, 200));
    res.status(upstreamRes.status).send(text);
    return;
  }

  if (!upstreamRes.body) {
    res.status(502).json({ error: 'Empty response body from OpenAI' });
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
    console.error('[openai proxy] Stream error:', err);
  } finally {
    reader.releaseLock();
    res.end();
  }
});

export default router;
