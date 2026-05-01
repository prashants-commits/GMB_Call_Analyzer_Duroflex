import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Phone, PhoneOff, Mic, MicOff, AlertCircle, Hand } from 'lucide-react';

const DRILL_PAGE_VERSION = 'v7-2026-05-01-ptt-half-duplex';
import Header from '../../components/Header';
import MicMeter from '../../components/trainer/MicMeter';
import CallTimer from '../../components/trainer/CallTimer';
import { trainer, TrainerHTTPError } from '../../utils/trainerApi';
import { useMic } from '../../utils/useMic';
import { useGeminiPlayback } from '../../utils/useGeminiPlayback';
import { useDrillSocket } from '../../utils/useDrillSocket';
import DrillTextMode from './DrillTextMode';

const DIFF_BADGE = {
  easy:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  hard:   'bg-rose-50 text-rose-700 border-rose-200',
};

export default function DrillPage() {
  const navigate = useNavigate();
  const { drillUuid: drillUuidParam } = useParams();

  // Mount-time version banner so the user can confirm in DevTools that the
  // latest code is loaded. If you don't see this line, do a *full* page reload
  // (Ctrl+Shift+R wasn't enough for the Blob-URL AudioWorklet — try clearing
  // the site's cache or close + reopen the tab).
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.info(`[Drill] DrillPage mounted — ${DRILL_PAGE_VERSION}`);
  }, []);

  const [actor, setActor] = useState(null);
  const [drill, setDrill] = useState(null); // { drill_uuid, persona, ws_url, hard_timeout_seconds }

  // Phase machine (half-duplex strict PTT):
  //   initialising → starting → ai_speaking ⇄ idle ⇄ armed → sending → ai_speaking …
  //                                                                    ↓
  //                                                                  ended | error
  // PTT button is enabled ONLY in 'idle'. AI cannot be interrupted, mic
  // captures only while SPACE is held, and the whole held-buffer is sent
  // as one Gemini Live turn on release.
  const [phase, setPhase] = useState('initialising');
  const phaseRef = useRef('initialising');
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const [endStatus, setEndStatus] = useState(null);
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [callStartedAt, setCallStartedAt] = useState(null);

  // Audio playback (raw PCM s16le @ 24 kHz from Gemini Live).
  const { enqueuePCM, reset: resetPlayback, getRemainingMs } = useGeminiPlayback();

  // Buffer for the current PTT turn — array of ArrayBuffer chunks emitted by
  // the mic worklet while phase==='armed'. Concatenated and sent on release.
  const turnBufferRef = useRef([]);

  const onWsAudio = useCallback((arrayBuffer) => {
    // Any inbound AI audio implies AI is speaking now.
    if (phaseRef.current !== 'ended' && phaseRef.current !== 'error') {
      if (phaseRef.current !== 'ai_speaking') setPhase('ai_speaking');
    }
    enqueuePCM(arrayBuffer);
  }, [enqueuePCM]);

  const onWsEvent = useCallback((event) => {
    if (!event || !event.type) return;
    if (event.type === 'state') {
      // eslint-disable-next-line no-console
      console.info('[Drill] state ->', event.status);
      if (event.status === 'in_call') {
        // AI greets first under turn-based input — go straight to ai_speaking
        // so PTT is locked until the greeting finishes.
        setPhase('ai_speaking');
        setCallStartedAt(Date.now());
      } else if (['completed', 'failed', 'timed_out', 'cancelled'].includes(event.status)) {
        setPhase('ended');
        setEndStatus({ status: event.status, reason: event.reason });
      }
    } else if (event.type === 'transcript') {
      setTranscript((t) => {
        const last = t[t.length - 1];
        if (last && last.partial && last.speaker === event.speaker) {
          return [...t.slice(0, -1), event];
        }
        return [...t, event];
      });
    } else if (event.type === 'turn_complete') {
      // AI's reply is done — but audio may still be queued. Wait until the
      // playback queue drains, then unlock PTT by going back to 'idle'.
      const remainingMs = getRemainingMs();
      // eslint-disable-next-line no-console
      console.info(`[Drill] turn_complete — unlocking PTT in ${remainingMs}ms`);
      setTimeout(() => {
        if (phaseRef.current === 'ai_speaking') setPhase('idle');
      }, remainingMs + 100);
    } else if (event.type === 'error') {
      // eslint-disable-next-line no-console
      console.error('[Drill] error event:', event);
      setError(event.reason || 'Drill error');
      setPhase('error');
    }
    // 'interrupted' and any legacy 'debug' frames are ignored under
    // half-duplex strict PTT.
  }, [getRemainingMs]);

  const ws = useDrillSocket({
    wsUrl: drill ? drill.ws_url : null,
    onAudio: onWsAudio,
    onEvent: onWsEvent,
  });

  // Mic chunks: collect into turnBufferRef while armed; drop otherwise.
  const onMicChunk = useCallback((arrayBuffer) => {
    if (phaseRef.current === 'armed') {
      turnBufferRef.current.push(arrayBuffer);
    }
  }, []);

  // Run the mic only during the active call (idle | armed | sending | ai_speaking).
  // No 'muted' silence-fill needed — turn-based input cares only about the
  // single concatenated buffer we send on PTT release.
  const inCall = ['idle', 'armed', 'sending', 'ai_speaking'].includes(phase);
  const mic = useMic({ onChunk: onMicChunk, paused: !inCall, muted: false });

  // Concatenate the turn buffer and send as one binary WS frame (= one turn).
  const flushTurn = useCallback(() => {
    const chunks = turnBufferRef.current;
    turnBufferRef.current = [];
    if (chunks.length === 0) {
      // PTT tap < ~30 ms: nothing captured. Just go back to idle.
      // eslint-disable-next-line no-console
      console.info('[Drill] PTT released with empty buffer — staying idle');
      setPhase('idle');
      return;
    }
    const totalBytes = chunks.reduce((sum, ab) => sum + ab.byteLength, 0);
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const ab of chunks) {
      merged.set(new Uint8Array(ab), offset);
      offset += ab.byteLength;
    }
    // eslint-disable-next-line no-console
    console.info(`[Drill] PTT released — sending one turn of ${totalBytes}B (${(totalBytes / 32000).toFixed(1)}s)`);
    ws.sendPCM(merged.buffer);
  }, [ws]);

  // ── Spacebar Push-to-Talk handler (active for the whole call lifetime) ────
  useEffect(() => {
    if (!inCall) return;
    const onDown = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      // Only arm the mic when truly idle — locks during ai_speaking/sending.
      if (phaseRef.current !== 'idle') {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      turnBufferRef.current = [];
      // eslint-disable-next-line no-console
      console.info('[Drill] PTT pressed — recording turn');
      setPhase('armed');
    };
    const onUp = (e) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (phaseRef.current !== 'armed') return;
      setPhase('sending');
      flushTurn();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [inCall, flushTurn]);

  // ── Mic state console hint ────────────────────────────────────────────────
  useEffect(() => {
    if (!inCall) return;
    // eslint-disable-next-line no-console
    console.info(`[Drill] phase=${phase} (mic ${phase === 'armed' ? 'CAPTURING' : 'idle'})`);
  }, [phase, inCall]);

  // ── Step 1: validate auth + start a drill ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const me = await trainer.me();
        if (cancelled) return;
        setActor(me.actor);
      } catch (err) {
        if (err instanceof TrainerHTTPError && err.status === 401) {
          navigate('/trainer/identify', { replace: true });
          return;
        }
        setError(err.message);
        setPhase('error');
        return;
      }

      // If we already have a drill_uuid in the URL, just connect; otherwise
      // start a fresh drill. Today, every entry to /trainer/drill creates a
      // fresh drill — the URL pattern leaves room to "resume" a drill later.
      if (drillUuidParam && drillUuidParam !== 'new') {
        // Just connect to the existing drill — also fetch the persona so
        // the UI doesn't get stuck on "Connecting…" without a persona name.
        try {
          const info = await trainer.drills.get(drillUuidParam);
          if (cancelled) return;
          if (['completed', 'failed', 'cancelled', 'timed_out'].includes(info.status)) {
            setEndStatus({ status: info.status, reason: info.disposition_reason });
            setPhase('ended');
            return;
          }
          let personaJson = null;
          if (info.persona_id) {
            try {
              personaJson = await trainer.personas.get(info.persona_id);
            } catch { /* persona fetch is best-effort */ }
          }
          setDrill({
            drill_uuid: info.drill_uuid,
            mode: info.mode || 'text',
            ws_url: info.ws_url,
            kickoff_url: info.kickoff_url,
            turn_url: info.turn_url,
            end_url: info.end_url,
            model: info.model,
            persona: personaJson,
            hard_timeout_seconds: 300,
          });
          setPhase('starting');
        } catch (err) {
          if (cancelled) return;
          setError(typeof err.detail === 'string' ? err.detail : err.message);
          setPhase('error');
        }
        return;
      }

      try {
        const startBody = {};
        const res = await trainer.drills.start(startBody);
        if (cancelled) return;
        setDrill(res);
        setPhase('starting');
        // Update URL so refreshing keeps the right drill_uuid context.
        navigate(`/trainer/drill/${res.drill_uuid}`, { replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(typeof err.detail === 'string' ? err.detail : err.message);
        setPhase('error');
      }
    }
    init();
    return () => { cancelled = true; };
  }, [drillUuidParam, navigate]);

  // ── Step 2: when drill seeded, connect WS + start mic (voice mode only) ───
  useEffect(() => {
    if (phase !== 'starting' || !drill) return;
    if (drill.mode === 'text') return; // Rung B handles its own lifecycle
    ws.connect();
    mic.start();
  }, [phase, drill]); // intentionally not depending on ws/mic identities

  // ── Step 3: handle WS close after we've gone live ─────────────────────────
  useEffect(() => {
    if (ws.status === 'closed' && inCall) {
      setPhase('ended');
      if (!endStatus) setEndStatus({ status: 'completed', reason: ws.closeInfo?.reason });
    }
  }, [ws.status, inCall, endStatus, ws.closeInfo]);

  // ── End-of-drill side-effects ─────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'ended' || phase === 'error') {
      mic.stop();
      resetPlayback();
      turnBufferRef.current = [];
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── End-call action (user clicks End or timer hits 0) ─────────────────────
  const endCall = useCallback(() => {
    ws.sendEvent({ type: 'end' });
    // Server transitions to COMPLETED and closes the WS.
    setTimeout(() => {
      if (inCall) ws.close(1000, 'client_end');
    }, 1500);
  }, [ws, inCall]);

  const cancelCall = useCallback(async () => {
    ws.close(1000, 'cancel');
    if (drill?.drill_uuid) {
      try { await trainer.drills.cancel(drill.drill_uuid); } catch { /* swallow */ }
    }
    setEndStatus({ status: 'cancelled', reason: 'staff_cancelled' });
    setPhase('ended');
  }, [ws, drill]);

  const persona = drill?.persona;
  const diffClass = persona ? (DIFF_BADGE[persona.difficulty_band] || DIFF_BADGE.medium) : '';

  // ── Mode dispatch: text (Rung B) gets its own self-contained component.
  //    Voice (Rung C) falls through to the legacy UI below.
  if (drill && drill.mode === 'text' && phase !== 'error') {
    return (
      <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        <Header />
        <DrillTextMode
          drill={drill}
          onExit={() => {
            navigate('/trainer/drill/new');
            window.location.reload();
          }}
          onTimeUp={() => { /* server-side end is handled inside DrillTextMode */ }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <Header />

      <div className="max-w-[1100px] mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-4">
          <Link to="/trainer" className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:gap-2 transition-all uppercase tracking-widest">
            <ArrowLeft className="w-3 h-3" /> Back to AI Trainer
          </Link>
          <span
            className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"
            title="If you don't see this badge with the right version, you're running stale cached code — close the tab and reopen, or open in incognito."
          >
            {DRILL_PAGE_VERSION}
          </span>
        </div>

        {/* Top header with persona + timer */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Mock Call Drill</p>
              {persona ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight" style={{ fontFamily: "'Fraunces', serif" }}>
                      {persona.name}
                    </h1>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${diffClass}`}>
                      {persona.difficulty_band}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-2">{persona.summary}</p>
                </>
              ) : (
                <h1 className="text-2xl font-black text-slate-900 tracking-tight" style={{ fontFamily: "'Fraunces', serif" }}>
                  Connecting…
                </h1>
              )}
            </div>

            {inCall && (
              <CallTimer
                running={inCall}
                maxSeconds={drill?.hard_timeout_seconds || 300}
                startAt={callStartedAt}
                onElapsed={() => endCall()}
              />
            )}
          </div>

          {persona?.opening_line_hint && phase !== 'ended' && phase !== 'error' && (
            <div className="mt-4 text-sm text-slate-600 italic border-l-2 border-slate-200 pl-3">
              "{persona.opening_line_hint}"
            </div>
          )}
        </div>

        {/* Phase-driven main panel */}
        {phase === 'initialising' && <Skeleton text="Validating session…" />}

        {phase === 'starting' && (
          <Panel>
            <div className="text-center py-8">
              <div className="text-sm uppercase tracking-widest text-slate-400 font-bold mb-2">Connecting</div>
              <div className="text-slate-700">
                Setting up your microphone and dialing the customer…
              </div>
              <div className="mt-4 text-xs text-slate-500">
                WS status: <span className="font-mono">{ws.status}</span> · Mic: <span className="font-mono">{mic.state}</span>
              </div>
              {mic.error && (
                <div className="mt-3 text-sm text-rose-600">Mic error: {mic.error}</div>
              )}
            </div>
          </Panel>
        )}

        {inCall && (
          <Panel>
            {/* Status pill */}
            <div className="flex items-center justify-center mb-4">
              <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live · half-duplex PTT
              </span>
            </div>

            {/* Phase guidance */}
            <div className={`text-center text-sm font-bold mb-2 transition-colors ${
              phase === 'armed' ? 'text-rose-600' :
              phase === 'sending' ? 'text-indigo-600' :
              phase === 'ai_speaking' ? 'text-amber-600' :
              'text-slate-700'
            }`}>
              {phase === 'armed' && (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" /> Recording — release SPACE when done
                </span>
              )}
              {phase === 'sending' && (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" /> Sending your turn…
                </span>
              )}
              {phase === 'ai_speaking' && (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" /> Customer is speaking — please wait
                </span>
              )}
              {phase === 'idle' && (
                <>Hold <kbd className="px-2 py-0.5 mx-1 rounded bg-slate-100 border border-slate-300 font-mono text-xs">SPACE</kbd> to talk</>
              )}
            </div>

            <MicMeter
              level={mic.level}
              listening={phase === 'armed'}
            />

            <div className="mt-4 text-center text-xs text-slate-400">
              {phase === 'armed' ? (
                <><Mic className="w-3 h-3 inline-block mr-1" /> Mic capturing — speak now</>
              ) : phase === 'idle' ? (
                <><Hand className="w-3 h-3 inline-block mr-1" /> Mic armed — hold SPACE to record your turn</>
              ) : (
                <><MicOff className="w-3 h-3 inline-block mr-1" /> Mic locked — half-duplex (AI cannot be interrupted)</>
              )}
            </div>

            <Transcript items={transcript} />

            <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={endCall}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl flex items-center gap-2 shadow"
              >
                <Phone className="w-4 h-4" /> End call
              </button>
              <button
                onClick={cancelCall}
                className="bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 hover:border-rose-300 font-bold text-sm px-5 py-2.5 rounded-xl flex items-center gap-2"
              >
                <PhoneOff className="w-4 h-4" /> Cancel
              </button>
            </div>
          </Panel>
        )}

        {phase === 'ended' && endStatus && (
          <PostDrillPanel
            endStatus={endStatus}
            transcript={transcript}
            drillUuid={drill?.drill_uuid || drillUuidParam}
            navigate={navigate}
            setTranscript={setTranscript}
          />
        )}

        {(phase === 'error' || error) && (
          <Panel>
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <strong>Drill error.</strong> {String(error || 'Unknown error')}
              </div>
            </div>
            <div className="mt-4 text-sm text-slate-500 text-center">
              <Link to="/trainer" className="text-indigo-600 hover:underline">Back to home</Link>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Panel({ children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">{children}</div>
  );
}

// E5 — post-drill landing. On COMPLETED / TIMED_OUT we auto-navigate to the
// score-card page after ~1.8s (enough to register the "Call complete"
// confirmation). For CANCELLED / FAILED there's no score card to render, so
// stay on this screen with the "Try another drill" CTA.
function PostDrillPanel({ endStatus, transcript, drillUuid, navigate, setTranscript }) {
  const willScore = endStatus.status === 'completed' || endStatus.status === 'timed_out';
  const [redirecting, setRedirecting] = useState(willScore);

  useEffect(() => {
    if (!willScore || !drillUuid) return;
    const t = setTimeout(() => {
      navigate(`/trainer/score-cards/${drillUuid}`);
    }, 1800);
    return () => clearTimeout(t);
  }, [willScore, drillUuid, navigate]);

  return (
    <Panel>
      <div className="text-center py-6">
        <div className="text-2xl font-black text-slate-900 mb-2" style={{ fontFamily: "'Fraunces', serif" }}>
          {endStatus.status === 'completed' && 'Call complete'}
          {endStatus.status === 'timed_out' && 'Time’s up — 5 minutes elapsed'}
          {endStatus.status === 'cancelled' && 'Drill cancelled'}
          {endStatus.status === 'failed' && 'Drill failed'}
        </div>
        {endStatus.reason && (
          <div className="text-sm text-slate-500 mb-4">{endStatus.reason}</div>
        )}
        {willScore ? (
          <div className="text-sm text-slate-500 mb-6 inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
            {redirecting ? 'Opening your score card…' : 'Preparing score card…'}
          </div>
        ) : (
          <div className="text-sm text-slate-400 mb-6">
            No score card produced for this status.
          </div>
        )}
        <Transcript items={transcript} compact />
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {willScore && drillUuid && (
            <button
              onClick={() => navigate(`/trainer/score-cards/${drillUuid}`)}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm px-5 py-2.5 rounded-xl"
            >
              View score card now
            </button>
          )}
          <button
            onClick={() => {
              setTranscript([]);
              setRedirecting(false);
              navigate('/trainer/drill/new');
              window.location.reload();
            }}
            className={`${willScore ? 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200' : 'bg-slate-900 hover:bg-slate-800 text-white'} font-bold text-sm px-5 py-2.5 rounded-xl`}
          >
            Try another drill
          </button>
        </div>
      </div>
    </Panel>
  );
}

function Skeleton({ text }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500">
      {text}
    </div>
  );
}

function Transcript({ items, compact = false }) {
  // Live mode shows the full call history (no slice cap); compact end-of-call
  // summary stays trimmed to the last 6 lines for visual density.
  const scrollerRef = useRef(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items?.length]);
  if (!items || items.length === 0) return null;
  const displayed = compact ? items.slice(-6) : items;
  return (
    <div ref={scrollerRef} className={`mt-${compact ? '4' : '6'} bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-72 overflow-y-auto`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">Transcript (live)</div>
      <ul className="space-y-1.5 text-sm">
        {displayed.map((it, i) => (
          <li key={i} className={`${it.speaker === 'customer' ? 'text-slate-900' : 'text-indigo-700'} ${it.partial ? 'opacity-60 italic' : ''}`}>
            <strong className="text-[10px] uppercase tracking-wider mr-2">{it.speaker}</strong>
            {it.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
