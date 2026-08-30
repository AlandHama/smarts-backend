const ACCESS_KEY = 'smarts-system-admin-token';
const REFRESH_KEY = 'smarts-system-admin-refresh-token';

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function hasSession() { return typeof window !== 'undefined' && Boolean(localStorage.getItem(ACCESS_KEY)); }

function saveSession(body: any) {
  localStorage.setItem(ACCESS_KEY, body.token.accessToken);
  localStorage.setItem(REFRESH_KEY, body.token.refreshToken);
}

export async function login(identifier: string, password: string) {
  const response = await fetch('/system-admin/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Unable to sign in');
  saveSession(body);
  return body;
}

async function refresh() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) throw new Error('Session expired');
  const response = await fetch('/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { clearSession(); throw new Error(body.message || 'Session expired'); }
  saveSession(body);
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const accessToken = localStorage.getItem(ACCESS_KEY);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`/system-admin/api${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !retried) { await refresh(); return api<T>(path, init, true); }
  if (!response.ok) throw new Error(body.message || 'Request failed');
  return body as T;
}

