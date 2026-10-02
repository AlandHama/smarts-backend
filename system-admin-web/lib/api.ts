const ACCESS_KEY = 'smarts-system-admin-token';
const REFRESH_KEY = 'smarts-system-admin-refresh-token';

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function hasSession() { return typeof window !== 'undefined' && Boolean(localStorage.getItem(ACCESS_KEY)); }

function saveSession(body: any) {
  if (!body?.token?.accessToken || !body?.token?.refreshToken) throw new Error('The server returned an incomplete session');
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

let refreshPromise: Promise<void> | null = null;

async function rotateSession() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) throw new Error('Session expired');
  // Keep console refresh on the same mounted API surface as login and all
  // other admin calls. The root /auth path is used by mobile clients and is
  // not the stable public mount for the exported console.
  const response = await fetch('/system-admin/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // A transient Railway/proxy error must not destroy a valid 30-day local
    // session. Only an explicit auth rejection proves that credentials are
    // invalid or the session was revoked.
    if (response.status === 401 || response.status === 403) clearSession();
    throw new Error(body.message || (response.status >= 500 ? 'Authentication service temporarily unavailable' : 'Session expired'));
  }
  saveSession(body);
}

function refresh() {
  if (!refreshPromise) {
    refreshPromise = rotateSession().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function accessTokenNeedsRefresh(token: string | null) {
  if (!token) return false;
  try {
    const encoded = token.split('.')[1];
    const payload = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 - Date.now() < 5 * 60_000;
  } catch {
    return false;
  }
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  if (!retried && accessTokenNeedsRefresh(localStorage.getItem(ACCESS_KEY))) await refresh();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const accessToken = localStorage.getItem(ACCESS_KEY);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`/system-admin/api${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !retried) { await refresh(); return api<T>(path, init, true); }
  if (!response.ok) throw new Error(body.message || 'Request failed');
  return body as T;
}

export async function uploadFile<T>(path: string, file: File, purpose: string, visibility: 'PUBLIC' | 'PRIVATE' = 'PRIVATE'): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);
  form.append('visibility', visibility);
  return api<T>(path, { method: 'POST', body: form });
}

export async function downloadFile(path: string, retried = false): Promise<void> {
  if (!retried && accessTokenNeedsRefresh(localStorage.getItem(ACCESS_KEY))) await refresh();
  const headers = new Headers();
  const accessToken = localStorage.getItem(ACCESS_KEY);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`/system-admin/api${path}`, { headers });
  if (response.status === 401 && !retried) {
    await refresh();
    return downloadFile(path, true);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || 'Download failed');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'smarts-report.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
