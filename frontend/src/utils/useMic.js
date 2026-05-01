// D5 — Browser microphone capture hook.
//
// Captures 16-bit PCM at 16 kHz mono via an AudioWorklet. Emits ~320 ms chunks
// (the size that Gemini Live prefers). Reports a 0..1 RMS level for the VU meter.
//
// We re-resample inside the worklet because most laptops capture at 48 kHz
// natively; downsampling to 16 kHz keeps the upstream WS bandwidth low.

import { useCallback, useEffect, useRef, useState } from 'react';

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_MS = 320;

// Inline AudioWorklet processor as a Blob URL so we don't ship a separate JS file.
//
// We rely on the AudioContext being constructed at the target sample rate
// (16 kHz). When that's honored, NO resampling happens here — we just slice
// chunks at chunkSamples and convert Float32 -> Int16. If the browser refuses
// the requested rate (sampleRate ends up != target), we fall back to high-
// quality linear interpolation instead of integer-only decimation, so the
// output rate is correct regardless.
const WORKLET_SOURCE = `
class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions.targetSampleRate;
    this.chunkSamples = options.processorOptions.chunkSamples;
    this.srcRate = sampleRate;
    this.ratio = this.srcRate / this.targetSampleRate;
    this.needResample = Math.abs(this.ratio - 1.0) > 0.001;
    this.acc = [];
    this.fracPos = 0;            // fractional position into the current frame (for resampler)
    this.lastSample = 0;         // tail sample to interpolate the next frame's first output
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.levelTimer = 0;
    this.port.postMessage({ kind: 'config', srcRate: this.srcRate, ratio: this.ratio, needResample: this.needResample });
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    // RMS level for the meter.
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      this.sumSquares += s * s;
      this.sampleCount++;
    }
    this.levelTimer += ch.length;
    if (this.levelTimer >= this.srcRate * 0.032) {
      const rms = Math.sqrt(this.sumSquares / Math.max(1, this.sampleCount));
      this.port.postMessage({ kind: 'level', value: Math.min(1, rms * 4) });
      this.sumSquares = 0;
      this.sampleCount = 0;
      this.levelTimer = 0;
    }

    if (!this.needResample) {
      // Fast path: AudioContext is already at the target rate.
      for (let i = 0; i < ch.length; i++) this.acc.push(ch[i]);
    } else {
      // Linear-interp resampler. ratio = srcRate / targetRate.
      // We step through the source frame at fractional positions and
      // interpolate between neighboring samples. State (fracPos, lastSample)
      // is preserved across process() calls.
      const ratio = this.ratio;
      let pos = this.fracPos;
      while (pos < ch.length) {
        const i0 = Math.floor(pos);
        const i1 = i0 + 1;
        const frac = pos - i0;
        const s0 = i0 === 0 ? this.lastSample : ch[i0 - 0]; // ch[i0]
        const a = ch[i0] !== undefined ? ch[i0] : this.lastSample;
        const b = ch[i1] !== undefined ? ch[i1] : a;
        this.acc.push(a * (1 - frac) + b * frac);
        pos += ratio;
      }
      this.fracPos = pos - ch.length;
      this.lastSample = ch[ch.length - 1];
    }

    while (this.acc.length >= this.chunkSamples) {
      const slice = this.acc.slice(0, this.chunkSamples);
      this.acc = this.acc.slice(this.chunkSamples);
      // Float32 -> Int16 LE
      const buf = new ArrayBuffer(slice.length * 2);
      const view = new DataView(buf);
      for (let i = 0; i < slice.length; i++) {
        let v = Math.max(-1, Math.min(1, slice[i]));
        view.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      }
      this.port.postMessage({ kind: 'pcm', buffer: buf }, [buf]);
    }
    return true;
  }
}
registerProcessor('mic-processor', MicProcessor);
`;

export function useMic({ onChunk, paused = false, muted = false } = {}) {
  const [state, setState] = useState('idle'); // idle | starting | running | stopped | error
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(0);

  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const nodeRef = useRef(null);
  const onChunkRef = useRef(onChunk);
  const pausedRef = useRef(paused);
  const mutedRef = useRef(muted);
  useEffect(() => { onChunkRef.current = onChunk; }, [onChunk]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const start = useCallback(async () => {
    if (state === 'running' || state === 'starting') return;
    setError(null);
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: { ideal: TARGET_SAMPLE_RATE },
        },
      });
      streamRef.current = stream;

      // Force the AudioContext to 16 kHz so the worklet's fast path is used
      // and we avoid any browser-specific resampling drift. Some browsers
      // ignore the request and pick their default rate (typically 48 kHz),
      // in which case the worklet's interpolating resampler kicks in.
      let ctx;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
      } catch {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      ctxRef.current = ctx;
      // eslint-disable-next-line no-console
      console.info('[useMic] AudioContext sampleRate =', ctx.sampleRate);

      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);

      const node = new AudioWorkletNode(ctx, 'mic-processor', {
        processorOptions: {
          targetSampleRate: TARGET_SAMPLE_RATE,
          chunkSamples: Math.floor(TARGET_SAMPLE_RATE * (CHUNK_MS / 1000)),
        },
      });
      let chunksEmittedReal = 0;
      let chunksEmittedSilence = 0;
      let chunksDropped = 0;
      node.port.onmessage = (e) => {
        if (!e.data) return;
        if (e.data.kind === 'config') {
          // eslint-disable-next-line no-console
          console.info('[useMic] worklet config:', e.data);
          return;
        }
        if (e.data.kind === 'pcm') {
          // ── paused: drop chunks entirely (WS not ready) ─────────────────
          if (pausedRef.current) {
            chunksDropped++;
            if (chunksDropped === 1 || chunksDropped % 60 === 0) {
              // eslint-disable-next-line no-console
              console.info(`[useMic] dropped ${chunksDropped} paused chunks`);
            }
            return;
          }
          // ── muted: zero-fill the buffer but STILL emit so the upstream
          //        sees continuous PCM. Gemini Live's VAD needs continuous
          //        audio (silence included) to detect end-of-turn — abruptly
          //        stopping the stream leaves it in limbo. Half-duplex during
          //        AI's turn + push-to-talk both rely on this.
          let buffer = e.data.buffer;
          if (mutedRef.current) {
            new Int16Array(buffer).fill(0);
            chunksEmittedSilence++;
            if (chunksEmittedSilence === 1 || chunksEmittedSilence % 60 === 0) {
              // eslint-disable-next-line no-console
              console.info(`[useMic] muted (silence) ${chunksEmittedSilence} chunks`);
            }
          } else {
            chunksEmittedReal++;
            if (chunksEmittedReal === 1 || chunksEmittedReal % 30 === 0) {
              // eslint-disable-next-line no-console
              console.info(`[useMic] real ${chunksEmittedReal} chunks (${buffer.byteLength}B)`);
            }
          }
          if (onChunkRef.current) onChunkRef.current(buffer);
        } else if (e.data.kind === 'level') {
          setLevel(e.data.value);
        }
      };
      const src = ctx.createMediaStreamSource(stream);
      src.connect(node);
      // Connect the node to a muted gain so the worklet runs (Chrome requires
      // a destination connection for the graph to pull data).
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
      nodeRef.current = node;

      setState('running');
    } catch (err) {
      setError(err.message || String(err));
      setState('error');
      // Cleanup partial setup
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      try { ctxRef.current?.close(); } catch {}
      streamRef.current = null;
      ctxRef.current = null;
      nodeRef.current = null;
    }
  }, [state]);

  const stop = useCallback(() => {
    try { nodeRef.current?.disconnect(); } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { ctxRef.current?.close(); } catch {}
    nodeRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    setLevel(0);
    setState('stopped');
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => stop(), [stop]);

  return { state, error, level, start, stop };
}
