/**
 * Shared utility functions for formatting and score conversion.
 */

export function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const s = parseInt(seconds, 10);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function scoreClass(label) {
  if (!label) return 'score-neutral';
  const l = label.toUpperCase();
  if (l === 'HIGH' || l === 'YES') return 'score-high';
  if (l === 'MEDIUM') return 'score-med';
  if (l === 'LOW' || l === 'NO') return 'score-low';
  return 'score-neutral';
}

export function intentDotColor(label) {
  if (!label) return 'bg-gray-400';
  const l = label.toUpperCase();
  if (l === 'HIGH') return 'bg-emerald-500';
  if (l === 'MEDIUM') return 'bg-amber-500';
  return 'bg-red-500';
}

export function yesNoLabel(val) {
  if (!val) return 'N/A';
  const v = val.toString().toUpperCase().trim();
  if (v === 'YES' || v === '1' || v === 'TRUE') return 'YES';
  if (v === 'NO' || v === '0' || v === 'FALSE') return 'NO';
}

export function formatShortDate(dateStr) {
  if (!dateStr || dateStr === 'N/A') return 'N/A';
  return dateStr;
}

export function parseDate(dateStr) {
  if (!dateStr || dateStr === 'N/A') return null;
  // Source CSV stores all dates as DD-MM-YYYY (no timestamp).
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

export function isConverted(record) {
  const v = String(record?.is_converted ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function npsBucket(score) {
  if (score === null || score === undefined || score === '') return null;
  const n = Number(score);
  if (Number.isNaN(n)) return null;
  if (n >= 8) return 'HIGH';
  if (n >= 5) return 'MEDIUM';
  return 'LOW';
}

// ── URL filter serialization ─────────────────────────────────────────────────
// Bidirectional mapping between in-app filter state (arrays) and URL query
// strings. Short keys keep URLs readable; comma-separated values keep arrays
// compact. Used by Analytics Dashboard ↔ Call Listing so filters survive
// "Open in new tab", page refresh, and bookmarking.

export const FILTER_URL_KEYS = {
  cityFilter: 'city',
  storeFilter: 'store',
  callTypeFilter: 'calltype',
  intentFilter: 'intent',
  visitFilter: 'visit',
  expFilter: 'exp',
  npsAgentFilter: 'agentnps',
  npsBrandFilter: 'brandnps',
  categoryFilter: 'category',
  funnelFilter: 'funnel',
  priceFilter: 'price',
  barrierFilter: 'barrier',
  convertedFilter: 'converted',
  startDate: 'from',
  endDate: 'to',
};

const ARRAY_FILTER_KEYS = new Set([
  'cityFilter', 'storeFilter', 'callTypeFilter', 'intentFilter', 'visitFilter',
  'expFilter', 'npsAgentFilter', 'npsBrandFilter', 'categoryFilter',
  'funnelFilter', 'priceFilter', 'barrierFilter', 'convertedFilter',
]);

export function filtersToParams(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([stateKey, value]) => {
    const urlKey = FILTER_URL_KEYS[stateKey];
    if (!urlKey) return;
    if (ARRAY_FILTER_KEYS.has(stateKey)) {
      if (Array.isArray(value) && value.length > 0) {
        params.set(urlKey, value.join(','));
      }
    } else if (typeof value === 'string' && value) {
      params.set(urlKey, value);
    }
  });
  return params;
}

export function paramsToFilters(searchParams) {
  const out = {};
  Object.entries(FILTER_URL_KEYS).forEach(([stateKey, urlKey]) => {
    const raw = searchParams.get(urlKey);
    if (raw == null) {
      out[stateKey] = ARRAY_FILTER_KEYS.has(stateKey) ? [] : '';
      return;
    }
    if (ARRAY_FILTER_KEYS.has(stateKey)) {
      out[stateKey] = raw.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      out[stateKey] = raw;
    }
  });
  return out;
}

// Build a URL like "/listing?city=Hyderabad&intent=HIGH" from a filter state object.
export function buildFilteredUrl(path, filters) {
  const params = filtersToParams(filters);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export async function fetchCalls() {
  const res = await fetch(apiUrl('/api/calls'));
  if (!res.ok) throw new Error('Failed to fetch calls');
  return res.json();
}

export async function fetchCallDetail(cleanNumber) {
  const res = await fetch(apiUrl(`/api/calls/${encodeURIComponent(cleanNumber)}`));
  if (!res.ok) throw new Error(`Call not found: ${cleanNumber}`);
  return res.json();
}

export async function fetchAnalyticsData() {
  const res = await fetch(apiUrl('/api/analytics'));
  if (!res.ok) throw new Error('Failed to fetch analytics data');
  return res.json();
}

export async function fetchExportData(cleanNumbers) {
  const res = await fetch(apiUrl('/api/export-calls'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clean_numbers: cleanNumbers })
  });
  if (!res.ok) throw new Error('Failed to export calls');
  return res.json();
}

export async function generateInsightsReport(cleanNumbers, segmentDescription, dateRange, customQuestion, cleanNumbersB, segmentDescriptionB, dateRangeB) {
  const payload = {
    clean_numbers: cleanNumbers,
    segment_description: segmentDescription,
    date_range: dateRange,
    custom_question: customQuestion
  };
  
  if (cleanNumbersB) {
    payload.clean_numbers_b = cleanNumbersB;
    payload.segment_description_b = segmentDescriptionB;
    payload.date_range_b = dateRangeB;
  }

  const res = await fetch(apiUrl('/api/generate-insights'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || 'Failed to generate insights');
  }
  return res.json();
}
