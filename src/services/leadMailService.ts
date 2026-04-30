/**
 * Service for sending lead retention emails via the backend API.
 */

import { API_URL } from '../utils/apiUrl';
import { getAuthHeaders } from '../utils/authHeaders';

export function sendLeadMail(leadId: string): void {
  // sendBeacon cannot send custom headers; use fetch with keepalive instead.
  // This endpoint requires admin auth (requireAdmin), so the token must be in headers.
  const url = `${API_URL}/api/bubble/lead/mail`;
  fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ lead_id: leadId }),
    keepalive: true,
  }).then(() => {
    console.log('[leadMailService] Retention email queued for lead:', leadId);
  }).catch((error) => {
    console.error('[leadMailService] Failed to queue lead mail:', error);
  });
}

const SENT_KEY_PREFIX = 'acquiro_lead_mail_sent_';

export function hasSentLeadMail(leadId: string): boolean {
  try {
    return sessionStorage.getItem(`${SENT_KEY_PREFIX}${leadId}`) === '1';
  } catch {
    return false;
  }
}

export function markLeadMailSent(leadId: string): void {
  try {
    sessionStorage.setItem(`${SENT_KEY_PREFIX}${leadId}`, '1');
  } catch {
    // ignore
  }
}
