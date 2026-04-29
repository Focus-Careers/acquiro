/**
 * Feature announcement service — calls the Acquiro backend scraper proxy (/api/scraper/*).
 * The scraper admin key is held server-side only.
 */
import { getAuthHeaders } from '../utils/authHeaders';
import { API_URL } from '../utils/apiUrl';

const BASE = `${API_URL}/api/scraper`;

export interface FeatureAnnouncement {
  id: string;
  name: string;
  headline: string;
  cta: string;
  active: boolean;
  max_impressions: number;
  completion_field: string;
  created_at: string;
}

export interface FeatureImpressionStats {
  totalImpressions: number;
  uniqueUsers: number;
}

export async function getFeatureAnnouncements(): Promise<FeatureAnnouncement[]> {
  const res = await fetch(`${BASE}/feature-announcements`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch feature announcements: ${res.status}`);
  const json = await res.json();
  return json.announcements ?? [];
}

export async function createFeatureAnnouncement(data: {
  name: string;
  headline: string;
  cta?: string;
  active?: boolean;
  max_impressions?: number;
  completion_field?: string;
}): Promise<string> {
  const res = await fetch(`${BASE}/feature-announcements`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create feature announcement: ${res.status}`);
  const json = await res.json();
  return json.id;
}

export async function updateFeatureAnnouncement(id: string, data: Partial<FeatureAnnouncement>): Promise<void> {
  const res = await fetch(`${BASE}/feature-announcements/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update feature announcement: ${res.status}`);
}

export async function getFeatureImpressionStats(id: string): Promise<FeatureImpressionStats> {
  const res = await fetch(`${BASE}/feature-announcements/${id}/stats`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}
