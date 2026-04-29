import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

/** Strip HTML tags and collapse whitespace to get readable plain text */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * POST /api/integrations/summarise-website
 * Body: { url: string }
 * Returns: { summary: string }
 */
router.post('/summarise-website', async (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only http/https URLs are allowed' });
  }

  // Block SSRF: reject requests to loopback, link-local, and private IP ranges.
  // This prevents using the server as a proxy to fetch cloud metadata (169.254.169.254),
  // internal services, or localhost — a classic Server-Side Request Forgery attack.
  const PRIVATE_HOST_PATTERN = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|\[::1\]|169\.254\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)$/i;
  if (PRIVATE_HOST_PATTERN.test(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'URL is not allowed' });
  }

  let pageText: string;
  try {
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AcquiroBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!pageRes.ok) {
      return res.status(422).json({ error: `Could not fetch the website (HTTP ${pageRes.status})` });
    }
    const html = await pageRes.text();
    pageText = stripHtml(html).slice(0, 6000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(422).json({ error: `Could not reach the website: ${msg}` });
  }

  if (!pageText.trim()) {
    return res.status(422).json({ error: 'Could not extract readable content from the website' });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are helping a business acquirer set up their acquisition advisor profile. Based on website content, write a concise company overview (3-5 sentences) that describes what the company does, its sector, and any notable attributes relevant to an M&A context. Write in the third person. Plain text only, no bullet points.`,
        },
        {
          role: 'user',
          content: `Website content from ${parsedUrl.hostname}:\n\n${pageText}`,
        },
      ],
      temperature: 0.3,
    });

    const summary = completion.choices[0].message.content?.trim() ?? '';
    return res.json({ summary });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `AI summary failed: ${msg}` });
  }
});

export default router;
