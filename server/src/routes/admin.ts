import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { requireAdmin } from '../middleware/requireAuth.js';

const router = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key, { apiVersion: '2023-10-16' });
}

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/convai';

function getElevenLabsKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured');
  return key;
}

/**
 * GET /api/admin/mrr
 * Returns current MRR from Stripe (sum of active subscription amounts, normalized to monthly).
 */
router.get('/mrr', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    let totalCents = 0;
    const currency: Record<string, boolean> = {};
    for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100 })) {
      for (const item of sub.items.data) {
        const plan = item.plan;
        if (!plan || !plan.amount) continue;
        let monthlyCents = plan.amount;
        if (plan.interval === 'year') monthlyCents = Math.round(plan.amount / 12);
        else if (plan.interval === 'week') monthlyCents = Math.round((plan.amount * 52) / 12);
        else if (plan.interval === 'day') monthlyCents = Math.round((plan.amount * 365) / 12);
        totalCents += monthlyCents * (item.quantity ?? 1);
        if (plan.currency) currency[plan.currency] = true;
      }
    }
    const curr = Object.keys(currency)[0] || 'gbp';
    res.json({ mrr_cents: totalCents, currency: curr });
  } catch (err) {
    console.error('[admin] MRR error:', err);
    if (err instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to compute MRR' });
  }
});

/**
 * GET /api/admin/revenue
 * Returns current_mrr (cents) and monthly_revenue for the last 6 months from paid invoices.
 * Monthly revenue: sum of paid invoice amounts grouped by month.
 */
router.get('/revenue', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const stripe = getStripe();
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const startUnix = Math.floor(sixMonthsAgo.getTime() / 1000);

    const monthlyRevenue: Record<string, number> = {};
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const key = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      monthlyRevenue[key] = 0;
    }

    for await (const inv of stripe.invoices.list({
      status: 'paid',
      created: { gte: startUnix },
      limit: 100,
    })) {
      if (inv.amount_paid != null && inv.status === 'paid' && inv.created) {
        const d = new Date(inv.created * 1000);
        const key = d.toLocaleString('default', { month: 'short', year: 'numeric' });
        if (key in monthlyRevenue) {
          monthlyRevenue[key] += inv.amount_paid;
        }
      }
    }

    let currentMrrCents = 0;
    for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100 })) {
      for (const item of sub.items.data) {
        const plan = item.plan;
        if (!plan?.amount) continue;
        let monthlyCents = plan.amount;
        if (plan.interval === 'year') monthlyCents = Math.round(plan.amount / 12);
        else if (plan.interval === 'week') monthlyCents = Math.round((plan.amount * 52) / 12);
        else if (plan.interval === 'day') monthlyCents = Math.round((plan.amount * 365) / 12);
        currentMrrCents += monthlyCents * (item.quantity ?? 1);
      }
    }

    const monthOrder: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      monthOrder.push(d.toLocaleString('default', { month: 'short', year: 'numeric' }));
    }
    const monthly_revenue = monthOrder.map((month) => ({
      month,
      revenue: monthlyRevenue[month],
    }));

    res.json({ current_mrr: currentMrrCents, monthly_revenue });
  } catch (err) {
    console.error('[admin] revenue error:', err);
    if (err instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to fetch revenue' });
  }
});

/**
 * GET /api/admin/conversations?cursor=&page_size=20&agent_id=
 * Proxies to ElevenLabs Conversational AI API to list conversations.
 */
router.get('/conversations', requireAdmin, async (req: Request, res: Response) => {
  try {
    const apiKey = getElevenLabsKey();
    const cursor = req.query.cursor as string | undefined;
    const pageSize = req.query.page_size ? String(req.query.page_size) : '20';
    const agentId = req.query.agent_id as string | undefined;
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('page_size', pageSize);
    if (agentId) params.set('agent_id', agentId);
    const url = `${ELEVENLABS_API_URL}/conversations?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text();
      console.error('[admin] ElevenLabs conversations list error:', response.status, text);
      return res.status(response.status).json({ error: text || 'ElevenLabs API error' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[admin] conversations list error:', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * GET /api/admin/conversations/:id
 * Proxies to ElevenLabs to get a single conversation (including transcript).
 */
router.get('/conversations/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const apiKey = getElevenLabsKey();
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Conversation ID required' });
    const url = `${ELEVENLABS_API_URL}/conversations/${id}`;
    const response = await fetch(url, {
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404) return res.status(404).json({ error: 'Conversation not found' });
      console.error('[admin] ElevenLabs conversation get error:', response.status, text);
      return res.status(response.status).json({ error: text || 'ElevenLabs API error' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[admin] conversation get error:', err);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

export default router;
