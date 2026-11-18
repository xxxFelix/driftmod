import React from 'react';
import { ArrowDownRight, ArrowUpRight, SlidersHorizontal, X } from 'lucide-react';
import { TuneAdjustmentTip } from '../utils/tuneAdvisor';

interface TuneAdvisorToastProps {
  tip: TuneAdjustmentTip | null;
  onDismiss: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export const TuneAdvisorToast: React.FC<TuneAdvisorToastProps> = ({
  tip,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}) => {
  if (!tip) return null;

  const isUp = tip.direction === 'up';

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed bottom-5 left-1/2 z-40 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-[#2C3240] bg-[#13161D]/95 p-4 shadow-2xl backdrop-blur-md xl:left-6 xl:translate-x-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[#9AA4B2]">
          <SlidersHorizontal className="h-3.5 w-3.5 text-orange-400 shrink-0" aria-hidden="true" />
          <span className="font-medium text-[#F4F6F8]">{tip.label}</span>
          <span aria-hidden="true">·</span>
          <span>{tip.category}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums">
            <span className="text-[#7D8796]">{tip.fromFormatted}</span>
            <span className="text-[#7D8796]">→</span>
            <span className={isUp ? 'text-orange-400' : 'text-sky-400'}>
              {tip.toFormatted}
            </span>
            {isUp ? (
              <ArrowUpRight className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            )}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss tuning suggestion"
            className="rounded p-1 text-[#7D8796] transition-colors hover:bg-[#1E2430] hover:text-[#F4F6F8]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs font-semibold text-[#F4F6F8]">
        {tip.headline}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[#9AA4B2]">
        {tip.detail}
      </p>
    </div>
  );
};
