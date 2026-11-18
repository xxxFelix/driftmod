import React from 'react';
import { Download } from 'lucide-react';
import { ViewTab } from '../types/drift';

interface HeaderProps {
  activeTab: ViewTab;
  onSelectTab: (tab: ViewTab) => void;
  onDownloadPack: () => void;
}

const NAV_ITEMS: { id: ViewTab; label: string }[] = [
  { id: 'sandbox', label: 'Track Sandbox' },
  { id: 'setup', label: 'JBeam Setup' },
  { id: 'telemetry', label: 'Telemetry Curves' },
  { id: 'export', label: 'Mod Export' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onDownloadPack,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-[#232834] bg-[#0B0D11]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3 sm:px-6">
        {/* Zone 1: Single-line Brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('sandbox')}
          className="font-display text-2xl font-bold tracking-tight text-[#F4F6F8] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-500"
        >
          DriftMod
        </button>

        {/* Zone 2: 4 concise single-line nav links */}
        <nav
          aria-label="Primary"
          className="flex items-center gap-5 overflow-x-auto sm:gap-7"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-500 ${
                  active
                    ? 'text-[#F4F6F8]'
                    : 'text-[#9AA4B2] hover:text-[#F4F6F8]'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[13px] h-[2px] bg-orange-500"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary CTA action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onDownloadPack}
            className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-orange-400 active:bg-orange-600 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Download Mod Pack</span>
          </button>
        </div>
      </div>
    </header>
  );
};
