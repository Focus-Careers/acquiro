/**
 * Service for user operations via the backend API.
 * All Bubble calls are proxied through /api/bubble/* — BUBBLE_API_KEY never leaves the server.
 */

import { API_URL } from '../utils/apiUrl';
import { getAuthHeaders } from '../utils/authHeaders';

interface CreateUserPayload {
  lead_id: string;
  subscription_id?: string;
}

interface CreateUserResult {
  user_id: string;
}

export async function createUser(leadId: string, subscriptionId?: string): Promise<CreateUserResult | null> {
  try {
    if (!leadId) throw new Error('Lead ID is required to create user account');
    if (!API_URL) throw new Error('API URL configuration is missing.');

    const payload: CreateUserPayload = {
      lead_id: leadId,
      ...(subscriptionId && { subscription_id: subscriptionId }),
    };

    console.log('[userService] Creating user account for lead:', leadId);
    const response = await fetch(`${API_URL}/api/bubble/user/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    if (!response.ok) throw new Error(`create_user failed: ${response.status}: ${responseText}`);

    const data = JSON.parse(responseText) as { response?: { user_id?: string } };
    const userId = data.response?.user_id;
    if (!userId) throw new Error('Response missing user_id');

    console.log('[userService] User created, user_id:', userId);
    return { user_id: userId };
  } catch (error) {
    console.error('[userService] Failed to create user account:', error);
    throw error;
  }
}

// --- update_user (re-subscription) ---

export async function updateUser(userId: string, subscriptionId: string): Promise<void> {
  if (!userId || !subscriptionId) throw new Error('User ID and subscription ID are required');
  if (!API_URL) throw new Error('API URL configuration is missing.');

  const response = await fetch(`${API_URL}/api/bubble/user/${userId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ subscription_id: subscriptionId, is_subscribed: true }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`update_user failed: ${response.status} ${text}`);
  }
}

// --- unsubscribe_user ---

export async function unsubscribeUser(userId: string, cancelAt?: string | null): Promise<void> {
  if (!userId) throw new Error('User ID is required to unsubscribe');
  if (!API_URL) throw new Error('API URL configuration is missing.');

  const body: Record<string, unknown> = {};
  if (cancelAt != null && cancelAt.trim() !== '') {
    body.cancel_at = cancelAt.trim();
  }

  const response = await fetch(`${API_URL}/api/bubble/user/${userId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`unsubscribe_user failed: ${response.status} ${text}`);
  }
}

// --- get_user ---

export interface GetUserResult {
  name: string | null;
  email: string | null;
  isSubscribed: boolean;
  subscriptionId: string | null;
  cancelAt: string | null;
  isAdmin: boolean;
}

export async function getUser(userId: string): Promise<GetUserResult> {
  if (!userId) throw new Error('User ID is required to fetch user');
  if (!API_URL) throw new Error('API URL configuration is missing.');

  const response = await fetch(`${API_URL}/api/bubble/user/${userId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(`get_user failed: ${response.status} ${responseText}`);

  const data = JSON.parse(responseText) as {
    user_id?: string;
    name?: string | null;
    email?: string | null;
    is_subscribed?: boolean;
    subscription_id?: string | null;
    cancel_at?: string | null;
    is_admin?: boolean;
  };

  const subscriptionId = data.subscription_id?.trim() || null;
  const isSubscribed =
    data.is_subscribed === true ||
    (subscriptionId != null && subscriptionId.length > 0);
  const cancelAt = data.cancel_at?.trim() || null;

  return {
    name: data.name ?? null,
    email: data.email ?? null,
    isSubscribed,
    subscriptionId,
    cancelAt,
    isAdmin: data.is_admin === true,
  };
}

// --- get_user by email (login) ---

export interface GetUserByEmailResult {
  email: string;
  user_id: string;
  name: string | null;
}

export async function getUserByEmail(email: string): Promise<GetUserByEmailResult> {
  const trimmed = email?.trim();
  if (!trimmed) throw new Error('Email is required');
  if (!API_URL) throw new Error('API URL configuration is missing.');

  const response = await fetch(`${API_URL}/api/bubble/user/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: trimmed }),
  });

  const responseText = await response.text();
  if (response.status === 404) throw new Error('ACCOUNT_NOT_FOUND');
  if (!response.ok) throw new Error(`Lookup failed: ${response.status} ${responseText}`);

  const data = JSON.parse(responseText) as { user_id?: string; email?: string; name?: string | null };
  if (!data.user_id || !data.email) throw new Error('ACCOUNT_NOT_FOUND');

  return {
    email: data.email,
    user_id: data.user_id,
    name: data.name ?? null,
  };
}

// --- send_magic_link ---

export async function sendMagicLink(email: string): Promise<void> {
  const trimmed = email?.trim();
  if (!trimmed) throw new Error('Email is required');
  if (!API_URL) throw new Error('API URL configuration is missing.');

  const response = await fetch(`${API_URL}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: trimmed }),
  });

  if (!response.ok) throw new Error('SEND_MAGIC_LINK_ERROR');
}

// --- get_user by magic link (verify link) ---

export interface GetUserByMagicLinkResult {
  email: string;
  user_id: string;
  name: string | null;
  auth_token: string | null;
}

export async function getUserByMagicLink(link: string): Promise<GetUserByMagicLinkResult> {
  const trimmed = link?.trim();
  if (!trimmed) throw new Error('Link is required');
  if (!API_URL) throw new Error('API URL configuration is missing.');

  const response = await fetch(`${API_URL}/api/auth/verify?token=${encodeURIComponent(trimmed)}`);

  if (!response.ok) throw new Error('LINK_EXPIRED');

  const data = await response.json() as { user_id: string; email: string; name: string | null; auth_token?: string | null };
  if (!data.user_id || !data.email) throw new Error('LINK_EXPIRED');

  return {
    email: data.email,
    user_id: data.user_id,
    name: data.name ?? null,
    auth_token: data.auth_token ?? null,
  };
}
