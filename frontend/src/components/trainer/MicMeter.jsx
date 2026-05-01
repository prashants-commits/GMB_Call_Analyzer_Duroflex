import React from 'react';

// Big, lush mic-level meter. 16 vertical bars filling left-to-right.
// `level` is 0..1.
export default function MicMeter({ level = 0, listening = false }) {
  const bars = 16;
  const filled = Math.round(level * bars);

  return (
    <div className="flex items-center justify-center gap-1.5 py-3">
      {Array.from({ length: bars }).map((_, i) => {
        const active = i < filled && listening;
        const intensity = i / bars;
        return (
          <span
            key={i}
            className={`inline-block w-2 rounded-sm transition-all ${
              active
                ? intensity < 0.4
                  ? 'bg-emerald-400'
                  : intensity < 0.75
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
                : listening
                ? 'bg-slate-200'
                : 'bg-slate-100'
            }`}
            style={{
              height: `${12 + intensity * 36}px`,
            }}
          />
        );
      })}
    </div>
  );
}
