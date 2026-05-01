// D7 — WebSocket client wrapper for the drill bridge.
//
// Sends mic chunks as binary frames; receives Gemini audio as binary frames
// and JSON events as text frames. No auto-reconnect: drills are short and a
// reconnect would re-trigger a Gemini Live session (and a state-machine
// 4409). On any close, we surface the close reason to the caller.

import { useCallback, useEffect, useRef, useState } from 'react';

export function useDrillSocket({ wsUrl, onAudio, onEvent }) {
  const [status, setStatus] = useState('idle'); // idle | connecting | open | closed | error
  const [closeInfo, setCloseInfo] = useState(null);
  const wsRef = useRef(null);
  const onAudioRef = useRef(onAudio);
  const onEventRef = useRef(onEvent);

  useEffect(() => { onAudioRef.current = onAudio; }, [onAudio]);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const connect = useCallback(() => {
    if (!wsUrl) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return; // already open / connecting

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const fullUrl = wsUrl.startsWith('ws') ? wsUrl : `${proto}//${window.location.host}${wsUrl}`;
    setStatus('connecting');
    setCloseInfo(null);

    const ws = new WebSocket(fullUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => setStatus('open');

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        if (onAudioRef.current) onAudioRef.current(ev.data);
        return;
      }
      try {
        const event = JSON.parse(ev.data);
        if (onEventRef.current) onEventRef.current(event);
      } catch {
        /* ignore malformed text frames */
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = (ev) => {
      setStatus('closed');
      setCloseInfo({ code: ev.code, reason: ev.reason || '' });
    };
  }, [wsUrl]);

  const pcmSentRef = useRef(0);
  const pcmDroppedRef = useRef(0);
  const sendPCM = useCallback((arrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) {
      pcmDroppedRef.current++;
      if (pcmDroppedRef.current === 1 || pcmDroppedRef.current % 20 === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[useDrillSocket] dropped ${pcmDroppedRef.current} chunks (ws.readyState=${ws ? ws.readyState : 'null'})`,
        );
      }
      return;
    }
    ws.send(arrayBuffer);
    pcmSentRef.current++;
    if (pcmSentRef.current === 1 || pcmSentRef.current % 30 === 0) {
      // eslint-disable-next-line no-console
      console.info(`[useDrillSocket] sent ${pcmSentRef.current} chunks (${arrayBuffer.byteLength} bytes each)`);
    }
  }, []);

  const sendEvent = useCallback((event) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(event));
  }, []);

  const close = useCallback((code = 1000, reason = 'client_close') => {
    const ws = wsRef.current;
    if (!ws) return;
    try { ws.close(code, reason); } catch { /* ignore */ }
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
  }, []);

  return { status, closeInfo, connect, sendPCM, sendEvent, close };
}
