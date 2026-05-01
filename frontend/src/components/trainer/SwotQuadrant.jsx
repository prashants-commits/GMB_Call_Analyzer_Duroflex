import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';

const SEVERITY_STYLES = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
};

const QUADRANT_TINTS = {
  strengths:     { bg: 'bg-emerald-50/60',  border: 'border-emerald-200', label: 'text-emerald-700', dot: 'bg-emerald-500' },
  weaknesses:    { bg: 'bg-rose-50/60',     border: 'border-rose-200',    label: 'text-rose-700',    dot: 'bg-rose-500' },
  opportunities: { bg: 'bg-sky-50/60',      border: 'border-sky-200',     label: 'text-sky-700',     dot: 'bg-sky-500' },
  threats:       { bg: 'bg-amber-50/60',    border: 'border-amber-200',   label: 'text-amber-700',   dot: 'bg-amber-500' },
};

export default function SwotQuadrant({ kind, title, items }) {
  const tint = QUADRANT_TINTS[kind] || QUADRANT_TINTS.strengths;
  return (
    <section className={`rounded-2xl border ${tint.border} ${tint.bg} p-5`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-block h-2 w-2 rounded-full ${tint.dot}`} />
        <h2 className={`text-xs font-black uppercase tracking-widest ${tint.label}`}>{title}</h2>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-slate-400 italic">No clear signal in this batch.</div>
      ) : (
        <ol className="space-y-3">
          {items.map((item, i) => <SwotItem key={i} item={item} />)}
        </ol>
      )}
    </section>
  );
}

function SwotItem({ item }) {
  const [open, setOpen] = useState(false);
  const hasQuotes = (item.representative_quotes || []).length > 0;
  const hasCitations = (item.example_clean_numbers || []).length > 0;
  const sev = SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.medium;

  return (
    <li className="bg-white border border-slate-200 rounded-xl p-3 hover:shadow-sm transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-bold text-slate-900">{item.theme}</h3>
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${sev}`}>
              {item.severity}
            </span>
            {item.evidence_count > 0 && (
              <span className="text-[10px] text-slate-400">{item.evidence_count} {item.evidence_count === 1 ? 'call' : 'calls'}</span>
            )}
          </div>
          <p className="text-sm text-slate-600 leading-snug">{item.detail}</p>
          {hasCitations && <CleanNumberCitations numbers={item.example_clean_numbers} totalCount={item.evidence_count} />}
        </div>
        {hasQuotes && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-slate-400 hover:text-slate-700 p-0.5 shrink-0"
            aria-label={open ? 'Hide quotes' : 'Show quotes'}
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
      </div>

      {open && hasQuotes && (
        <ul className="mt-2 pl-3 border-l-2 border-slate-100 space-y-1.5">
          {item.representative_quotes.map((q, i) => (
            <li key={i} className="text-xs text-slate-500 italic leading-snug">"{q}"</li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Reusable phone-citation strip used by SWOT quadrant items + Function-
// Improvement items. Mirrors the InsightsDashboard `CleanNumberList`
// styling and links each number to /call/{cleanNumber}.
export function CleanNumberCitations({ numbers, totalCount, label = 'Examples' }) {
  if (!numbers || numbers.length === 0) return null;
  const showCount = typeof totalCount === 'number' && totalCount > 0;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 items-center">
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mr-1">
        {label}{showCount ? ` (${totalCount} total)` : ''}:
      </span>
      {numbers.map((n) => (
        <Link
          key={n}
          to={`/call/${n}`}
          className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-2 py-0.5 rounded transition-colors"
          title={`Open call ${n}`}
        >
          {n}
        </Link>
      ))}
    </div>
  );
}
