/**
 * Scraper admin proxy — server-side only.
 *
 * Forwards requests to the acquiro-scraper service using SCRAPER_ADMIN_KEY
 * from server env. The key is NEVER exposed to the browser bundle.
 *
 * All routes require requireAdmin (JWT + is_admin DB check).
 */

import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/requireAuth.js';

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

export default router;
