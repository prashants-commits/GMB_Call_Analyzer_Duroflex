import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Headphones, AlertCircle, Download } from 'lucide-react';
import Header from '../../components/Header';
import SwotReportBody from '../../components/trainer/SwotReportBody';
import { trainer, TrainerHTTPError } from '../../utils/trainerApi';
import { downloadSwotPdf } from '../../utils/swotPdf';

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
      <div className="print:hidden"><Header /></div>

      <div className="max-w-[1400px] mx-auto px-8 py-8">
        <Link to="/trainer" className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 mb-4 hover:gap-2 transition-all uppercase tracking-widest print:hidden">
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

          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => downloadSwotPdf({ scope: 'store', name: storeName, generatedAt: report?.generated_at })}
              disabled={!report || refreshing}
              className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition shadow-sm"
              title="Open the browser print dialog and save this report as a PDF"
            >
              <Download className="w-4 h-4" /> Download PDF
            </button>
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

        {!loading && !error && report && <SwotReportBody report={report} />}

        {!loading && !error && report && (
          <div className="mt-6 text-xs text-slate-400 flex items-center gap-2 border-t border-slate-100 pt-4 print:hidden">
            <Headphones className="w-3 h-3" />
            <span>
              Models: <span className="font-mono text-slate-600">{report.model_map}</span> · <span className="font-mono text-slate-600">{report.model_reduce}</span>
              {' · '}Cost: <span className="font-mono text-slate-600">₹{(report.cost_inr || 0).toFixed(2)}</span>
              {report.notes && <> · {report.notes}</>}
            </span>
          </div>
        )}
      </div>

      {/* Print stylesheet — same layout rules as the Insights-side SWOT
          Reports page so saved PDFs are visually identical regardless of
          which UI generated them. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          html, body { background: white !important; }
          body * { box-shadow: none !important; }
          .print\\:hidden { display: none !important; }
          section, ol > li, ul > li, .rounded-2xl { break-inside: avoid; page-break-inside: avoid; }
          .max-w-\\[1400px\\] { max-width: 100% !important; padding: 0 !important; }
          .py-8 { padding-top: 0 !important; padding-bottom: 0 !important; }
          a { color: #1d4ed8 !important; text-decoration: none !important; }
        }
      `}</style>
    </div>
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
