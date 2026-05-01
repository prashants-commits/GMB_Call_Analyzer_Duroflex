import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Headphones, AlertCircle, TrendingUp, AlertTriangle, Activity, Briefcase, Megaphone, Truck, Package, Globe } from 'lucide-react';
import Header from '../../components/Header';
import SwotQuadrant, { CleanNumberCitations } from '../../components/trainer/SwotQuadrant';
import { trainer, TrainerHTTPError } from '../../utils/trainerApi';

// 5 functions in display order, with display labels + icons. Keys must match
// backend FunctionName Literal in trainer/swot/schema.py.
const FUNCTION_META = {
  sales_team:                { label: 'Sales Team',              Icon: Briefcase, accent: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  marketing:                 { label: 'Marketing',               Icon: Megaphone, accent: 'text-pink-700 bg-pink-50 border-pink-200' },
  supply_chain_and_delivery: { label: 'Supply Chain & Delivery', Icon: Truck,     accent: 'text-amber-700 bg-amber-50 border-amber-200' },
  product_team:              { label: 'Product Team',            Icon: Package,   accent: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  omnichannel_team:          { label: 'Omnichannel Team',        Icon: Globe,     accent: 'text-sky-700 bg-sky-50 border-sky-200' },
};
const FUNCTION_ORDER = ['sales_team', 'marketing', 'supply_chain_and_delivery', 'product_team', 'omnichannel_team'];

const SEVERITY_STYLES = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

export default function StoreSwotPage() {
  const navigate = useNavigate();
  const { storeName: storeNameParam } = useParams();
  const storeName = decodeURIComponent(storeNameParam || '');

  const [actor, setActor] = useState(null);
  const [report, setReport] = useState(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const pollTimerRef = useRef(null);

  // Auth probe.
  useEffect(() => {
    trainer.me()
      .then((d) => setActor(d.actor))
      .catch((err) => {
        if (err instanceof TrainerHTTPError && err.status === 401) {
          navigate('/trainer/identify', { replace: true });
        } else {
          setError(err.message);
        }
      });
  }, [navigate]);

  // Initial load.
  useEffect(() => {
    if (!storeName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    trainer.swot.get(storeName)
      .then((data) => {
        if (cancelled) return;
        setReport(data.report);
        setStale(data.stale);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof TrainerHTTPError) {
          setError(typeof err.detail === 'string' ? err.detail : err.detail?.reason || err.message);
        } else {
          setError(err.message);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [storeName]);

  // Cleanup poll on unmount.
  useEffect(() => () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  async function handleRefresh() {
    setRefreshError(null);
    setRefreshing(true);
    try {
      const { job } = await trainer.swot.refresh(storeName);
      const startedAt = Date.now();
      pollTimerRef.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          clearInterval(pollTimerRef.current);
          setRefreshing(false);
          setRefreshError('Refresh timed out after 90s — check the audit log for status.');
          return;
        }
        try {
          const { job: latest } = await trainer.swot.job(job.job_id);
          if (latest.status === 'completed') {
            clearInterval(pollTimerRef.current);
            const data = await trainer.swot.get(storeName);
            setReport(data.report);
            setStale(false);
            setRefreshing(false);
          } else if (latest.status === 'failed') {
            clearInterval(pollTimerRef.current);
            setRefreshing(false);
            setRefreshError(latest.error || 'Refresh failed');
          }
        } catch (err) {
          clearInterval(pollTimerRef.current);
          setRefreshing(false);
          setRefreshError(err.message);
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setRefreshing(false);
      const detail = err instanceof TrainerHTTPError ? err.detail : err.message;
      setRefreshError(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
  }

  const canRefresh = actor && ['manager', 'cluster_head', 'admin'].includes(actor.role);

  return (
    <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <Header />

      <div className="max-w-[1400px] mx-auto px-8 py-8">
        <Link to="/trainer" className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 mb-4 hover:gap-2 transition-all uppercase tracking-widest">
          <ArrowLeft className="w-3 h-3" /> Back to AI Trainer
        </Link>

        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Store SWOT</p>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight" style={{ fontFamily: "'Fraunces', serif" }}>
              {storeName || 'Pick a store'}
            </h1>
            {report && (
              <p className="text-sm text-slate-500 mt-2">
                Synthesised from {report.input_call_count} latest calls · generated {timeAgo(report.generated_at)}
                {stale && (
                  <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 align-middle">
                    STALE
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {canRefresh && (
              <button
                onClick={handleRefresh}
                disabled={refreshing || !storeName}
                className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition shadow-sm"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing…' : (report ? 'Refresh' : 'Generate')}
              </button>
            )}
          </div>
        </div>

        {refreshError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <strong>Refresh failed.</strong> {refreshError}
            </div>
          </div>
        )}

        {loading && <SwotSkeleton />}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
            <strong>Could not load SWOT.</strong> {error}
            <p className="mt-2 text-sm text-red-600">
              {canRefresh
                ? 'Click “Generate” to build the first SWOT for this store. (Needs a Gemini API key in backend/.env.)'
                : 'Ask your manager or admin to generate the SWOT for this store.'}
            </p>
          </div>
        )}

        {!loading && !error && report && report.quick_stats && (
          <QuickStatsStrip stats={report.quick_stats} />
        )}

        {!loading && !error && report && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <SwotQuadrant kind="strengths"     title="Strengths"     items={report.strengths} />
            <SwotQuadrant kind="weaknesses"    title="Weaknesses"    items={report.weaknesses} />
            <SwotQuadrant kind="opportunities" title="Opportunities" items={report.opportunities} />
            <SwotQuadrant kind="threats"       title="Threats"       items={report.threats} />
          </div>
        )}

        {!loading && !error && report && report.function_improvements && report.function_improvements.length > 0 && (
          <FunctionImprovementsSection blocks={report.function_improvements} />
        )}

        {!loading && !error && report && (
          <div className="mt-6 text-xs text-slate-400 flex items-center gap-2 border-t border-slate-100 pt-4">
            <Headphones className="w-3 h-3" />
            <span>
              Models: <span className="font-mono text-slate-600">{report.model_map}</span> · <span className="font-mono text-slate-600">{report.model_reduce}</span>
              {' · '}Cost: <span className="font-mono text-slate-600">₹{(report.cost_inr || 0).toFixed(2)}</span>
              {report.notes && <> · {report.notes}</>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Quick Stats strip — CSO 5-second read above the SWOT quadrants ─────────
function QuickStatsStrip({ stats }) {
  const cells = [
    {
      label: 'Calls analysed',
      value: stats.calls_analyzed ?? 0,
      subtitle: 'this period',
      Icon: Activity,
      accent: 'text-slate-700',
    },
    {
      label: 'Top blocker',
      value: stats.top_blocker_calls ?? 0,
      subtitle: stats.top_blocker_theme || '—',
      Icon: AlertTriangle,
      accent: 'text-rose-700',
    },
    {
      label: 'Biggest strength',
      value: '★',
      subtitle: stats.biggest_strength_theme || '—',
      Icon: TrendingUp,
      accent: 'text-emerald-700',
      valueIsLabel: true,
    },
    {
      label: 'High-severity items',
      value: stats.high_severity_count ?? 0,
      subtitle: 'across SWOT + functions',
      Icon: AlertCircle,
      accent: 'text-amber-700',
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      {cells.map((c, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
          <c.Icon className={`w-5 h-5 ${c.accent} shrink-0 mt-0.5`} />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{c.label}</div>
            <div className={`font-black ${c.accent} ${c.valueIsLabel ? 'text-2xl' : 'text-2xl tabular-nums'}`}>
              {c.value}
            </div>
            <div className="text-xs text-slate-500 truncate" title={c.subtitle}>{c.subtitle}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Function Improvement Areas — CSO/CGO action-oriented section ───────────
function FunctionImprovementsSection({ blocks }) {
  // Index blocks by function key so we can render in canonical order even if
  // the model returns them shuffled.
  const byKey = {};
  for (const b of blocks || []) {
    if (b && b.function) byKey[b.function] = b;
  }
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">For CSO / Head of Sales / CGO</p>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight" style={{ fontFamily: "'Fraunces', serif" }}>
            Key Improvement Areas by Function
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Themes scoped to the team that owns the fix, with concrete next actions and call citations.
          </p>
        </div>
      </div>
      <div className="space-y-4">
        {FUNCTION_ORDER.map((key) => {
          const block = byKey[key] || { function: key, items: [] };
          return <FunctionBlockCard key={key} block={block} />;
        })}
      </div>
    </section>
  );
}

function FunctionBlockCard({ block }) {
  const meta = FUNCTION_META[block.function] || { label: block.function, Icon: Activity, accent: 'text-slate-700 bg-slate-50 border-slate-200' };
  const items = block.items || [];
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${meta.accent}`}>
          <meta.Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-900">{meta.label}</h3>
          <p className="text-xs text-slate-500">
            {items.length === 0 ? 'No issues identified for this period' : `${items.length} improvement ${items.length === 1 ? 'theme' : 'themes'}`}
          </p>
        </div>
      </div>
      {items.length > 0 && (
        <ol className="space-y-3">
          {items.map((it, i) => <FunctionImprovementItem key={i} item={it} />)}
        </ol>
      )}
    </div>
  );
}

function FunctionImprovementItem({ item }) {
  const sev = SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.medium;
  return (
    <li className="border border-slate-100 bg-slate-50/60 rounded-xl p-3">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h4 className="text-sm font-bold text-slate-900">{item.theme}</h4>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${sev}`}>
          {item.severity}
        </span>
        {item.evidence_count > 0 && (
          <span className="text-[10px] text-slate-400">{item.evidence_count} {item.evidence_count === 1 ? 'call' : 'calls'}</span>
        )}
      </div>
      <p className="text-sm text-slate-600 leading-snug mb-1.5">{item.detail}</p>
      {item.recommended_action && (
        <div className="bg-white border-l-2 border-indigo-300 px-3 py-1.5 rounded-r-md text-xs text-slate-700">
          <span className="font-bold uppercase tracking-wider text-[9px] text-indigo-600 mr-2">Action</span>
          {item.recommended_action}
        </div>
      )}
      {(item.example_clean_numbers || []).length > 0 && (
        <CleanNumberCitations numbers={item.example_clean_numbers} totalCount={item.evidence_count} />
      )}
    </li>
  );
}

function SwotSkeleton() {
  return (
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
