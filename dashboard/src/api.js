const BASE = '/api';

function getToken() {
  return localStorage.getItem('outreach_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('outreach_token');
    window.location.reload();
    return null;
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function login(password) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  if (data?.token) {
    localStorage.setItem('outreach_token', data.token);
  }
  return data;
}

export function logout() {
  localStorage.removeItem('outreach_token');
  window.location.reload();
}

export function isLoggedIn() {
  return !!getToken();
}

export const fetchOverview = () => request('/overview');
export const fetchPipeline = () => request('/pipeline');
export const fetchPipelineLead = (id) => request(`/pipeline/${id}`);
export const updateLeadStatus = (id, status) => request(`/pipeline/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const fetchAnalytics = () => request('/analytics');
export const fetchCosts = () => request('/costs');
export const fetchCostChart = () => request('/costs/chart');
export const fetchReports = () => request('/reports');
export const fetchReport = (date) => request(`/reports/${date}`);
export const fetchEmails = (page = 1, limit = 20) => request(`/emails?page=${page}&limit=${limit}`);
export const fetchEmail = (id) => request(`/emails/${id}`);
