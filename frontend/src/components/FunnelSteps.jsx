import React from 'react';

const STAGES = ['Awareness', 'Consideration', 'Action', 'Already Purchased'];

export default function FunnelSteps({ activeStage }) {
  const activeIndex = STAGES.findIndex(
    s => s.toLowerCase() === (activeStage || '').toLowerCase()
  );

  return (
    <div className="flex items-center overflow-x-auto pb-2">
      {STAGES.map((stage, i) => {
        let pos = 'middle';
        if (i === 0) pos = 'first';
        if (i === STAGES.length - 1) pos = 'last';
        const isActive = i === activeIndex;
        return (
          <div
            key={stage}
            className={`funnel-step ${pos} ${isActive ? 'funnel-active' : 'funnel-inactive'} min-w-[140px]`}
          >
            {stage}
          </div>
        );
      })}
    </div>
  );
}
