// Backend base URL — set via Vite env. Falls back to local backend in dev.
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

const TOKEN_KEY = 'poll.token';
const NAME_KEY = 'poll.name';
const PID_KEY = 'poll.pid';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getName = () => localStorage.getItem(NAME_KEY);
export const getPid = () => localStorage.getItem(PID_KEY);

function authHeaders(extra = {}) {
  const t = getToken();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}

async function req(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// Anonymous join — stores the returned token for subsequent authed calls.
export async function join(name) {
  const body = await req('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  localStorage.setItem(TOKEN_KEY, body.token);
  localStorage.setItem(NAME_KEY, body.name);
  localStorage.setItem(PID_KEY, body.id);
  return body;
}

export function fetchState() {
  return req('/api/state', { headers: authHeaders() });
}

export function vote(questionId, optionIds) {
  return req('/api/vote', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ questionId, optionIds }),
  });
}

export function fetchLeaderboard(limit = 20) {
  return req(`/api/leaderboard?limit=${limit}`);
}

// SSE endpoint is public (broadcast only) — no auth header needed, which suits
// EventSource (it can't send custom headers anyway).
export const eventsUrl = `${API_BASE}/api/events`;
export { API_BASE };

// --- admin (host) ---
const ADMIN_KEY = 'poll.admin';
export const getAdminToken = () => localStorage.getItem(ADMIN_KEY) || '';
export const setAdminToken = (t) => localStorage.setItem(ADMIN_KEY, t);

async function adminReq(path, opts = {}) {
  const res = await fetch(`${API_BASE}/api/admin${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': getAdminToken(), ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

export const adminStatus = () => adminReq('/status');
export const adminStart = () => adminReq('/start', { method: 'POST' });
export const adminStop = () => adminReq('/stop', { method: 'POST' });
export const adminPause = () => adminReq('/pause', { method: 'POST' });
export const adminResume = () => adminReq('/resume', { method: 'POST' });
export const adminReset = () => adminReq('/reset', { method: 'POST' });
export const adminReseed = (count) =>
  adminReq('/reseed', { method: 'POST', body: JSON.stringify({ count }) });

// Download top-N results (CSV or JSON) as a file. Uses the admin token header,
// so we fetch a blob and trigger the download client-side.
export async function adminDownloadResults(format = 'csv', top = 10) {
  const res = await fetch(`${API_BASE}/api/admin/results?format=${format}&top=${top}`, {
    headers: { 'x-admin-token': getAdminToken() },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = format === 'csv' ? 'poll-results.csv' : 'poll-results.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
