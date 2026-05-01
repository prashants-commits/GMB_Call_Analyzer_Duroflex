// E4 — Score-card UI for a completed drill.
//
// Polls GET /api/trainer/score-cards/{drillUuid} every 2s after mount until
// the card is written (E1 background task). Hard cap: 60s of polling, then
// shows a friendly "scoring is taking longer than expected" with a manual
// retry button. Drill state of CANCELLED / FAILED stops polling immediately.
//
// Layout (top → bottom):
//   - Title bar: persona name, store, scored timestamp, overall band caption
//   - Big circular gauge with overall_score
//   - 9-axis section bar chart
//   - Top-3 strengths + Top-3 gaps side-by-side
//   - Moment clips (verbatim quotes from transcript)
//   - "Try a similar drill" CTA → /trainer/drill/new (MVP: no weakness biasing)

import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Award, AlertTriangle, MessageSquareQuote, ChevronRight } from 'lucide-react';

import Header from '../../components/Header';
import { trainer, TrainerHTTPError } from '../../utils/trainerApi';

// Section keys + display labels MUST stay aligned with backend SECTION_WEIGHTS
// in trainer/scoring/schema.py.
const SECTION_ORDER = [
  ['opening',            'Opening',            10],
  ['need_discovery',     'Need Discovery',     15],
  ['product_pitch',      'Product Pitch',      15],
  ['objection_handling', 'Objection Handling', 15],
  ['hook_usage',         'Hook Usage',         15],
  ['closing',            'Closing',            10],
  ['soft_skills',        'Soft Skills',        10],
  ['brand_compliance',   'Brand Compliance',   5],
  ['time_management',    'Time Management',    5],
];

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 60_000;

export default function ScoreCardPage() {
  const navigate = useNavigate();
  const { drillUuid } = useParams();

  const [card, setCard] = useState(null);     // full payload
  const [drillStatus, setDrillStatus] = useState(null);
  const [error, setError] = useState(null);
  const [pollExpired, setPollExpired] = useState(false);
  const [retryToken, setRetryToken] = useState(0); // bump to restart polling

  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!drillUuid) return;
    let cancelled = false;
    let timer = null;
    startedAtRef.current = Date.now();
    setPollExpired(false);
    setError(null);

    const tick = async () => {
      try {
        const res = await trainer.scoreCards.get(drillUuid);
        if (cancelled) return;
        if (res && res.ready === false) {
          setDrillStatus(res.drill_status || null);
          // Stop polling early if the drill itself can't produce a score.
          if (['cancelled', 'failed'].includes(res.drill_status)) {
            setPollExpired(true);
            return;
          }
          if (Date.now() - startedAtRef.current > POLL_MAX_MS) {
            setPollExpired(true);
            return;
          }
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          setCard(res);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof TrainerHTTPError && err.status === 403) {
          setError('You do not have access to this drill.');
        } else if (err instanceof TrainerHTTPError && err.status === 404) {
          setError('Drill not found.');
        } else {
          setError(err?.message || 'Failed to load score card.');
        }
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [drillUuid, retryToken]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/trainer" className="text-sm text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to trainer home
          </Link>
          {drillUuid && (
            <span className="text-xs text-slate-400 font-mono">{drillUuid.slice(0, 8)}…</span>
          )}
        </div>

        {error && (
          <Panel>
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-700">
              <strong>Couldn't load score card.</strong>
              <div className="text-sm mt-1">{error}</div>
            </div>
          </Panel>
        )}

        {!error && !card && !pollExpired && (
          <ScoringSpinner drillStatus={drillStatus} />
        )}

        {!error && !card && pollExpired && (
          <Panel>
            <div className="text-center py-6">
              {drillStatus === 'cancelled' || drillStatus === 'failed' ? (
                <>
                  <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                  <div className="text-lg font-bold text-slate-900 mb-1">No score card</div>
                  <div className="text-sm text-slate-500 mb-4">
                    This drill ended in <code className="font-mono">{drillStatus}</code> — no transcript to score.
                  </div>
                </>
              ) : (
                <>
                  <RefreshCw className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <div className="text-lg font-bold text-slate-900 mb-1">Scoring is taking longer than expected</div>
                  <div className="text-sm text-slate-500 mb-4">
                    Last drill status: <code className="font-mono">{drillStatus || 'unknown'}</code>.
                    The score card should appear within ~30s under nominal conditions.
                  </div>
                </>
              )}
              <div className="mt-4 flex items-center justify-center gap-3">
                {drillStatus !== 'cancelled' && drillStatus !== 'failed' && (
                  <button
                    onClick={() => setRetryToken((n) => n + 1)}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold px-4 py-2 rounded-xl inline-flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" /> Try again
                  </button>
                )}
                <Link
                  to="/trainer"
                  className="text-sm text-slate-500 hover:text-slate-900 px-4 py-2"
                >
                  Back to home
                </Link>
              </div>
            </div>
          </Panel>
        )}

        {card && <CardBody card={card} navigate={navigate} />}
      </div>
    </div>
  );
}

function CardBody({ card, navigate }) {
  const sc = card.scorecard || {};
  // section_scores comes from the backend as a list [{name, score, rationale}, ...]
  // Index it by name for fast lookup in the canonical render order below.
  const sectionScores = {};
  for (const row of (sc.section_scores || [])) {
    if (row && row.name) sectionScores[row.name] = row;
  }
  const overall = Number(sc.overall_score ?? 0);
  const band = sc.overall_band || '';
  const lowSignal = !!sc.low_signal;

  return (
    <>
      <Panel>
        <div className="flex flex-col sm:flex-row gap-6 items-center">
          <Gauge value={overall} />
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <div className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1">Score card</div>
            <div className="text-2xl font-black text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
              {card.persona_name || card.persona_id || 'Drill'}
            </div>
            <div className="text-sm text-slate-500 mt-0.5">
              {card.store_name} · {fmtScoredAt(card.scored_at)}
              {card.duration_seconds != null && (
                <> · {Math.floor(card.duration_seconds / 60)}m {card.duration_seconds % 60}s</>
              )}
            </div>
            {band && (
              <div className="mt-2 text-base font-semibold text-slate-800">
                {band}
              </div>
            )}
            {lowSignal && (
              <div className="mt-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                <AlertTriangle className="w-3 h-3" /> Low signal — too little transcript to score reliably
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-3">Section scores</div>
        <ul className="space-y-2.5">
          {SECTION_ORDER.map(([key, label, weight]) => {
            const row = sectionScores[key];
            const score = row ? Number(row.score) : 0;
            const rationale = row?.rationale || '';
            return (
              <li key={key} className="grid grid-cols-[160px_1fr_40px] gap-3 items-center">
                <div className="text-sm text-slate-700 font-medium truncate" title={label}>
                  {label}
                  <span className="text-[10px] text-slate-400 ml-1">·{weight}</span>
                </div>
                <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 ${barColor(score)}`}
                    style={{ width: `${score * 10}%` }}
                  />
                </div>
                <div className="text-sm font-bold text-slate-900 text-right tabular-nums">{score}/10</div>
                {rationale && (
                  <div className="col-span-3 -mt-1 ml-[172px] text-xs text-slate-500">
                    {rationale}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel>
          <div className="flex items-center gap-2 mb-2">
            <Award className="w-4 h-4 text-emerald-600" />
            <div className="text-xs uppercase tracking-widest text-slate-500 font-bold">Top 3 strengths</div>
          </div>
          {Array.isArray(sc.top_3_strengths) && sc.top_3_strengths.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-slate-800">
              {sc.top_3_strengths.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-emerald-600">●</span>{s}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-400">None highlighted.</div>
          )}
        </Panel>

        <Panel>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <div className="text-xs uppercase tracking-widest text-slate-500 font-bold">Top 3 gaps</div>
          </div>
          {Array.isArray(sc.top_3_gaps) && sc.top_3_gaps.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-slate-800">
              {sc.top_3_gaps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-rose-500">●</span>{s}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-400">None highlighted.</div>
          )}
        </Panel>
      </div>

      {Array.isArray(sc.moment_clips) && sc.moment_clips.length > 0 && (
        <Panel>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquareQuote className="w-4 h-4 text-indigo-500" />
            <div className="text-xs uppercase tracking-widest text-slate-500 font-bold">Moments to review</div>
          </div>
          <ul className="space-y-3">
            {sc.moment_clips.map((m, i) => (
              <li key={i} className="border-l-4 border-slate-200 pl-3">
                <div className="text-xs uppercase tracking-wider text-slate-500 font-bold flex gap-2 items-center">
                  <SentimentDot value={m.sentiment} />
                  <span>{m.label}</span>
                </div>
                <div className="text-sm text-slate-800 mt-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-2">{m.speaker}</span>
                  &ldquo;{m.quote}&rdquo;
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 justify-center">
        <button
          onClick={() => navigate('/trainer')}
          className="text-sm font-bold text-slate-700 hover:text-slate-900 px-4 py-2"
        >
          Back to trainer home
        </button>
        <button
          onClick={() => navigate('/trainer/drill/new')}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm px-5 py-2.5 rounded-xl inline-flex items-center gap-2"
        >
          Try another drill <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}

function ScoringSpinner({ drillStatus }) {
  return (
    <Panel>
      <div className="text-center py-10">
        <div className="inline-block w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mb-4" />
        <div className="text-lg font-bold text-slate-900 mb-1">Scoring your drill…</div>
        <div className="text-sm text-slate-500">
          Gemini is reviewing the transcript. This usually takes 10–30 seconds.
        </div>
        {drillStatus && (
          <div className="mt-3 text-[11px] uppercase tracking-widest text-slate-400">
            drill state: {drillStatus}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Gauge({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 48;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - v / 100);
  const stroke = v >= 85 ? 'stroke-emerald-500'
              : v >= 70 ? 'stroke-lime-500'
              : v >= 55 ? 'stroke-amber-500'
              : 'stroke-rose-500';
  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} className="stroke-slate-100" strokeWidth="10" fill="none" />
        <circle
          cx="60"
          cy="60"
          r={r}
          className={`${stroke} transition-all duration-700`}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-black text-slate-900 tabular-nums">{v}</div>
        <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">/ 100</div>
      </div>
    </div>
  );
}

function SentimentDot({ value }) {
  if (value === 'good')   return <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />;
  if (value === 'missed') return <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />;
}

function barColor(score) {
  if (score >= 8) return 'bg-emerald-500';
  if (score >= 6) return 'bg-lime-500';
  if (score >= 4) return 'bg-amber-500';
  return 'bg-rose-500';
}

function fmtScoredAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function Panel({ children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4">{children}</div>
  );
}
