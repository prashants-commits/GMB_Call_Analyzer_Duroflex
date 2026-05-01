// Browser SpeechSynthesis wrapper for AI dialog playback (Rung B).
//
// Why this exists as a hook (not a one-liner):
//   - Voice picking is async on Chrome (voices arrive after a `voiceschanged`
//     event). Components shouldn't have to know that.
//   - We want a single mute switch, queue management, and a `speaking` state
//     the UI can react to (so we can dim mic affordances while the AI speaks
//     once Rung C lands).
//   - Swappable backend: today this uses window.speechSynthesis (free, ships
//     in every browser, ~15 voices on Chrome). Tomorrow we can plug in a
//     server-side TTS (Gemini/ElevenLabs) by swapping the speak() body and
//     keeping the same hook surface.

import { useCallback, useEffect, useRef, useState } from 'react';

const SUPPORTED = typeof window !== 'undefined' && 'speechSynthesis' in window;

function pickVoice(voices, langPrefs) {
  if (!voices || !voices.length) return null;
  for (const lang of langPrefs) {
    const exact = voices.find((v) => v.lang === lang);
    if (exact) return exact;
    const loose = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(lang.toLowerCase()));
    if (loose) return loose;
  }
  // Fall back to default English.
  return voices.find((v) => /en[-_]/i.test(v.lang)) || voices[0];
}

/**
 * @param {object} opts
 * @param {string[]} [opts.langPrefs] preferred BCP-47 langs in order
 * @param {number} [opts.rate]   playback rate (0.1 .. 10, default 1.0)
 * @param {number} [opts.pitch]  pitch (0 .. 2, default 1.0)
 * @param {boolean} [opts.muted] start muted
 */
export function useTTS({ langPrefs = ['en-IN', 'en-GB', 'en-US', 'en'], rate = 1.0, pitch = 1.0, muted: initialMuted = false } = {}) {
  const [supported] = useState(SUPPORTED);
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState(null);
  const [muted, setMuted] = useState(initialMuted);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef(null);
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Voice list arrives asynchronously on Chrome. Listen for `voiceschanged`
  // and keep our chosen voice in sync.
  useEffect(() => {
    if (!supported) return;
    const refresh = () => {
      const list = window.speechSynthesis.getVoices() || [];
      setVoices(list);
      setVoice((v) => v || pickVoice(list, langPrefs));
    };
    refresh();
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', refresh);
  }, [supported, langPrefs]);

  const cancel = useCallback(() => {
    if (!supported) return;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    setSpeaking(false);
    utteranceRef.current = null;
  }, [supported]);

  /** Speak a single utterance. Cancels any previous one. Returns a Promise
   *  that resolves on `end` or `error`. No-op when muted (still resolves). */
  const speak = useCallback((text) => {
    if (!supported) return Promise.resolve();
    if (mutedRef.current) return Promise.resolve();
    const cleaned = (text || '').trim();
    if (!cleaned) return Promise.resolve();

    return new Promise((resolve) => {
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      const u = new SpeechSynthesisUtterance(cleaned);
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = pitch;
      u.onstart = () => setSpeaking(true);
      u.onend = () => { setSpeaking(false); resolve(); };
      u.onerror = () => { setSpeaking(false); resolve(); };
      utteranceRef.current = u;
      window.speechSynthesis.speak(u);
    });
  }, [supported, voice, rate, pitch]);

  // Cleanup on unmount.
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch {} }, []);

  return {
    supported,
    voices,
    voice,
    setVoice,
    muted,
    setMuted: (next) => {
      setMuted(next);
      if (next) cancel();
    },
    speak,
    cancel,
    speaking,
  };
}
