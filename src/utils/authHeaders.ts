/**
 * Returns headers for authenticated API calls.
 *
 * Always includes Content-Type. Adds Authorization: Bearer <token> when
 * an authToken is present in the store (i.e. user is logged in).
 *
 * Usage:
 *   fetch(url, { method: 'GET', headers: getAuthHeaders() })
 */
import { useAdvisorStore } from '../hooks/useAdvisorStore';

export function getAuthHeaders(): Record<string, string> {
  const token = useAdvisorStore.getState().authToken;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}
