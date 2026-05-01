import React, { useEffect, useState } from 'react';

// Shows MM:SS counting down from `maxSeconds` once `running` flips true.
// Calls `onElapsed` exactly once when the timer hits zero.
export default function CallTimer({ running, maxSeconds = 300, startAt = null, onElapsed }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const beganAt = startAt ?? now;
  const elapsedSec = running ? Math.floor((now - beganAt) / 1000) : 0;
  const remaining = Math.max(0, maxSeconds - elapsedSec);

  useEffect(() => {
    if (running && remaining === 0 && onElapsed) onElapsed();
  }, [running, remaining, onElapsed]);

  const pct = Math.max(0, Math.min(1, remaining / maxSeconds));
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;

  // Color shifts as time runs out.
  const tone = pct > 0.5 ? 'text-slate-900' : pct > 0.2 ? 'text-amber-600' : 'text-rose-600';

  return (
    <div className="flex items-center gap-3">
      <span className={`font-mono text-2xl font-black tabular-nums ${tone}`}>
        {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
      </span>
      <div className="w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            pct > 0.5 ? 'bg-emerald-500' : pct > 0.2 ? 'bg-amber-500' : 'bg-rose-500'
          }`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
