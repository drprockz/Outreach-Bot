const BASE = '/api';

function getToken() {
  return localStorage.getItem('radar_token');
}

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) {
    localStorage.removeItem('radar_token');
    window.location.href = '/login';
    return;
  }
  return res.json();
}

export const api = {
  login: (password) =>
    fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }).then(r => r.json()),
  overview:      () => request('/overview'),
  leads:         (params = '') => request(`/leads${params}`),
  lead:          (id) => request(`/leads/${id}`),
  updateStatus:  (id, status) => request(`/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  sendLog:       (params = '') => request(`/send-log${params}`),
  replies:       () => request('/replies'),
  sequences:     () => request('/sequences'),
  cronStatus:    () => request('/cron-status'),
  cronHistory:   (job) => request(`/cron-status/${job}/history`),
  health:        () => request('/health'),
  costs:         () => request('/costs'),
  errors:        (params = '') => request(`/errors${params}`),
  resolveError:  (id) => request(`/errors/${id}/resolve`, { method: 'PATCH' }),
  replyAction:   (id, action) => request(`/replies/${id}/action`, { method: 'PATCH', body: JSON.stringify({ action }) }),
  replyReject:   (id) => request(`/replies/${id}/reject`, { method: 'POST' }),
  updateMailTester: (score) => request('/health/mail-tester', { method: 'PATCH', body: JSON.stringify({ score }) })
};
