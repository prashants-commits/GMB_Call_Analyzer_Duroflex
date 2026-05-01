// Rung B drill UI — text-in / spoken-text-out. Picks up after DrillPage has
// validated auth and either started a fresh drill or loaded an existing one.
//
// Rendering contract:
//   <DrillTextMode drill={drillStartResponse} actor={meActor} onExit={fn} />
//
// `drill` matches POST /api/trainer/drills/start when mode==='text':
//   { drill_uuid, persona, mode:'text', kickoff_url, turn_url, end_url,
//     hard_timeout_seconds, model }

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Send, Phone, Volume2, VolumeX, Loader2 } from 'lucide-react';

import CallTimer from '../../components/trainer/CallTimer';
import { useDrillTextSession } from '../../utils/useDrillTextSession';
import { useTTS } from '../../utils/useTTS';

const DIFF_BADGE = {
  easy:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  hard:   'bg-rose-50 text-rose-700 border-rose-200',
};

export default function DrillTextMode({ drill, onExit, onTimeUp }) {
  const navigate = useNavigate();
  const persona = drill?.persona || null;
  const drillUuid = drill?.drill_uuid;

  // ── Conversation state ────────────────────────────────────────────────────
  // messages: [{ id, speaker:'staff'|'customer', text, partial?:bool }]
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [endedReason, setEndedReason] = useState(null);
  const idRef = useRef(0);
  const nextId = () => ++idRef.current;

  const tts = useTTS({ langPrefs: ['en-IN', 'en-GB', 'en-US', 'en'] });

  // ── Append a finished turn ───────────────────────────────────────────────
  const appendMessage = useCallback((speaker, text) => {
    setMessages((prev) => {
      // If the last message is a partial from the same speaker (live AI
      // streaming), replace it with the final.
      const last = prev[prev.length - 1];
      if (last && last.partial && last.speaker === speaker) {
        return [...prev.slice(0, -1), { id: last.id, speaker, text, partial: false }];
      }
      return [...prev, { id: nextId(), speaker, text, partial: false }];
    });

    // Speak the AI's lines (if not muted). User's lines are silent.
    if (speaker === 'customer') {
      tts.speak(text);
    }
  }, [tts]);

  // ── Live-stream the AI's deltas into a partial message bubble ────────────
  const onAssistantDelta = useCallback((delta) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.partial && last.speaker === 'customer') {
        return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
      }
      return [...prev, { id: nextId(), speaker: 'customer', text: delta, partial: true }];
    });
  }, []);

  const onSessionError = useCallback((reason) => {
    // eslint-disable-next-line no-console
    console.error('[DrillTextMode] session error:', reason);
  }, []);

  const session = useDrillTextSession({
    drillUuid,
    onMessage: appendMessage,
    onAssistantDelta,
    onError: onSessionError,
  });

  // ── Kickoff once on mount ────────────────────────────────────────────────
  const kickedOffRef = useRef(false);
  useEffect(() => {
    if (!drillUuid || kickedOffRef.current) return;
    kickedOffRef.current = true;
    setCallStartedAt(Date.now());
    session.kickoff().catch((err) => {
      // Surface in UI via session.phase='error'; nothing extra to do here.
      // eslint-disable-next-line no-console
      console.error('[DrillTextMode] kickoff failed:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillUuid]);

  // ── User sends a turn ────────────────────────────────────────────────────
  const sending = session.phase === 'sending' || session.phase === 'streaming';
  const ended = session.phase === 'ended' || endedReason !== null;

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || ended) return;
    setInput('');
    try {
      await session.sendTurn(text);
    } catch (err) {
      // Surfaced via session.error; keep the turn in the transcript anyway.
      // eslint-disable-next-line no-console
      console.error('[DrillTextMode] send failed:', err);
    }
  }, [input, sending, ended, session]);

  const handleKey = useCallback((e) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ── End-of-drill ─────────────────────────────────────────────────────────
  const handleEnd = useCallback(async (reason = 'staff_ended') => {
    if (ended) return;
    tts.cancel();
    setEndedReason(reason);
    await session.endCall(reason);
  }, [ended, session, tts]);

  const handleTimeUp = useCallback(() => {
    if (ended) return;
    onTimeUp?.();
    handleEnd('time_elapsed');
  }, [ended, handleEnd, onTimeUp]);

  // Auto-scroll to newest message.
  const scrollerRef = useRef(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const diffClass = persona ? (DIFF_BADGE[persona.difficulty_band] || DIFF_BADGE.medium) : '';
  const kickingOff = session.phase === 'idle' || session.phase === 'kicking_off';

  return (
    <div className="max-w-[1100px] mx-auto px-8 py-8">
      <div className="flex items-center justify-between mb-4">
        <Link to="/trainer" className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:gap-2 transition-all uppercase tracking-widest">
          <ArrowLeft className="w-3 h-3" /> Back to AI Trainer
        </Link>
        <span className="text-[10px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
          rung-B · text · {drill?.model || 'gemini'}
        </span>
      </div>

      {/* ── Persona header ─────────────────────────────────────────────── */}
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

          {!ended && callStartedAt && (
            <CallTimer
              running={!ended}
              maxSeconds={drill?.hard_timeout_seconds || 300}
              startAt={callStartedAt}
              onElapsed={handleTimeUp}
            />
          )}
        </div>
      </div>

      {/* ── Error pane (if session blew up) ─────────────────────────────── */}
      {session.error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-4 text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <strong>Drill error.</strong> {session.error}
          </div>
        </div>
      )}

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live · Text drill
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => tts.setMuted(!tts.muted)}
              className={`text-xs font-bold inline-flex items-center gap-1.5 px-2 py-1 rounded-md border transition ${
                tts.muted
                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
              title={tts.muted ? 'Voice muted — click to enable AI voice' : 'Click to mute AI voice'}
              disabled={!tts.supported}
            >
              {tts.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              {tts.muted ? 'Voice off' : 'Voice on'}
            </button>
          </div>
        </div>

        <div ref={scrollerRef} className="px-4 py-4 max-h-[55vh] min-h-[280px] overflow-y-auto bg-slate-50/50">
          {kickingOff && messages.length === 0 && (
            <div className="text-center text-sm text-slate-500 py-8 inline-flex items-center justify-center gap-2 w-full">
              <Loader2 className="w-4 h-4 animate-spin" />
              Customer is dialing in…
            </div>
          )}

          <ul className="space-y-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} personaName={persona?.name} />
            ))}
          </ul>

          {sending && messages[messages.length - 1]?.speaker !== 'customer' && (
            <div className="text-xs text-slate-400 italic mt-3 inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> {persona?.name?.split(',')[0] || 'Customer'} is typing…
            </div>
          )}
        </div>

        {/* ── Input row ─────────────────────────────────────────────────── */}
        <div className="border-t border-slate-100 p-3 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={ended ? 'Drill ended.' : 'Type your reply… (Enter sends · Shift+Enter for newline)'}
              disabled={ended || kickingOff}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending || ended || kickingOff}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm px-4 py-2.5 rounded-xl flex items-center gap-2 shadow"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>
              The AI plays the customer. You play the store staff. Stay in the language they use.
            </span>
            {!ended && (
              <button
                onClick={() => handleEnd('staff_ended')}
                className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold uppercase tracking-wider text-[10px]"
              >
                <Phone className="w-3 h-3" /> End call
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Ended panel ─────────────────────────────────────────────────── */}
      {ended && (
        <TextEndedPanel
          endedReason={endedReason}
          drillUuid={drillUuid}
          navigate={navigate}
          onExit={onExit}
        />
      )}
    </div>
  );
}

function TextEndedPanel({ endedReason, drillUuid, navigate, onExit }) {
  // Auto-redirect to score card after a short pause so the trainee registers
  // "Call complete" before the page changes.
  useEffect(() => {
    if (!drillUuid) return;
    const t = setTimeout(() => {
      navigate(`/trainer/score-cards/${drillUuid}`);
    }, 1800);
    return () => clearTimeout(t);
  }, [drillUuid, navigate]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mt-6 text-center">
      <div className="text-2xl font-black text-slate-900 mb-1" style={{ fontFamily: "'Fraunces', serif" }}>
        Call complete
      </div>
      <div className="text-sm text-slate-500 mb-4">
        {endedReason === 'time_elapsed' ? 'Time’s up — 5 minutes elapsed.' : 'Drill ended.'}
      </div>
      <div className="text-sm text-slate-500 mb-6 inline-flex items-center gap-2">
        <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
        Opening your score card…
      </div>
      <div className="flex flex-wrap gap-3 items-center justify-center">
        {drillUuid && (
          <button
            onClick={() => navigate(`/trainer/score-cards/${drillUuid}`)}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm px-5 py-2.5 rounded-xl"
          >
            View score card now
          </button>
        )}
        <button
          onClick={onExit}
          className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-sm px-5 py-2.5 rounded-xl"
        >
          Try another drill
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ message, personaName }) {
  const mine = message.speaker === 'staff';
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
        mine
          ? 'bg-indigo-600 text-white rounded-br-md'
          : 'bg-white border border-slate-200 text-slate-900 rounded-bl-md'
      } ${message.partial ? 'opacity-90' : ''}`}>
        <div className={`text-[10px] uppercase tracking-wider mb-0.5 font-bold ${mine ? 'text-indigo-200' : 'text-slate-400'}`}>
          {mine ? 'You' : (personaName?.split(',')[0] || 'Customer')}
        </div>
        <div>{message.text}{message.partial && <span className="opacity-60">▍</span>}</div>
      </div>
    </li>
  );
}
