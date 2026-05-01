import React from 'react';
import Header from '../../components/Header';

export default function TrainerDisabled() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-[700px] mx-auto px-8 py-16 text-center">
        <div className="text-6xl mb-4">🎯</div>
        <h1 className="text-2xl font-bold text-gray-900 heading-font">AI Trainer is not enabled</h1>
        <p className="text-gray-500 mt-3">
          Set <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">TRAINER_ENABLED=true</code> in
          your <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">backend/.env</code> file and restart the backend.
        </p>
      </div>
    </div>
  );
}
