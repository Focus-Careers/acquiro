import { getAuthHeaders } from '../utils/authHeaders';
import { API_URL } from '../utils/apiUrl';

export interface UserNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  status: 'unread' | 'actioned';
  langcliffe_outreach: string;
  created_at: string;
  nda_file_url?: string;
}

export async function getUserNotifications(userId: string): Promise<UserNotification[]> {
  const res = await fetch(`${API_URL}/api/bubble/notifications/${userId}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch notifications: ${res.status}`);
  const json = await res.json();
  return json.response?.results ?? [];
}

export async function markNotificationActioned(notificationId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/bubble/notifications/${notificationId}/action`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to mark notification actioned: ${res.status}`);
}

export async function getNdaFileUrl(outreachId: string): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/bubble/notifications/nda/${outreachId}`, { headers: getAuthHeaders() });
  if (!res.ok) return null;
  const json = await res.json();
  return json.nda_file_url ?? null;
}

export async function uploadSignedNDA(outreachId: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);

  // Auth header only (no Content-Type — browser sets it with multipart boundary automatically)
  const token = (await import('../hooks/useAdvisorStore')).useAdvisorStore.getState().authToken;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api/scraper/outreach/${outreachId}/signed-nda`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload signed NDA: ${res.status}`);
}
