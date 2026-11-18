import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FileText } from 'lucide-react';
import { ChassisPreset, DriftTuneParams, TrackDefinition } from '../types/drift';
import {
  buildModZipBlob,
  generateBeamNGModFiles,
  triggerFileDownload,
} from '../utils/jbeamGenerator';
import {
  copyTextToClipboard,
  generateTuningReportMarkdown,
} from '../utils/tuningReport';

interface ModExportViewProps {
  chassis: ChassisPreset;
  tune: DriftTuneParams;
  track?: TrackDefinition;
}

export const ModExportView: React.FC<ModExportViewProps> = ({
  chassis,
  tune,
  track,
}) => {
  const modFiles = useMemo(
    () => generateBeamNGModFiles(chassis, tune),
    [chassis, tune]
  );

  const reportMarkdown = useMemo(
    () => generateTuningReportMarkdown(chassis, tune, track),
    [chassis, tune, track]
  );

  const previewEntries = useMemo(
    () => [
      ...modFiles,
      {
        filename: 'TUNING_REPORT.md',
        relativePath: `TUNING_REPORT_${chassis.beamngInternalId}.md`,
        language: 'markdown' as const,
        summary:
          'Forum-ready Markdown tuning report detailing all 22 chassis, geometry, tire, and drivetrain parameters.',
        content: reportMarkdown,
      },
    ],
    [modFiles, reportMarkdown, chassis.beamngInternalId]
  );

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [copiedFilename, setCopiedFilename] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  const activeFile = previewEntries[selectedIdx] || previewEntries[0];

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(activeFile.content);
    if (ok) {
      setCopiedFilename(activeFile.filename);
      setTimeout(() => setCopiedFilename(null), 1800);
    }
  };

  const handleCopyReport = async () => {
    const ok = await copyTextToClipboard(reportMarkdown);
    if (ok) {
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    }
  };

  const handleDownloadSingle = () => {
    const blob = new Blob([activeFile.content], {
      type: 'text/plain;charset=utf-8',
    });
    triggerFileDownload(blob, activeFile.filename);
  };

  const handleDownloadBundle = () => {
    const zipBlob = buildModZipBlob(modFiles, chassis.name);
    triggerFileDownload(
      zipBlob,
      `driftmod_${chassis.beamngInternalId}_pack.zip`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#232834] pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#F4F6F8]">
            BeamNG.drive JBeam &amp; Lua Mod Export
          </h1>
          <p className="mt-1 text-sm text-[#9AA4B2]">
            Generated live for {chassis.name} ({chassis.beamngInternalId}) ·{' '}
            {tune.steeringLockDeg}° Lock · {tune.turboBoostPsi} PSI ·{' '}
            {tune.finalDriveRatio.toFixed(2)}:1 Final Drive
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleCopyReport}
            className="inline-flex items-center gap-2 rounded-md border border-[#2C3240] bg-[#191D26] px-3.5 py-2 text-xs font-semibold text-[#F4F6F8] transition-colors hover:border-orange-500/60 hover:bg-[#1E232E] whitespace-nowrap shrink-0"
          >
            {copiedReport ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                <span>Report Copied</span>
              </>
            ) : (
              <>
                <FileText className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />
                <span>Copy Tuning Report (.md)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadBundle}
            className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-orange-400 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Download Complete .zip Mod</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left File List */}
        <div className="space-y-2 lg:col-span-4">
          <h2 className="text-xs font-semibold tracking-wide text-[#9AA4B2]">
            Mod Archive &amp; Report Preview
          </h2>
          <div className="space-y-1.5">
            {previewEntries.map((file, idx) => {
              const active = idx === selectedIdx;
              return (
                <button
                  key={file.filename}
                  type="button"
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full rounded-md border px-3.5 py-2.5 text-left transition-colors ${
                    active
                      ? 'border-orange-500 bg-orange-500/10 text-[#F4F6F8]'
                      : 'border-[#232834] bg-[#13161D] text-[#9AA4B2] hover:border-[#343B4C] hover:text-[#F4F6F8]'
                  }`}
                >
                  <div className="font-mono text-xs font-semibold truncate">
                    {file.filename}
                  </div>
                  <div className="mt-1 text-[11px] text-[#7D8796] truncate">
                    {file.relativePath}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-md border border-[#232834] bg-[#13161D] p-4 text-xs text-[#9AA4B2]">
            <div className="font-semibold text-[#F4F6F8]">
              BeamNG.drive Installation &amp; Activation
            </div>
            <p className="mt-1.5 leading-relaxed">
              Drop the downloaded <span className="font-mono text-[#F4F6F8]">.zip</span> directly into your mods folder (remove any older DriftMod zip/folder first):
            </p>
            <code className="mt-2 block rounded bg-[#0B0D11] px-2.5 py-2 font-mono text-[11px] text-orange-300 break-all">
              %localappdata%\BeamNG.drive\0.3x\mods\
            </code>
            <p className="mt-2.5 leading-relaxed text-[#9AA4B2]">
              Spawn your {chassis.name}, open{' '}
              <span className="font-mono text-[#F4F6F8]">Ctrl+W → Parts</span>, and pick{' '}
              <span className="text-orange-300">DriftMod Front Drift Suspension</span> &amp;{' '}
              <span className="text-orange-300">DriftMod Rear Drift Suspension</span>. Adjust{' '}
              <span className="font-mono text-[#F4F6F8]">900° FFB</span> &amp; coilover sliders under{' '}
              <span className="font-mono text-[#F4F6F8]">Tuning</span>.
            </p>
          </div>
        </div>

        {/* Right Code Preview */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-[#232834] bg-[#13161D] lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232834] px-4 py-3">
            <div className="min-w-0">
              <div className="font-mono text-xs font-semibold text-[#F4F6F8] truncate">
                {activeFile.relativePath}
              </div>
              <p className="mt-0.5 text-xs text-[#9AA4B2]">
                {activeFile.summary}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded border border-[#2C3240] bg-[#0B0D11] px-3 py-1.5 text-xs font-medium text-[#D1D5DB] hover:border-[#3E4658] hover:text-white whitespace-nowrap"
              >
                {copiedFilename === activeFile.filename ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadSingle}
                className="inline-flex items-center gap-1.5 rounded border border-[#2C3240] bg-[#0B0D11] px-3 py-1.5 text-xs font-medium text-[#D1D5DB] hover:border-[#3E4658] hover:text-white whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download File</span>
              </button>
            </div>
          </div>

          <pre className="max-h-[540px] overflow-auto bg-[#0B0D11] p-4 font-mono text-xs leading-relaxed text-[#E2E8F0]">
            <code>{activeFile.content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
