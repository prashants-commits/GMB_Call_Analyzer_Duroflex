import React from 'react';
import { scoreClass } from '../utils/api';

export default function ScoreBadge({ label, className = '' }) {
  if (!label || label === 'N/A') return <span className="text-gray-400 text-sm">N/A</span>;
  return (
    <span className={`inline-flex items-center px-3 py-1.5 rounded-full border text-sm font-bold ${scoreClass(label)} ${className}`}>
      {label}
    </span>
  );
}
