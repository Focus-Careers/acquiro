/**
 * Pursue requests service — calls the Acquiro backend scraper proxy (/api/scraper/*).
 * The scraper admin key is held server-side only.
 */
import { getAuthHeaders } from '../utils/authHeaders';
import { API_URL } from '../utils/apiUrl';

const BASE = `${API_URL}/api/scraper`;

export interface PursueRequest {
  id: string;
  business_name: string;
  status: 'pending' | 'contacted' | 'responded' | 'closed';
  admin_notes: string;
  listing_url: string;
  created_at: string;
  user_id: string;
  business_id: string;
  user_name?: string | null;
  user_email?: string | null;
  business_description?: string | null;
  business_sector?: string | null;
  business_location?: string | null;
  business_asking_price?: number | null;
  business_turnover?: number | null;
  business_net_profit?: number | null;
}

export async function getPursueRequests(): Promise<PursueRequest[]> {
  const res = await fetch(`${BASE}/pursue-requests`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch pursue requests: ${res.status}`);
  const json = await res.json();
  return json.requests ?? [];
}

export async function markContacted(id: string): Promise<void> {
  const res = await fetch(`${BASE}/pursue-requests/${id}/contacted`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to mark contacted: ${res.status}`);
}

export async function markResponded(id: string): Promise<void> {
  const res = await fetch(`${BASE}/pursue-requests/${id}/responded`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to mark responded: ${res.status}`);
}

export async function markClosed(id: string): Promise<void> {
  const res = await fetch(`${BASE}/pursue-requests/${id}/closed`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to mark closed: ${res.status}`);
}

export async function updateNotes(id: string, notes: string): Promise<void> {
  const res = await fetch(`${BASE}/pursue-requests/${id}/notes`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error(`Failed to update notes: ${res.status}`);
}
