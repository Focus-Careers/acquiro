/**
 * Scraper admin service — calls the Acquiro backend proxy (/api/scraper/*).
 * The scraper admin key is held server-side only; this file sends no credentials.
 * All calls require the user to be an admin (enforced by requireAdmin middleware).
 */
import { getAuthHeaders } from '../utils/authHeaders';
import { API_URL } from '../utils/apiUrl';

const BASE = `${API_URL}/api/scraper`;

export type SourceKey = 'rightbiz' | 'cogogo' | 'daltons' | 'businessesforsale';

export interface SchedulerStatus {
  schedulerEnabled: boolean;
  cronExpression: string;
  timezone: string;
  lastRun?: string | null;
  lastRunAdded?: number | null;
  lastRunArchived?: number | null;
  lastRunMatches?: number | null;
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const res = await fetch(`${BASE}/status`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  return res.json();
}

export async function setSchedulerEnabled(enabled: boolean): Promise<void> {
  const path = enabled ? '/scheduler/enable' : '/scheduler/disable';
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Scheduler toggle failed: ${res.status}`);
}

export async function runPipeline(): Promise<void> {
  const res = await fetch(`${BASE}/run-pipeline`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Run pipeline failed: ${res.status}`);
}

export async function runScrape(): Promise<void> {
  const res = await fetch(`${BASE}/run-scrape`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Run scrape failed: ${res.status}`);
}

export async function runMatches(): Promise<void> {
  const res = await fetch(`${BASE}/run-matches`, { method: 'POST', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Run matches failed: ${res.status}`);
}

export async function scrapeSource(source: SourceKey, pages: number = 5): Promise<void> {
  // scrape is a non-admin endpoint on the scraper — keep calling it directly via the backend if needed
  // For now keep the same shape but note this endpoint has no admin key requirement on the scraper
  const res = await fetch(`${BASE}/run-scrape`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ sources: source, pages }),
  });
  if (!res.ok) throw new Error(`Scrape failed: ${res.status}`);
}
