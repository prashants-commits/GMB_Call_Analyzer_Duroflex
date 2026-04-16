import React from 'react';
import { yesNoLabel, scoreClass } from '../utils/api';

export default function YesNoBadge({ value }) {
  const label = yesNoLabel(value);
  const cls = label === 'YES' ? 'score-high' : label === 'NO' ? 'score-low' : 'score-neutral';
  return (
    <span className={`inline-flex items-center px-3 py-1.5 rounded-full border text-sm font-bold ${cls}`}>
      {label}
    </span>
  );
}
