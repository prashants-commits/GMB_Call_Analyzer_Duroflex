import React from 'react';

const DIFF_BADGE = {
  easy:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  hard:   'bg-rose-50 text-rose-700 border-rose-200',
};

const LANG_LABEL = {
  english_only:               'English only',
  english_dominant_hindi:     'English-Hindi',
  hinglish:                   'Hinglish',
  hindi_dominant_english:     'Hindi-English',
  regional_dominant:          'Regional',
};

export default function PersonaCard({ persona, onClick }) {
  const diffClass = DIFF_BADGE[persona.difficulty_band] || DIFF_BADGE.medium;
  return (
    <button
      onClick={onClick}
      className="text-left bg-white border border-slate-200 rounded-2xl p-5 hover:border-slate-400 hover:shadow-md transition w-full"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-base font-bold text-slate-900 leading-snug">{persona.name}</h3>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${diffClass} shrink-0`}>
          {persona.difficulty_band}
        </span>
      </div>

      <p className="text-sm text-slate-600 leading-snug mb-3 line-clamp-3">{persona.summary}</p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <Pill>{LANG_LABEL[persona.language_mix] || persona.language_mix}</Pill>
        <Pill>{persona.age_band.replace('_', '-')}</Pill>
        <Pill>{persona.decision_role}</Pill>
        <Pill>{persona.income_band}</Pill>
      </div>

      <div className="text-[11px] text-slate-500 leading-snug">
        <strong className="text-slate-600">Skills:</strong>{' '}
        {persona.target_skill_focus.map((s) => s.replace(/_/g, ' ')).join(' · ')}
      </div>

      <div className="text-[11px] text-slate-400 mt-2 italic line-clamp-2">
        "{persona.opening_line_hint}"
      </div>
    </button>
  );
}

function Pill({ children }) {
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
      {children}
    </span>
  );
}
