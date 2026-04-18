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
  // Handles "M/D/YYYY HH:mm" or just "M/D/YYYY"
  return dateStr.split(' ')[0];
}

export function parseDate(dateStr) {
  if (!dateStr || dateStr === 'N/A' || dateStr.startsWith('###')) return null;
  const parts = dateStr.split(' ')[0].split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map(Number);
  return new Date(y, m - 1, d);
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export async function fetchCalls() {
  const res = await fetch(`${API_BASE}/api/calls`);
  if (!res.ok) throw new Error('Failed to fetch calls');
  return res.json();
}

export async function fetchCallDetail(cleanNumber) {
  const res = await fetch(`${API_BASE}/api/calls/${cleanNumber}`);
  if (!res.ok) throw new Error(`Call not found: ${cleanNumber}`);
  return res.json();
}

export async function fetchAnalyticsData() {
  const res = await fetch(`${API_BASE}/api/analytics`);
  if (!res.ok) throw new Error('Failed to fetch analytics data');
  return res.json();
}
