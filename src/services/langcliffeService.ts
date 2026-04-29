/**
 * Langcliffe outreach queue service — calls the Acquiro backend scraper proxy (/api/scraper/*).
 * The scraper admin key is held server-side only.
 */
import { getAuthHeaders } from '../utils/authHeaders';
import { API_URL } from '../utils/apiUrl';

const BASE = `${API_URL}/api/scraper`;

export interface OutreachDraft {
  id: string;
  listing_id: string;
  business_name: string;
  langcliffe_contact: string;
  user_email?: string;
  user_id: string;
  draft_body: string;
  inbound_email?: string;
  reply_draft?: string;
  langcliffe_reply_body?: string;
  conversation_history?: string;
  nda_file?: string;
  signed_nda_file?: string;
  acknowledgment_draft?: string;
  nda_return_draft?: string;
  status: 'pending' | 'sent' | 'rejected' | 'pending_reply' | 'nda_received' | 'nda_acknowledged' | 'nda_signed' | 'nda_returned' | 'misc';
  created_at: string;
}

export async function getLangcliffeQueue(): Promise<OutreachDraft[]> {
  const res = await fetch(`${BASE}/langcliffe-queue`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Queue fetch failed: ${res.status}`);
  const json = await res.json();
  return json.queue ?? [];
}

export async function approveOutreach(id: string): Promise<void> {
  const res = await fetch(`${BASE}/langcliffe-queue/${id}/approve`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Approve failed: ${res.status}`);
}

export async function deleteOutreach(id: string): Promise<void> {
  const res = await fetch(`${BASE}/langcliffe-queue/${id}/delete`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function approveReply(id: string): Promise<void> {
  const res = await fetch(`${BASE}/langcliffe-queue/${id}/approve-reply`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Approve reply failed: ${res.status}`);
}

export async function rejectReply(id: string, feedback?: string): Promise<string> {
  const res = await fetch(`${BASE}/langcliffe-queue/${id}/reject-reply`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ feedback }),
  });
  if (!res.ok) throw new Error(`Reject reply failed: ${res.status}`);
  const json = await res.json();
  return json.draft ?? '';
}

export async function approveAcknowledgment(id: string): Promise<void> {
  const res = await fetch(`${BASE}/langcliffe-queue/${id}/approve-ack`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Approve acknowledgment failed: ${res.status}`);
}

export async function approveNDAReturn(id: string): Promise<void> {
  const res = await fetch(`${BASE}/langcliffe-queue/${id}/approve-nda-return`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Approve NDA return failed: ${res.status}`);
}

export async function rejectOutreach(id: string, feedback?: string): Promise<string> {
  const res = await fetch(`${BASE}/langcliffe-queue/${id}/reject`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ feedback }),
  });
  if (!res.ok) throw new Error(`Reject failed: ${res.status}`);
  const json = await res.json();
  return json.draft ?? '';
}
