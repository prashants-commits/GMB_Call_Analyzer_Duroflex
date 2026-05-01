// Bug 2 — Drill history list. Shows all score cards across all agents,
// most-recent first. Click a row to open ScoreCardPage.
//
// MVP scope (per user direction): no role restrictions, no filters, default
// limit 100. Defers per-store/per-agent filtering and date-range to Group F.

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';

import Header from '../../components/Header';
import { trainer } from '../../utils/trainerApi';

export default function DrillsListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null); // null = loading; array = loaded
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setItems(null);
    trainer.scoreCards.list(100).then(
      (res) => { if (!cancelled) setItems(Array.isArray(res?.items) ? res.items : []); },
      (err) => { if (!cancelled) setError(err?.message || 'Failed to load drill history.'); },
    );
    return () => { cancelled = true; };
  }, [reloadToken]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/trainer" className="text-sm text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to trainer home
          </Link>
          <button
            onClick={() => setReloadToken((n) => n + 1)}
            className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
            Drill history
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            All scored mock calls, most recent first. Click a row to open its score card.
          </p>
        </div>

        {error && (
          <Panel>
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-700 inline-flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <strong>Couldn't load drill history.</strong>
                <div className="text-sm mt-1">{error}</div>
              </div>
            </div>
          </Panel>
        )}

        {!error && items === null && (
          <Panel>
            <div className="text-center py-10 text-slate-500">
              <div className="inline-block w-8 h-8 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mb-3" />
              <div className="text-sm">Loading drill history…</div>
            </div>
          </Panel>
        )}

        {!error && items && items.length === 0 && (
          <Panel>
            <div className="text-center py-10">
              <div className="text-lg font-bold text-slate-900 mb-1">No scored drills yet</div>
              <div className="text-sm text-slate-500 mb-4">
                Score cards appear here once an agent completes a drill.
              </div>
              <Link
                to="/trainer/drill/new"
                className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold px-4 py-2 rounded-xl inline-flex items-center gap-2"
              >
                Start a drill
              </Link>
            </div>
          </Panel>
        )}

        {!error && items && items.length > 0 && (
          <Panel padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Store</th>
                    <th className="px-4 py-3">Persona</th>
                    <th className="px-4 py-3 text-right">Overall</th>
                    <th className="px-4 py-3">Band</th>
                    <th className="px-4 py-3" aria-label="open"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => (
                    <tr
                      key={it.drill_uuid}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => navigate(`/trainer/score-cards/${it.drill_uuid}`)}
                    >
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(it.scored_at)}</td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{it.staff_name || it.staff_id || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{it.store_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{it.persona_name || it.persona_id || '—'}</td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${scoreColor(it.score_overall)}`}>
                        {it.score_overall}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{it.overall_band || '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-right"><ChevronRight className="w-4 h-4 inline" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function scoreColor(score) {
  const v = Number(score) || 0;
  if (v >= 85) return 'text-emerald-600';
  if (v >= 70) return 'text-lime-600';
  if (v >= 55) return 'text-amber-600';
  return 'text-rose-600';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function Panel({ children, padded = true }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 ${padded ? 'p-6' : ''} mb-4`}>
      {children}
    </div>
  );
}
