// D6 — Browser audio playback hook.
//
// Receives raw 16-bit PCM @ 24 kHz mono from the WS bridge and schedules it
// on a single AudioContext at WebAudio's clock-precise time. We maintain a
// short ring of buffers to absorb network jitter without underruns.

import { useCallback, useEffect, useRef, useState } from 'react';

const SAMPLE_RATE = 24000;

export function useGeminiPlayback() {
  const [playing, setPlaying] = useState(false);
  const [lagMs, setLagMs] = useState(0);
  const ctxRef = useRef(null);
  const nextStartRef = useRef(0);
  const lastLagSampleRef = useRef(0);

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const enqueuePCM = useCallback((arrayBuffer) => {
    if (!arrayBuffer || arrayBuffer.byteLength < 2) return;
    const ctx = ensureCtx();

    // Convert s16le -> Float32
    const int16 = new Int16Array(arrayBuffer);
    const float = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float[i] = int16[i] / 0x8000;
    }

    const buffer = ctx.createBuffer(1, float.length, SAMPLE_RATE);
    buffer.copyToChannel(float, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    let startAt = nextStartRef.current;
    if (startAt < now + 0.05) {
      // Behind schedule — re-anchor with a small lead.
      startAt = now + 0.05;
    }
    source.start(startAt);
    nextStartRef.current = startAt + buffer.duration;

    setPlaying(true);
    // Throttle lag updates.
    const now2 = performance.now();
    if (now2 - lastLagSampleRef.current > 250) {
      lastLagSampleRef.current = now2;
      setLagMs(Math.max(0, Math.round((startAt - now) * 1000)));
    }
  }, [ensureCtx]);

  const reset = useCallback(() => {
    nextStartRef.current = 0;
    setPlaying(false);
    setLagMs(0);
  }, []);

  // How many ms of audio are still scheduled to play. Used by the half-duplex
  // phase machine to know when "AI is speaking" truly ends so PTT can unlock.
  const getRemainingMs = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return 0;
    return Math.max(0, Math.round((nextStartRef.current - ctx.currentTime) * 1000));
  }, []);

  useEffect(() => () => {
    try { ctxRef.current?.close(); } catch {}
    ctxRef.current = null;
  }, []);

  return { enqueuePCM, reset, playing, lagMs, getRemainingMs };
}
