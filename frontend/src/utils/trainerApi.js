// Thin fetch wrapper for the trainer subsystem.
// All requests use `credentials: 'include'` so the HMAC-signed `trainer_session`
// cookie issued by /api/trainer/auth/login flows back to the backend on every
// trainer request. The base app's auth uses localStorage and is unaffected.

const TRAINER_BASE = '/api/trainer';

export class TrainerHTTPError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : (detail?.message || `HTTP ${status}`));
    this.status = status;
    this.detail = detail;
  }
}

export async function trainerFetch(path, options = {}) {
  const res = await fetch(`${TRAINER_BASE}${path}`, {
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    let detail;
    try {
      detail = await res.json();
      detail = detail?.detail ?? detail;
    } catch {
      detail = res.statusText;
    }
    throw new TrainerHTTPError(res.status, detail);
  }
  // Some endpoints (logout) may return JSON; some may return text. Default to JSON.
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const trainer = {
  health: () => trainerFetch('/health'),
  me: () => trainerFetch('/me'),
  login: (staffId, email = '') =>
    trainerFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId, email }),
    }),
  logout: () => trainerFetch('/auth/logout', { method: 'POST' }),
  cities: () => trainerFetch('/cities'),
  staffInStore: (storeName) => trainerFetch(`/stores/${encodeURIComponent(storeName)}/staff`),

  swot: {
    list: () => trainerFetch('/swot'),
    get: (storeName) => trainerFetch(`/swot/${encodeURIComponent(storeName)}`),
    refresh: (storeName) =>
      trainerFetch(`/swot/${encodeURIComponent(storeName)}/refresh`, { method: 'POST' }),
    job: (jobId) => trainerFetch(`/swot/jobs/${encodeURIComponent(jobId)}`),
  },

  drills: {
    start: (body = {}) =>
      trainerFetch('/drills/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    get: (drillUuid) => trainerFetch(`/drills/${encodeURIComponent(drillUuid)}`),
    cancel: (drillUuid) =>
      trainerFetch(`/drills/${encodeURIComponent(drillUuid)}/cancel`, { method: 'POST' }),
  },

  scoreCards: {
    // Returns the persisted score-card payload, OR an object
    // `{ ready: false, drill_status }` if the card isn't written yet (the
    // post-drill page polls until ready). Throws on real errors.
    get: async (drillUuid) => {
      try {
        return await trainerFetch(`/score-cards/${encodeURIComponent(drillUuid)}`);
      } catch (err) {
        if (err.status === 404 && err.detail && err.detail.ready === false) {
          return err.detail;
        }
        throw err;
      }
    },
    // Returns { items: [...] } — most-recent first, all agents.
    list: (limit = 100) => trainerFetch(`/score-cards?limit=${encodeURIComponent(limit)}`),
  },

  personas: {
    listPublished: () => trainerFetch('/personas'),
    get: (personaId) => trainerFetch(`/personas/${encodeURIComponent(personaId)}`),
    pick: (body = {}) =>
      trainerFetch('/personas/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),

    admin: {
      generate: (body = {}) =>
        trainerFetch('/admin/personas/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      job: (jobId) => trainerFetch(`/admin/personas/jobs/${encodeURIComponent(jobId)}`),
      getDraft: () => trainerFetch('/admin/personas/draft'),
      saveDraft: (library) =>
        trainerFetch('/admin/personas/draft', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(library),
        }),
      publish: () => trainerFetch('/admin/personas/publish', { method: 'POST' }),
      versions: () => trainerFetch('/admin/personas/versions'),
      seed: () => trainerFetch('/admin/personas/seed', { method: 'POST' }),
    },
  },

  admin: {
    getRoster: () => trainerFetch('/admin/roster'),
    coverage: () => trainerFetch('/admin/roster/coverage'),
    audit: (limit = 100, action) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (action) qs.set('action', action);
      return trainerFetch(`/admin/audit?${qs}`);
    },
    uploadRoster: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return trainerFetch('/admin/roster', { method: 'POST', body: fd });
    },
  },
};

// Returns a stable identity for the trainer enabled flag.
// 200 from /health → true, anything else → false. Network error → false.
export async function checkTrainerEnabled() {
  try {
    const res = await fetch(`${TRAINER_BASE}/health`, { credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}
