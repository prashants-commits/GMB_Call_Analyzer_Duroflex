import React from 'react';

export default function TranscriptChat({ messages }) {
  if (!messages || messages.length === 0) {
    return <p className="text-gray-400 text-center py-8">No transcript available.</p>;
  }

  return (
    <div className="max-h-[700px] overflow-y-auto p-8 bg-gray-50 space-y-4">
      {messages.map((msg, i) => {
        const isAgent = msg.speaker === 'Agent';
        return (
          <div key={i} className={`flex ${isAgent ? 'justify-start' : 'justify-end'} mb-3 px-2`}>
            <div className={`max-w-[78%] ${isAgent ? 'bg-white border-gray-200' : 'bg-green-100 border-green-200'} border rounded-2xl px-4 py-3 shadow-sm`}>
              <p className={`text-xs font-semibold mb-1.5 ${isAgent ? 'text-gray-600' : 'text-green-800'}`}>
                {msg.speaker}
              </p>
              <p className={`text-base leading-relaxed ${isAgent ? 'text-gray-800' : 'text-gray-900'}`}>
                {msg.text}
              </p>
              <p className={`text-xs mt-1.5 ${isAgent ? 'text-gray-500' : 'text-green-700'}`}>
                {msg.timestamp}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
