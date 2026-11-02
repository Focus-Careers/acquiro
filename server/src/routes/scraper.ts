/**
 * Scraper admin proxy — server-side only.
 *
 * Forwards requests to the acquiro-scraper service using SCRAPER_ADMIN_KEY
 * from server env. The key is NEVER exposed to the browser bundle.
 *
 * All routes require requireAdmin (JWT + is_admin DB check).
 */

import { Router, Request, Response } from 'express';
import { requireAdmin, requireAuth } from '../middleware/requireAuth.js';
import { supabase } from '../lib/supabase.js';

// A signed NDA is a document, not a dataset. Anything larger is refused before it is buffered.
const MAX_NDA_BYTES = 10 * 1024 * 1024;

const router = Router();

function getScraperBase(): string {
  const base = process.env.SCRAPER_URL;
  if (!base) throw new Error('SCRAPER_URL env var is not set');
  return base.replace(/\/+$/, '');
}

function getScraperKey(): string {
  const key = process.env.SCRAPER_ADMIN_KEY;
  if (!key) throw new Error('SCRAPER_ADMIN_KEY env var is not set');
  return key;
}

function scraperHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getScraperKey()}`,
  };
}

/** Generic proxy helper — forwards method + body, returns scraper JSON response */
async function proxyToScraper(
  req: Request,
  res: Response,
  scraperPath: string,
  method: string = req.method,
): Promise<void> {
  const base = getScraperBase();
  const hasBody = ['POST', 'PATCH', 'PUT'].includes(method.toUpperCase());
  const upstream = await fetch(`${base}${scraperPath}`, {
    method,
    headers: scraperHeaders(),
    ...(hasBody ? { body: JSON.stringify(req.body) } : {}),
  });

  const text = await upstream.text();
  res.status(upstream.status).set('Content-Type', 'application/json').send(text);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

router.get('/status', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/status', 'GET'));
router.post('/scheduler/enable', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/scheduler/enable'));
router.post('/scheduler/disable', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/scheduler/disable'));
router.post('/run-pipeline', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/run-pipeline'));
router.post('/run-scrape', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/run-scrape'));
router.post('/run-matches', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/run-matches'));

// ── Pursue requests ───────────────────────────────────────────────────────────

router.get('/pursue-requests', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/pursue-requests', 'GET'));
router.post('/pursue-requests/:id/contacted', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/pursue-requests/${req.params.id}/contacted`));
router.post('/pursue-requests/:id/responded', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/pursue-requests/${req.params.id}/responded`));
router.post('/pursue-requests/:id/closed', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/pursue-requests/${req.params.id}/closed`));
router.patch('/pursue-requests/:id/notes', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/pursue-requests/${req.params.id}/notes`, 'PATCH'));

// ── Langcliffe queue ──────────────────────────────────────────────────────────

router.get('/langcliffe-queue', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/langcliffe-queue', 'GET'));
router.post('/langcliffe-queue/:id/approve', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/langcliffe-queue/${req.params.id}/approve`));
router.post('/langcliffe-queue/:id/delete', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/langcliffe-queue/${req.params.id}/delete`));
router.post('/langcliffe-queue/:id/approve-reply', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/langcliffe-queue/${req.params.id}/approve-reply`));
router.post('/langcliffe-queue/:id/reject-reply', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/langcliffe-queue/${req.params.id}/reject-reply`));
router.post('/langcliffe-queue/:id/approve-ack', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/langcliffe-queue/${req.params.id}/approve-ack`));
router.post('/langcliffe-queue/:id/approve-nda-return', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/langcliffe-queue/${req.params.id}/approve-nda-return`));
router.post('/langcliffe-queue/:id/reject', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/langcliffe-queue/${req.params.id}/reject`));

// ── Feature announcements ─────────────────────────────────────────────────────

router.get('/feature-announcements', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/feature-announcements', 'GET'));
router.post('/feature-announcements', requireAdmin, (req, res) => proxyToScraper(req, res, '/admin/feature-announcements'));
router.patch('/feature-announcements/:id', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/feature-announcements/${req.params.id}`, 'PATCH'));
router.get('/feature-announcements/:id/stats', requireAdmin, (req, res) => proxyToScraper(req, res, `/admin/feature-announcements/${req.params.id}/stats`, 'GET'));

// ── NDA upload (user-facing, not admin) ──────────────────────────────────────
// Any authenticated user can upload their own signed NDA.
// We proxy the multipart request through, forwarding the raw body and
// Content-Type (including the multipart boundary) to the scraper.

router.post('/outreach/:outreachId/signed-nda', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const base = getScraperBase();
  const { outreachId } = req.params;

  // The scraper call below carries the ADMIN key, so the scraper will act on any outreach it is
  // given. Ownership has to be settled here, before anything is forwarded: the caller may only
  // attach an NDA to their own outreach. A foreign id answers 404, the same as a missing one.
  const { data: owned } = await supabase
    .from('langcliffe_outreach')
    .select('id')
    .eq('id', outreachId)
    .eq('user_id', req.userId)
    .maybeSingle();
  if (!owned) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Collect the raw request body chunks and forward with original Content-Type. Past the cap the
  // chunks are dropped rather than kept, but the stream is still read to the end before answering:
  // responding mid-upload leaves a client that is still sending unable to read the reply.
  // (On Vercel the platform's own 4.5MB body limit applies first; this bounds memory elsewhere.)
  const chunks: Buffer[] = [];
  let received = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received <= MAX_NDA_BYTES) chunks.push(chunk);
      else chunks.length = 0;
    });
    req.on('end', resolve);
    req.on('error', reject);
  });
  if (received > MAX_NDA_BYTES) {
    res.status(413).json({ error: 'File too large' });
    return;
  }
  const body = Buffer.concat(chunks);

  const upstream = await fetch(`${base}/user/outreach/${outreachId}/signed-nda`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getScraperKey()}`,
      // Forward Content-Type so the scraper sees the correct multipart boundary
      'Content-Type': req.headers['content-type'] ?? 'application/octet-stream',
    },
    body,
  });

  const text = await upstream.text();
  res.status(upstream.status).set('Content-Type', 'application/json').send(text);
});

export default router;
