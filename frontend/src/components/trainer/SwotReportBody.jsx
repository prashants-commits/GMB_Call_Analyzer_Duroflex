// Shared SWOT report body — Quick Stats strip + 4 SWOT quadrants +
// Function Improvement Areas. Used by:
//   1. AI-Trainer side: pages/trainer/StoreSwotPage.jsx (per-store)
//   2. Insights side: pages/SwotReportsPage.jsx (city + store)
//
// Both consumers pass the same SWOTReport shape (from
// backend/trainer/swot/schema.py: SWOTReport.model_dump()) so the layout +
// citations + quick-stats are visually identical across apps.

import React from 'react';
import { AlertCircle, AlertTriangle, Activity, TrendingUp, Briefcase, Megaphone, Truck, Package, Globe } from 'lucide-react';
import SwotQuadrant, { CleanNumberCitations } from './SwotQuadrant';

const FUNCTION_META = {
  sales_team:                { label: 'Sales Team',              Icon: Briefcase, accent: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  marketing:                 { label: 'Marketing',               Icon: Megaphone, accent: 'text-pink-700 bg-pink-50 border-pink-200' },
  supply_chain_and_delivery: { label: 'Supply Chain & Delivery', Icon: Truck,     accent: 'text-amber-700 bg-amber-50 border-amber-200' },
  product_team:              { label: 'Product Team',            Icon: Package,   accent: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  omnichannel_team:          { label: 'Omnichannel Team',        Icon: Globe,     accent: 'text-sky-700 bg-sky-50 border-sky-200' },
};
const FUNCTION_ORDER = ['sales_team', 'marketing', 'supply_chain_and_delivery', 'product_team', 'omnichannel_team'];

const SEVERITY_STYLES = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
};

export default function SwotReportBody({ report }) {
  if (!report) return null;
  return (
    <>
      {report.quick_stats && <QuickStatsStrip stats={report.quick_stats} />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SwotQuadrant kind="strengths"     title="Strengths"     items={report.strengths} />
        <SwotQuadrant kind="weaknesses"    title="Weaknesses"    items={report.weaknesses} />
        <SwotQuadrant kind="opportunities" title="Opportunities" items={report.opportunities} />
        <SwotQuadrant kind="threats"       title="Threats"       items={report.threats} />
      </div>
      {report.function_improvements && report.function_improvements.length > 0 && (
        <FunctionImprovementsSection blocks={report.function_improvements} />
      )}
    </>
  );
}

export function QuickStatsStrip({ stats }) {
  const cells = [
    {
      label: 'Calls analysed',
      value: stats.calls_analyzed ?? 0,
      subtitle: 'this period',
      Icon: Activity,
      accent: 'text-slate-700',
    },
    {
      label: 'Top blocker',
      value: stats.top_blocker_calls ?? 0,
      subtitle: stats.top_blocker_theme || '—',
      Icon: AlertTriangle,
      accent: 'text-rose-700',
    },
    {
      label: 'Biggest strength',
      value: '★',
      subtitle: stats.biggest_strength_theme || '—',
      Icon: TrendingUp,
      accent: 'text-emerald-700',
      valueIsLabel: true,
    },
    {
      label: 'High-severity items',
      value: stats.high_severity_count ?? 0,
      subtitle: 'across SWOT + functions',
      Icon: AlertCircle,
      accent: 'text-amber-700',
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      {cells.map((c, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
          <c.Icon className={`w-5 h-5 ${c.accent} shrink-0 mt-0.5`} />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{c.label}</div>
            <div className={`font-black ${c.accent} ${c.valueIsLabel ? 'text-2xl' : 'text-2xl tabular-nums'}`}>
              {c.value}
            </div>
            <div className="text-xs text-slate-500 truncate" title={c.subtitle}>{c.subtitle}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FunctionImprovementsSection({ blocks }) {
  const byKey = {};
  for (const b of blocks || []) {
    if (b && b.function) byKey[b.function] = b;
  }
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">For CSO / Head of Sales / CGO</p>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight" style={{ fontFamily: "'Fraunces', serif" }}>
            Key Improvement Areas by Function
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Themes scoped to the team that owns the fix, with concrete next actions and call citations.
          </p>
        </div>
      </div>
      <div className="space-y-4">
        {FUNCTION_ORDER.map((key) => {
          const block = byKey[key] || { function: key, items: [] };
          return <FunctionBlockCard key={key} block={block} />;
        })}
      </div>
    </section>
  );
}

function FunctionBlockCard({ block }) {
  const meta = FUNCTION_META[block.function] || { label: block.function, Icon: Activity, accent: 'text-slate-700 bg-slate-50 border-slate-200' };
  const items = block.items || [];
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${meta.accent}`}>
          <meta.Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-900">{meta.label}</h3>
          <p className="text-xs text-slate-500">
            {items.length === 0 ? 'No issues identified for this period' : `${items.length} improvement ${items.length === 1 ? 'theme' : 'themes'}`}
          </p>
        </div>
      </div>
      {items.length > 0 && (
        <ol className="space-y-3">
          {items.map((it, i) => <FunctionImprovementItem key={i} item={it} />)}
        </ol>
      )}
    </div>
  );
}

function FunctionImprovementItem({ item }) {
  const sev = SEVERITY_STYLES[item.severity] || SEVERITY_STYLES.medium;
  return (
    <li className="border border-slate-100 bg-slate-50/60 rounded-xl p-3">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h4 className="text-sm font-bold text-slate-900">{item.theme}</h4>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${sev}`}>
          {item.severity}
        </span>
        {item.evidence_count > 0 && (
          <span className="text-[10px] text-slate-400">{item.evidence_count} {item.evidence_count === 1 ? 'call' : 'calls'}</span>
        )}
      </div>
      <p className="text-sm text-slate-600 leading-snug mb-1.5">{item.detail}</p>
      {item.recommended_action && (
        <div className="bg-white border-l-2 border-indigo-300 px-3 py-1.5 rounded-r-md text-xs text-slate-700">
          <span className="font-bold uppercase tracking-wider text-[9px] text-indigo-600 mr-2">Action</span>
          {item.recommended_action}
        </div>
      )}
      {(item.example_clean_numbers || []).length > 0 && (
        <CleanNumberCitations numbers={item.example_clean_numbers} totalCount={item.evidence_count} />
      )}
    </li>
  );
}
