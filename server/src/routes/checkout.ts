import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

const router = Router();

// Get Stripe instance dynamically to ensure env vars are loaded
const getStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(secretKey, {
    apiVersion: '2023-10-16',
  });
};

// Price IDs for Professional plan - get them dynamically from env vars
const getPriceIds = () => ({
  monthly: process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID,
  annual: process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID,
});

// Create embedded checkout session
router.post('/create-checkout-session', async (req: Request, res: Response) => {
  try {
    const { billingPeriod, userId, userEmail } = req.body;
    
    // Validate billing period
    if (!billingPeriod || (billingPeriod !== 'monthly' && billingPeriod !== 'annual')) {
      return res.status(400).json({ error: 'Invalid billing period. Must be "monthly" or "annual"' });
    }
    
    const PRICE_IDS = getPriceIds();
    const priceId = PRICE_IDS[billingPeriod as 'monthly' | 'annual'];
    
    if (!priceId) {
      console.error(`Price ID missing for ${billingPeriod}. Available:`, PRICE_IDS);
      console.error('Environment check:', {
        monthly: process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID,
        annual: process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID,
      });
      return res.status(500).json({ 
        error: `Price ID not configured for ${billingPeriod} billing period`,
        details: `Please set STRIPE_PROFESSIONAL_${billingPeriod.toUpperCase()}_PRICE_ID in your .env file`
      });
    }
    
    console.log(`Creating checkout session for ${billingPeriod} with price ID: ${priceId}`);
    
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: userEmail || undefined,
      metadata: {
        userId: userId || '',
        billingPeriod,
      },
      subscription_data: {
        metadata: {
          userId: userId || '',
        },
      },
      return_url: `${process.env.FRONTEND_URL}/subscription/complete?session_id={CHECKOUT_SESSION_ID}`,
    });
    
    res.json({ clientSecret: session.client_secret });
    
  } catch (error) {
    console.error('Checkout session error:', error);
    
    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Get session status
router.get('/session-status', async (req: Request, res: Response) => {
  try {
    const sessionId = req.query.session_id as string;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }
    
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    const leadId = (session.metadata?.userId as string) || null;
    const subscription =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id || null;

    res.json({
      status: session.status,
      customerEmail: session.customer_email,
      leadId: leadId || undefined,
      subscriptionId: subscription || undefined,
    });
    
  } catch (error) {
    console.error('Session status error:', error);
    
    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

// Cancel subscription at period end (user keeps access until period end)
router.post('/cancel-subscription', async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId || typeof subscriptionId !== 'string') {
      return res.status(400).json({ error: 'subscriptionId is required' });
    }

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.update(subscriptionId.trim(), {
      cancel_at_period_end: true,
    });

    res.json({
      success: true,
      currentPeriodEnd: subscription.current_period_end,
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * POST /api/checkout/webhook
 *
 * Stripe webhook — the authoritative source of subscription truth.
 * Handles three events:
 *
 *  checkout.session.completed   — user paid; mark subscribed even if tab was closed
 *  customer.subscription.updated — sync cancel_at_period_end and reactivations
 *  customer.subscription.deleted — failed payment / hard cancel → mark unsubscribed
 *
 * express.raw() is registered for this path in app.ts (before express.json()) so
 * that req.body is a Buffer — required by stripe.webhooks.constructEvent.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[webhook] Signature verification failed:', msg);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  console.log(`[webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(sub);
        break;
      }
      default:
        // Ignore other event types
        break;
    }
  } catch (err) {
    console.error(`[webhook] Error handling ${event.type}:`, err);
    // Return 200 anyway — Stripe will retry on 5xx, but this error is likely
    // a data issue we'd rather log than loop on.
    return res.json({ received: true, warning: 'Handler error — check logs' });
  }

  return res.json({ received: true });
});

/**
 * checkout.session.completed — ensure subscription state is set regardless of
 * whether the user's browser reached /subscription/complete.
 *
 * The session metadata.userId holds either:
 *  - a leadId  (new user paying for the first time)
 *  - a userId  (existing user re-subscribing)
 */
async function handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
  const metaId = session.metadata?.userId;
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!metaId || !subscriptionId) {
    console.warn('[webhook] checkout.session.completed: missing metaId or subscriptionId — skipping');
    return;
  }

  // 1. Check if metaId is an existing user (re-subscription)
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, subscription_id')
    .eq('id', metaId)
    .maybeSingle();

  if (existingUser) {
    // Idempotency: already has this subscription_id → nothing to do
    if (existingUser.subscription_id === subscriptionId) {
      console.log(`[webhook] checkout.session.completed: user ${existingUser.id} already up to date`);
      return;
    }
    await supabase.from('users').update({
      is_subscribed: true,
      subscription_id: subscriptionId,
      cancel_at: null,
    }).eq('id', existingUser.id);
    console.log(`[webhook] checkout.session.completed: updated subscription for user ${existingUser.id}`);
    return;
  }

  // 2. metaId is a leadId — new user who may or may not have hit CheckoutComplete
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, email, converted')
    .eq('id', metaId)
    .maybeSingle();

  if (!lead?.email) {
    console.warn(`[webhook] checkout.session.completed: no lead found for id ${metaId}`);
    return;
  }

  // If already converted, find the user and ensure subscription is set
  if (lead.converted) {
    const { data: linkedAgent } = await supabase
      .from('agents')
      .select('user_id')
      .eq('lead_id', metaId)
      .maybeSingle();

    if (linkedAgent?.user_id) {
      await supabase.from('users').update({
        is_subscribed: true,
        subscription_id: subscriptionId,
        cancel_at: null,
      }).eq('id', linkedAgent.user_id);
      console.log(`[webhook] checkout.session.completed: updated converted user ${linkedAgent.user_id}`);
    }
    return;
  }

  // New user — create auth account (same logic as POST /user/account)
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: lead.email,
    email_confirm: true,
  });
  if (authErr) {
    // If account already exists (e.g. CheckoutComplete already ran), find and update
    if (authErr.message.toLowerCase().includes('already') || authErr.message.toLowerCase().includes('exist')) {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('email', lead.email)
        .maybeSingle();
      if (existing) {
        await supabase.from('users').update({ is_subscribed: true, subscription_id: subscriptionId, cancel_at: null }).eq('id', existing.id);
        console.log(`[webhook] checkout.session.completed: found existing user ${existing.id}, updated subscription`);
      }
      return;
    }
    throw new Error(`Auth user creation failed: ${authErr.message}`);
  }

  const userId = authData.user.id;
  const userFields: Record<string, unknown> = { role: 'buyer', is_subscribed: true, subscription_id: subscriptionId };
  if (lead.name) userFields.name = lead.name;
  await supabase.from('users').update(userFields).eq('id', userId);

  // Link agent + buyer_info
  await Promise.all([
    supabase.from('agents').update({ user_id: userId }).eq('lead_id', metaId),
    supabase.from('buyer_info').update({ user_id: userId }).eq('lead_id', metaId),
  ]);
  await supabase.from('leads').update({ converted: true }).eq('id', metaId);

  console.log(`[webhook] checkout.session.completed: created user ${userId} from lead ${metaId}`);
}

/**
 * customer.subscription.updated — sync cancel_at_period_end and reactivations.
 * Subscription metadata.userId holds the user's ID.
 */
async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.userId;
  if (!userId) {
    console.warn('[webhook] customer.subscription.updated: no userId in metadata — skipping');
    return;
  }

  const update: Record<string, unknown> = {
    is_subscribed: sub.status === 'active' || sub.status === 'trialing',
    subscription_id: sub.id,
  };

  if (sub.cancel_at_period_end && sub.cancel_at) {
    // User cancelled but keeps access until period end
    update.cancel_at = new Date(sub.cancel_at * 1000).toISOString();
  } else {
    // Active or reactivated — clear any cancel_at
    update.cancel_at = null;
  }

  await supabase.from('users').update(update).eq('id', userId);
  console.log(`[webhook] customer.subscription.updated: synced user ${userId}, status=${sub.status}, cancel_at_period_end=${sub.cancel_at_period_end}`);
}

/**
 * customer.subscription.deleted — subscription fully ended (failed payment, hard cancel).
 * Mark the user as unsubscribed.
 */
async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.userId;
  if (!userId) {
    console.warn('[webhook] customer.subscription.deleted: no userId in metadata — skipping');
    return;
  }

  await supabase.from('users').update({
    is_subscribed: false,
    cancel_at: null,
  }).eq('id', userId);

  console.log(`[webhook] customer.subscription.deleted: marked user ${userId} as unsubscribed`);
}

export default router;
