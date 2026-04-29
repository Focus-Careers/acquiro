import { API_URL } from '../utils/apiUrl';
import { getAuthHeaders } from '../utils/authHeaders';

/**
 * GET /get_admin_stats → { total_users, active_subscribers, churned_users, ... }
 * Optional additions (Bubble endpoint can be updated to return these):
 *   signups_over_time: [{ date: string, count: number }]
 *   listings_by_source: [{ source: string, count: number }]
 *   listings_over_time: [{ date: string, by_source: { [source: string]: number } }]
 */
export interface AdminStatsResponse {
  total_users: number;
  active_subscribers: number;
  churned_users: number;
  /** New signups per period; Bubble to add when available */
  signups_over_time?: { date: string; count: number }[];
  /** Listings count per source; Bubble to add when available */
  listings_by_source?: { source: string; count: number }[];
  /** Listings added per period per source; Bubble to add when available */
  listings_over_time?: { date: string; by_source: Record<string, number> }[];
}

/**
 * Fetches admin user stats from Bubble.
 * Bubble endpoint: GET (or POST) /get_admin_stats — must return total_users, active_subscribers, churned_users.
 */
export async function getAdminStats(): Promise<AdminStatsResponse> {
  const res = await fetch(`${API_URL}/api/bubble/admin/stats`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin get_stats failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { response?: AdminStatsResponse } & AdminStatsResponse;
  const out = data.response ?? data;
  if (typeof out.total_users !== 'number' || typeof out.active_subscribers !== 'number' || typeof out.churned_users !== 'number') {
    throw new Error('Invalid admin stats response shape');
  }
  return {
    total_users: out.total_users,
    active_subscribers: out.active_subscribers,
    churned_users: out.churned_users,
    signups_over_time: Array.isArray(out.signups_over_time) ? out.signups_over_time : undefined,
    listings_by_source: Array.isArray(out.listings_by_source) ? out.listings_by_source : undefined,
    listings_over_time: Array.isArray(out.listings_over_time) ? out.listings_over_time : undefined,
  };
}

/** Single listing row (normalized for admin UI) */
export interface AdminListing {
  id: string;
  title: string;
  source: string;
  location: string | null;
  asking_price: number | null;
  date_added: string; // ISO date
  [key: string]: unknown;
}

/** Raw listing from Supabase Business table */
interface RawListing {
  id: string;
  business_name?: string;
  listing_id?: string;
  location?: string;
  asking_price?: number;
  created_at?: string;
  [key: string]: unknown;
}

function mapRawListingToAdmin(raw: RawListing): AdminListing {
  const id = raw.id ?? '';
  const title = raw.business_name?.trim() ?? '';
  // Derive source from listing_id prefix, e.g. "rightbiz_645229" → "rightbiz", "langcliffe-288658" → "langcliffe"
  const listingId = raw.listing_id ?? '';
  const source = listingId.split(/[_-]/)[0] ?? '';
  const location = raw.location?.trim() || null;
  const asking_price = typeof raw.asking_price === 'number' ? raw.asking_price : null;
  const date_added = raw.created_at ?? new Date(0).toISOString();
  return { ...raw, id, title, source, location, asking_price, date_added };
}

/** In-memory cache for all listings (5-minute TTL) */
let listingsCache: { data: AdminListing[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchAllListings(onProgress?: (loaded: number, total: number) => void): Promise<AdminListing[]> {
  if (listingsCache && Date.now() - listingsCache.fetchedAt < CACHE_TTL_MS) {
    return listingsCache.data;
  }
  const all: AdminListing[] = [];
  let cursor = 0;
  let knownTotal: number | null = null;
  while (true) {
    const res = await fetch(`${API_URL}/api/bubble/listings?limit=100&cursor=${cursor}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`Listings fetch failed: ${res.status}`);
    const json = (await res.json()) as {
      response: { cursor: number; results: RawListing[]; count: number; remaining: number };
    };
    const { results, count, remaining } = json.response;
    all.push(...results.map(mapRawListingToAdmin));
    if (knownTotal === null) knownTotal = count + remaining;
    onProgress?.(all.length, knownTotal);
    if (remaining <= 0) break;
    cursor += count;
  }
  listingsCache = { data: all, fetchedAt: Date.now() };
  return all;
}

/** Listings response returned to the admin UI */
export interface AdminListingsResponse {
  listings: AdminListing[];
  total_count: number;
  by_source?: { source: string; count: number }[];
  listings_over_time?: { date: string; by_source: Record<string, number> }[];
  added_today: number;
  added_this_week: number;
  avg_asking_price: number | null;
}

export type AdminSortKey = 'title' | 'source' | 'location' | 'asking_price' | 'date_added';
export type AdminSortDir = 'asc' | 'desc';

export interface GetAdminListingsParams {
  search?: string;
  source?: string;
  page?: number;
  page_size?: number;
  sort_by?: AdminSortKey;
  sort_dir?: AdminSortDir;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Fetches all listings from Bubble Data API (obj/Business) with cursor-based pagination,
 * caches the full dataset for 5 minutes, then applies search/filter/pagination client-side.
 */
export async function getAdminListings(params: GetAdminListingsParams = {}): Promise<AdminListingsResponse> {
  if (!API_URL) throw new Error('API URL configuration is missing.');

  const all = await fetchAllListings(params.onProgress);

  // Client-side filtering
  const search = params.search?.toLowerCase().trim() ?? '';
  const sourceFilter = params.source?.toLowerCase().trim() ?? '';
  let filtered = all;
  if (search) {
    filtered = filtered.filter(
      (l) => l.title.toLowerCase().includes(search) || (l.location ?? '').toLowerCase().includes(search),
    );
  }
  if (sourceFilter) {
    filtered = filtered.filter((l) => l.source.toLowerCase().includes(sourceFilter));
  }

  // By-source counts from full (unfiltered) dataset for summary cards
  const counts: Record<string, number> = {};
  all.forEach((l) => {
    const s = l.source || 'Unknown';
    counts[s] = (counts[s] ?? 0) + 1;
  });
  const by_source = Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  // Compute listings_over_time from full dataset (grouped by month + source)
  const byMonthSource: Record<string, Record<string, number>> = {};
  all.forEach((l) => {
    const day = l.date_added.substring(0, 10); // e.g. "2024-01-15"
    if (!byMonthSource[day]) byMonthSource[day] = {};
    const s = l.source || 'Unknown';
    byMonthSource[day][s] = (byMonthSource[day][s] ?? 0) + 1;
  });
  const listings_over_time = Object.entries(byMonthSource)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, by_source]) => ({ date, by_source }));

  // Summary stats from full (unfiltered) dataset
  const today = new Date().toISOString().substring(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const added_today = all.filter((l) => l.date_added.substring(0, 10) === today).length;
  const added_this_week = all.filter((l) => l.date_added.substring(0, 10) >= weekAgo).length;
  const prices = all.map((l) => l.asking_price).filter((p): p is number => p != null && p > 0);
  const avg_asking_price = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

  // Client-side sorting
  if (params.sort_by) {
    const key = params.sort_by;
    const dir = params.sort_dir === 'desc' ? -1 : 1;
    filtered = filtered.slice().sort((a, b) => {
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  // Pagination
  const page_size = params.page_size ?? 10;
  const page = Math.max(1, params.page ?? 1);
  const start = (page - 1) * page_size;
  const listings = filtered.slice(start, start + page_size);

  return { listings, total_count: filtered.length, by_source, listings_over_time, added_today, added_this_week, avg_asking_price };
}

// --- Backend (Stripe MRR, ElevenLabs) ---

export interface MrrResponse {
  mrr_cents: number;
  currency: string;
}

/** Fetches current MRR from our backend (Stripe). */
export async function getMrr(): Promise<MrrResponse> {
  const res = await fetch(`${API_URL}/api/admin/mrr`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to fetch MRR' }));
    throw new Error(err.error || 'Failed to fetch MRR');
  }
  return res.json();
}

/** GET /api/admin/revenue → { current_mrr, monthly_revenue: [{ month, revenue }] } — revenue in cents */
export interface RevenueResponse {
  current_mrr: number;
  monthly_revenue: { month: string; revenue: number }[];
}

/** Fetches current MRR and last 6 months revenue from our backend (Stripe invoices + subscriptions). */
export async function getRevenue(): Promise<RevenueResponse> {
  const res = await fetch(`${API_URL}/api/admin/revenue`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to fetch revenue' }));
    throw new Error(err.error || 'Failed to fetch revenue');
  }
  return res.json();
}

/** ElevenLabs conversation summary (from list). */
export interface ConversationSummary {
  conversation_id: string;
  start_time_unix_secs: number;
  call_duration_secs: number;
  message_count: number;
  status: string;
  call_successful?: string;
  transcript_summary?: string;
  agent_id?: string;
  agent_name?: string;
  [key: string]: unknown;
}

export interface ConversationsListResponse {
  conversations: ConversationSummary[];
  next_cursor?: string;
  has_more: boolean;
}

/** Fetches conversation list from our backend (ElevenLabs proxy). */
export async function getConversations(params: {
  cursor?: string;
  page_size?: number;
  agent_id?: string;
} = {}): Promise<ConversationsListResponse> {
  const q = new URLSearchParams();
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.page_size != null) q.set('page_size', String(params.page_size));
  if (params.agent_id) q.set('agent_id', params.agent_id);
  const res = await fetch(`${API_URL}/api/admin/conversations?${q.toString()}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to fetch conversations' }));
    throw new Error(err.error || 'Failed to fetch conversations');
  }
  return res.json();
}

/** Single conversation details (transcript etc.). */
export interface ConversationDetails {
  conversation_id: string;
  start_time_unix_secs?: number;
  call_duration_secs?: number;
  transcript?: Array<{ role: string; message: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Fetches one conversation (with transcript) from our backend (ElevenLabs proxy). */
export async function getConversation(conversationId: string): Promise<ConversationDetails> {
  const res = await fetch(`${API_URL}/api/admin/conversations/${encodeURIComponent(conversationId)}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    if (res.status === 404) throw new Error('Conversation not found');
    const err = await res.json().catch(() => ({ error: 'Failed to fetch conversation' }));
    throw new Error(err.error || 'Failed to fetch conversation');
  }
  return res.json();
}
