import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Sparkles, AlertCircle, CheckCircle2, Library } from 'lucide-react';
import Header from '../../../components/Header';
import PersonaCard from '../../../components/trainer/PersonaCard';
import { trainer, TrainerHTTPError } from '../../../utils/trainerApi';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Pilot stores eligible for per-store persona generation. Mirrors the 6 stores
// the trainer is being rolled out to. If you add a store in the roster /
// city_store_mapping, add it here too so admins can target it.
const PILOT_STORES = [
  'COCO INDIRANAGAR',
  'COCO WHITEFIELD',
  'COCO BANJARA HILLS',
  'COCO AIRPORT ROAD BLR',
  'COCO ANNA NAGAR',
  'COCO KONDAPUR',
];

export default function PersonaLibraryPage() {
  const navigate = useNavigate();
  const [actor, setActor] = useState(null);
  const [draft, setDraft] = useState(null);
  const [published, setPublished] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [seeding, setSeeding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);
  const [generateStore, setGenerateStore] = useState(PILOT_STORES[0]);
  const pollRef = useRef(null);

  // Auth probe (admin-only)
  useEffect(() => {
    trainer.me()
      .then((d) => {
        if (d.actor.role !== 'admin') {
          setError("This page is admin-only.");
          setLoading(false);
        } else {
          setActor(d.actor);
        }
      })
      .catch((err) => {
        if (err instanceof TrainerHTTPError && err.status === 401) {
          navigate('/trainer/identify', { replace: true });
        } else {
          setError(err.message);
          setLoading(false);
        }
      });
  }, [navigate]);

  // Initial load
  useEffect(() => {
    if (!actor) return;
    refresh().finally(() => setLoading(false));
  }, [actor]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function refresh() {
    const [d, p] = await Promise.allSettled([
      trainer.personas.admin.getDraft(),
      trainer.personas.listPublished(),
    ]);
    if (d.status === 'fulfilled') setDraft(d.value.library);
    if (p.status === 'fulfilled') setPublished(p.value.library ? p.value : null);
  }

  async function handleSeed() {
    setActionFeedback(null);
    setSeeding(true);
    try {
      const res = await trainer.personas.admin.seed();
      setActionFeedback({ kind: 'ok', message: res.message || 'Seeded.' });
      await refresh();
    } catch (err) {
      setActionFeedback({ kind: 'error', message: err.message });
    } finally {
      setSeeding(false);
    }
  }

  async function handleGenerate() {
    setActionFeedback(null);
    setGenerating(true);
    setGenerationStatus({ status: 'queued', start: Date.now() });
    try {
      const { job } = await trainer.personas.admin.generate({
        store_name: generateStore,
      });
      pollRef.current = setInterval(async () => {
        if (Date.now() - generationStatus.start > POLL_TIMEOUT_MS) {
          clearInterval(pollRef.current);
          setGenerating(false);
          setActionFeedback({ kind: 'error', message: 'Generation timed out (5 min).' });
          return;
        }
        try {
          const { job: latest } = await trainer.personas.admin.job(job.job_id);
          setGenerationStatus({ ...latest, start: generationStatus.start });
          if (latest.status === 'completed') {
            clearInterval(pollRef.current);
            setGenerating(false);
            setActionFeedback({
              kind: 'ok',
              message: `Generated ${latest.persona_count} personas (₹${(latest.cost_inr || 0).toFixed(2)}).`,
            });
            await refresh();
          } else if (latest.status === 'failed') {
            clearInterval(pollRef.current);
            setGenerating(false);
            setActionFeedback({ kind: 'error', message: latest.error || 'Generation failed.' });
          }
        } catch (err) {
          clearInterval(pollRef.current);
          setGenerating(false);
          setActionFeedback({ kind: 'error', message: err.message });
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setGenerating(false);
      const detail = err instanceof TrainerHTTPError ? err.detail : err.message;
      setActionFeedback({ kind: 'error', message: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    }
  }

  async function handlePublish() {
    setActionFeedback(null);
    setPublishing(true);
    try {
      const res = await trainer.personas.admin.publish();
      setActionFeedback({
        kind: 'ok',
        message: `Published v${res.library.version} with ${res.library.personas.length} personas.`,
      });
      await refresh();
    } catch (err) {
      setActionFeedback({ kind: 'error', message: err.message });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <Header />

      <div className="max-w-[1400px] mx-auto px-8 py-8">
        <Link to="/trainer/admin" className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 mb-4 hover:gap-2 transition-all uppercase tracking-widest">
          <ArrowLeft className="w-3 h-3" /> Back to Admin
        </Link>

        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Trainer Admin</p>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight" style={{ fontFamily: "'Fraunces', serif" }}>
              Persona Library
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              The published library is what staff drill against in mock calls. Generate from real
              call data, review the draft, then publish to make it live.
            </p>
          </div>
        </div>

        {loading && <div className="text-slate-500">Loading…</div>}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
            {error}
          </div>
        )}

        {!loading && actor && (
          <>
            {/* Action toolbar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSeed}
                  disabled={seeding || generating}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2"
                  title="Load the bundled hand-crafted seed library (8 personas) into the draft. Useful for instant Group D testing."
                >
                  <Library className="w-4 h-4" />
                  {seeding ? 'Seeding…' : 'Load seed library'}
                </button>

                <div className="flex items-center gap-2">
                  <select
                    value={generateStore}
                    onChange={(e) => setGenerateStore(e.target.value)}
                    disabled={generating || seeding}
                    className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white disabled:opacity-50"
                    title="Persona generation reads up to 100 latest transcripts from this store"
                  >
                    {PILOT_STORES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleGenerate}
                    disabled={generating || seeding}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2"
                    title="Run the full pipeline: per-call signature extraction + cluster+synthesise from the selected store's calls. Uses gemini-3.1-pro-preview."
                  >
                    <Sparkles className={`w-4 h-4 ${generating ? 'animate-pulse' : ''}`} />
                    {generating ? 'Generating…' : 'Generate from real calls'}
                  </button>
                </div>

                <div className="flex-1" />

                {draft && (
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {publishing ? 'Publishing…' : `Publish draft v${draft.version}`}
                  </button>
                )}
              </div>

              {generating && generationStatus && (
                <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Status: {generationStatus.status}
                  {generationStatus.persona_count != null && ` · ${generationStatus.persona_count} personas so far`}
                </div>
              )}

              {actionFeedback && (
                <div
                  className={`mt-3 text-sm rounded-lg px-3 py-2 flex items-start gap-2 ${
                    actionFeedback.kind === 'ok'
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {actionFeedback.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                  <span>{actionFeedback.message}</span>
                </div>
              )}
            </div>

            {/* Side-by-side: Published vs Draft */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <LibraryPanel
                title="Published (live)"
                emptyHint="Nothing published yet. Build a draft, then click Publish."
                library={published?.library}
                personas={published?.personas}
                accent="emerald"
              />
              <LibraryPanel
                title="Draft"
                emptyHint="No draft yet. Click Load seed library or Generate from corpus to begin."
                library={draft}
                personas={draft?.personas}
                accent="slate"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LibraryPanel({ title, emptyHint, library, personas, accent }) {
  const accentClass = accent === 'emerald'
    ? 'border-emerald-200 bg-emerald-50/40'
    : 'border-slate-200 bg-slate-50/40';

  return (
    <section className={`rounded-2xl border ${accentClass} p-5`}>
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {library && (
          <span className="text-xs text-slate-500">
            v{library.version} · {(personas || []).length} personas · ₹{(library.cost_inr || 0).toFixed(2)}
          </span>
        )}
      </div>

      {!library ? (
        <div className="text-sm text-slate-400 italic">{emptyHint}</div>
      ) : (
        <>
          {library.notes && (
            <div className="mb-3 text-xs text-slate-500 italic">{library.notes}</div>
          )}
          <div className="grid grid-cols-1 gap-3">
            {(personas || []).map((p) => (
              <PersonaCard key={p.persona_id} persona={p} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
