import { API_URL } from '../utils/apiUrl';
import { getAuthHeaders } from '../utils/authHeaders';

export interface CreateCheckoutSessionParams {
  billingPeriod: 'monthly' | 'annual';
  userId?: string;
  userEmail?: string;
}

export interface CheckoutSessionResponse {
  clientSecret: string;
}

export interface SessionStatusResponse {
  status: string;
  customerEmail?: string;
  /** Lead ID stored in checkout session metadata (survives redirect from Stripe) */
  leadId?: string;
  /** Stripe subscription ID created by this checkout session */
  subscriptionId?: string;
}

/**
 * Create a Stripe checkout session
 */
export async function createCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<CheckoutSessionResponse> {
  const response = await fetch(`${API_URL}/api/checkout/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create checkout session' }));
    throw new Error(error.error || 'Failed to create checkout session');
  }

  return response.json();
}

/**
 * Cancel subscription at period end (user keeps access until current period ends).
 * Calls backend which uses Stripe API with secret key.
 * Returns currentPeriodEnd (Unix timestamp) for the frontend to store and display.
 */
export async function cancelSubscription(subscriptionId: string): Promise<{
  success: true;
  currentPeriodEnd: number;
}> {
  if (!subscriptionId) {
    throw new Error('Subscription ID is required');
  }
  const response = await fetch(`${API_URL}/api/checkout/cancel-subscription`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ subscriptionId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to cancel subscription' }));
    throw new Error(error.error || 'Failed to cancel subscription');
  }
  return response.json();
}

/**
 * Get checkout session status
 */
export async function getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
  const response = await fetch(`${API_URL}/api/checkout/session-status?session_id=${sessionId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get session status' }));
    throw new Error(error.error || 'Failed to get session status');
  }

  return response.json();
}
