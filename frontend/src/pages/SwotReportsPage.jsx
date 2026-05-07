// SWOT Reports — Insights-side combined view (city + store).
//
// Reads the SAME backend cache (backend/data/trainer/swot_cache.csv) as the
// AI Trainer's per-store SWOT view. A refresh from either UI is visible to
// the other immediately because both apps read/write through the same
// cache layer (trainer/swot/cache.py).
//
// Layout:
//   - Tabs: City Reports | Store Reports
//   - Dropdown for the selected scope's entities
//   - Refresh button (open to anyone logged into the analyzer)
//   - Body: shared <SwotReportBody> (Quick Stats + 4 quadrants + Function
//     Improvement Areas with phone citations linking to /call/<n>).

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, AlertCircle, Sparkles, Download } from 'lucide-react';
import SwotReportBody from '../components/trainer/SwotReportBody';
import { downloadSwotPdf } from '../utils/swotPdf';

const TAB_CITY = 'city';
const TAB_STORE = 'store';

const VERSION_ALL = 'all_calls';
const VERSION_MATTRESS = 'mattress_only';
const DEFAULT_VERSION = VERSION_MATTRESS;

const VERSION_NOTES = {
  [VERSION_MATTRESS]: 'Showing SWOT generated from mattress-category calls only',
  [VERSION_ALL]: 'Showing SWOT generated from all call categories.',
};

export default function SwotReportsPage() {
  const [tab, setTab] = useState(TAB_CITY);
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [options, setOptions] = useState({ cities: [], stores: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [selected, setSelected] = useState({ city: '', store: '' });
  const [report, setReport] = useState(null);
  const [reportMeta, setReportMeta] = useState(null); // { generated_at, stale, cost_inr, ... }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [emptyState, setEmptyState] = useState(false); // true = nothing cached yet
  const [refreshing, setRefreshing] = useState(false);

  // Initial: fetch options.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/swot-reports/options')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setOptions({
          cities: Array.isArray(d?.cities) ? d.cities : [],
          stores: Array.isArray(d?.stores) ? d.stores : [],
        });
        // Auto-select the first city + store so the page isn't empty on load.
        setSelected({
          city: (d.cities || [])[0] || '',
          store: (d.stores || [])[0] || '',
        });
        if (typeof d?.default_version === 'string' && (d.default_version === VERSION_ALL || d.default_version === VERSION_MATTRESS)) {
          setVersion(d.default_version);
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load options'); })
      .finally(() => { if (!cancelled) setOptionsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Whenever tab, selection, or version changes, fetch the report.
  const currentName = tab === TAB_CITY ? selected.city : selected.store;
  useEffect(() => {
    if (!currentName) {
      setReport(null);
      setReportMeta(null);
      setEmptyState(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEmptyState(false);
    const url = `/api/swot-reports/${tab}/${encodeURIComponent(currentName)}?version=${encodeURIComponent(version)}`;
    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setReport(null);
          setReportMeta(null);
          setEmptyState(true);
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const d = await res.json();
        if (cancelled) return;
        setReport(d.report || null);
        setReportMeta({
          stale: d.stale,
          generated_at: d.report?.generated_at,
          input_call_count: d.report?.input_call_count,
          cost_inr: d.report?.cost_inr,
          model_map: d.report?.model_map,
          model_reduce: d.report?.model_reduce,
        });
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load SWOT'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab, currentName, version]);

  async function handleRefresh() {
    if (!currentName) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/swot-reports/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: tab, name: currentName, version }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail || `HTTP ${res.status}`);
      }
      const d = await res.json();
      setReport(d.report || null);
      setReportMeta({
        stale: false,
        generated_at: d.report?.generated_at,
        input_call_count: d.report?.input_call_count,
        cost_inr: d.report?.cost_inr,
        model_map: d.report?.model_map,
        model_reduce: d.report?.model_reduce,
      });
      setEmptyState(false);
    } catch (err) {
      setError(err?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="max-w-[1400px] mx-auto px-8 py-8">
        <Link to="/insights" className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 mb-4 hover:gap-2 transition-all uppercase tracking-widest print:hidden">
          <ArrowLeft className="w-3 h-3" /> Back to Insights Dashboard
        </Link>

        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Executive Reports</p>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight" style={{ fontFamily: "'Fraunces', serif" }}>
              SWOT Reports{currentName ? ` — ${currentName}` : ''}
            </h1>
            <p className="text-sm text-slate-500 mt-2 print:hidden">
              City- and store-level SWOT synthesis with phone-number citations + per-function improvement areas. Reports are shared with the AI Trainer — refreshing here updates both places.
            </p>
          </div>

          {currentName && (
            <div className="flex items-center gap-2 shrink-0 print:hidden">
              <button
                onClick={() => downloadSwotPdf({ scope: tab, name: currentName, generatedAt: reportMeta?.generated_at })}
                disabled={!report || refreshing}
                className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition shadow-sm"
                title="Open the browser print dialog and save this report as a PDF"
              >
                <Download className="w-4 h-4" /> Download PDF
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition shadow-sm"
                title={`Regenerate the SWOT for ${currentName} from the latest 100 calls`}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing…' : (report ? 'Refresh' : 'Generate')}
              </button>
            </div>
          )}
        </div>

        {/* Version toggle — applies to both City and Store tabs. */}
        <div className="flex items-center gap-3 mb-3 print:hidden">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Version</span>
          <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
            <VersionChip active={version === VERSION_MATTRESS} onClick={() => setVersion(VERSION_MATTRESS)}>Mattress calls</VersionChip>
            <VersionChip active={version === VERSION_ALL} onClick={() => setVersion(VERSION_ALL)}>All calls</VersionChip>
          </div>
          <span className="text-xs text-slate-500">{VERSION_NOTES[version]}</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-white border border-slate-200 rounded-xl p-1 w-fit print:hidden">
          <TabButton active={tab === TAB_CITY} onClick={() => setTab(TAB_CITY)}>City Reports</TabButton>
          <TabButton active={tab === TAB_STORE} onClick={() => setTab(TAB_STORE)}>Store Reports</TabButton>
        </div>

        {/* Filter dropdown */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-5 flex items-center gap-3 flex-wrap print:bg-transparent print:border-0 print:p-0 print:mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 print:hidden">
            {tab === TAB_CITY ? 'City' : 'Store'}
          </span>
          <select
            value={tab === TAB_CITY ? selected.city : selected.store}
            onChange={(e) => setSelected((s) => ({ ...s, [tab]: e.target.value }))}
            disabled={optionsLoading}
            className="text-sm font-medium border border-slate-300 rounded-lg px-3 py-2 bg-white disabled:opacity-50 min-w-[260px] print:hidden"
          >
            {(tab === TAB_CITY ? options.cities : options.stores).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {reportMeta?.input_call_count != null && (
            <span className="text-xs text-slate-500 ml-auto print:ml-0">
              Synthesised from {reportMeta.input_call_count} latest calls · generated {timeAgo(reportMeta.generated_at)}
              {reportMeta.stale && (
                <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 align-middle">
                  STALE
                </span>
              )}
            </span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-red-700 inline-flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <strong>SWOT request failed.</strong> {error}
            </div>
          </div>
        )}

        {loading && <SwotSkeleton />}

        {!loading && !error && emptyState && currentName && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Sparkles className="w-8 h-8 text-indigo-400 mx-auto mb-3" />
            <div className="text-lg font-bold text-slate-900 mb-1">No SWOT generated yet</div>
            <div className="text-sm text-slate-500 mb-5">
              Click <strong>Generate</strong> above to build the first SWOT for <span className="font-mono">{currentName}</span> from the latest 100 calls. Takes ~2 minutes on Gemini Pro.
            </div>
          </div>
        )}

        {!loading && !error && report && <SwotReportBody report={report} />}

        {!loading && !error && report && reportMeta && (
          <div className="mt-6 text-xs text-slate-400 flex items-center gap-2 border-t border-slate-100 pt-4 print:hidden">
            <span>
              Models: <span className="font-mono text-slate-600">{reportMeta.model_map}</span> · <span className="font-mono text-slate-600">{reportMeta.model_reduce}</span>
              {' · '}Cost: <span className="font-mono text-slate-600">₹{(reportMeta.cost_inr || 0).toFixed(2)}</span>
            </span>
          </div>
        )}
      </div>

      {/* Print stylesheet — keeps the saved PDF clean: white background,
          no shadows that murder ink, page-break heuristics for the
          quadrants + function blocks. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          html, body { background: white !important; }
          body * { box-shadow: none !important; }
          .print\\:hidden { display: none !important; }
          /* Prevent ugly mid-card breaks for SWOT items + function blocks */
          section, ol > li, ul > li, .rounded-2xl { break-inside: avoid; page-break-inside: avoid; }
          /* Tighten margins so the report fits with fewer pages */
          .max-w-\\[1400px\\] { max-width: 100% !important; padding: 0 !important; }
          .py-8 { padding-top: 0 !important; padding-bottom: 0 !important; }
          /* Make sure links print in colour so citations stay scannable */
          a { color: #1d4ed8 !important; text-decoration: none !important; }
        }
      `}</style>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-bold rounded-lg transition ${
        active
          ? 'bg-slate-900 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function VersionChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
        active
          ? 'bg-indigo-600 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function SwotSkeleton() {
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 h-24 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 animate-pulse">
            <div className="h-3 w-20 bg-slate-200 rounded mb-4"></div>
            <div className="space-y-3">
              {[0, 1, 2].map((j) => (
                <div key={j} className="border border-slate-100 rounded-xl p-3">
                  <div className="h-3 w-2/3 bg-slate-200 rounded mb-2"></div>
                  <div className="h-3 w-full bg-slate-100 rounded"></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return 'recently';
  const ts = new Date(iso);
  if (isNaN(ts)) return iso;
  const diff = Date.now() - ts.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
