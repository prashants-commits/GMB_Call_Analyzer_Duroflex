// Rung B drill client — text-in / streamed-text-out via the backend's HTTP+SSE
// endpoints. Mirrors useDrillSocket.js (Rung C) so DrillPage can pick a
// transport without knowing the wire details.
//
// Wire shape (matches backend/trainer/router.py):
//   POST /api/trainer/drills/{uuid}/kickoff   → {speaker, text}
//   POST /api/trainer/drills/{uuid}/turn      → SSE stream:
//        event: delta   data: {"text":"..."}
//        event: done    data: {"ok":true}
//        event: error   data: {"reason":"..."}
//   POST /api/trainer/drills/{uuid}/end       → {drill_uuid, status}
//
// We parse SSE manually rather than using the built-in EventSource because
// EventSource is GET-only — and we need POST to send the user's message.

import { useCallback, useEffect, useRef, useState } from 'react';

import { TrainerHTTPError } from './trainerApi';

const TRAINER_BASE = '/api/trainer';

async function postJSON(path) {
  const res = await fetch(`${TRAINER_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    let detail;
    try { detail = (await res.json())?.detail; } catch { detail = res.statusText; }
    throw new TrainerHTTPError(res.status, detail);
  }
  return res.json();
}

/** Parse an SSE byte stream into {event, data} objects via async-iter. */
async function* parseSSE(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE messages are separated by a blank line. Process complete messages.
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      yield { event, data };
    }
  }
}

/**
 * @param {object} opts
 * @param {string|null} opts.drillUuid
 * @param {(speaker, text)=>void} [opts.onMessage]   final committed turns
 * @param {(text)=>void} [opts.onAssistantDelta]      streamed AI deltas (UX)
 * @param {(reason)=>void} [opts.onError]
 */
export function useDrillTextSession({ drillUuid, onMessage, onAssistantDelta, onError }) {
  const [phase, setPhase] = useState('idle'); // idle | kicking_off | ready | sending | streaming | ended | error
  const [error, setError] = useState(null);
  const onMessageRef = useRef(onMessage);
  const onAssistantDeltaRef = useRef(onAssistantDelta);
  const onErrorRef = useRef(onError);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onAssistantDeltaRef.current = onAssistantDelta; }, [onAssistantDelta]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const abortRef = useRef(null);
  const endedRef = useRef(false);

  const reportError = useCallback((reason) => {
    setError(reason);
    setPhase('error');
    onErrorRef.current?.(reason);
  }, []);

  /** Open the session and fetch the AI's opening line. Idempotent. */
  const kickoff = useCallback(async () => {
    if (!drillUuid) return null;
    setPhase('kicking_off');
    try {
      const body = await postJSON(`/drills/${encodeURIComponent(drillUuid)}/kickoff`);
      const text = body?.text || '';
      onMessageRef.current?.('customer', text);
      setPhase('ready');
      return text;
    } catch (err) {
      const reason = typeof err.detail === 'string' ? err.detail : err.message;
      reportError(reason);
      throw err;
    }
  }, [drillUuid, reportError]);

  /** Send a user turn and stream the AI reply. Resolves with the full reply
   *  text after `done`. Throws on error or if called out of phase. */
  const sendTurn = useCallback(async (text) => {
    if (!drillUuid) throw new Error('No drill_uuid');
    const cleaned = (text || '').trim();
    if (!cleaned) return '';

    // Commit the user's turn to the visible transcript immediately.
    onMessageRef.current?.('staff', cleaned);

    setPhase('sending');
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let res;
    try {
      res = await fetch(`${TRAINER_BASE}/drills/${encodeURIComponent(drillUuid)}/turn`, {
        method: 'POST',
        credentials: 'include',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ text: cleaned }),
      });
    } catch (err) {
      if (err.name === 'AbortError') return '';
      reportError(err.message);
      throw err;
    }

    if (!res.ok) {
      let detail;
      try { detail = (await res.json())?.detail; } catch { detail = res.statusText; }
      reportError(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
      throw new TrainerHTTPError(res.status, detail);
    }

    setPhase('streaming');
    let full = '';
    const reader = res.body.getReader();
    try {
      for await (const { event, data } of parseSSE(reader)) {
        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (event === 'delta' && parsed.text) {
          full += parsed.text;
          onAssistantDeltaRef.current?.(parsed.text);
        } else if (event === 'done') {
          break;
        } else if (event === 'error') {
          reportError(parsed.reason || 'stream_error');
          break;
        }
      }
    } finally {
      try { reader.releaseLock?.(); } catch { /* ignore */ }
      abortRef.current = null;
    }

    if (full) {
      onMessageRef.current?.('customer', full);
    }
    if (!endedRef.current) setPhase('ready');
    return full;
  }, [drillUuid, reportError]);

  /** End the drill server-side. Best-effort. */
  const endCall = useCallback(async (reason = 'staff_ended') => {
    endedRef.current = true;
    if (abortRef.current) abortRef.current.abort();
    setPhase('ended');
    if (!drillUuid) return null;
    try {
      const res = await fetch(`${TRAINER_BASE}/drills/${encodeURIComponent(drillUuid)}/end`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }, [drillUuid]);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  return { phase, error, kickoff, sendTurn, endCall };
}
