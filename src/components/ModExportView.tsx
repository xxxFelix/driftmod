import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCode2,
  FileText,
  FolderSync,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { ChassisPreset, DriftTuneParams, ModFileSpec, TrackDefinition } from '../types/drift';
import {
  analyzeReferenceJbeam,
  ReferenceJbeamSummary,
  validateModPhysics,
} from '../utils/beamngPhysicsValidator';
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

interface WritableDirectoryPickerWindow {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

async function writeModFilesToDirectory(
  rootHandle: FileSystemDirectoryHandle,
  files: ModFileSpec[]
): Promise<number> {
  let count = 0;
  for (const file of files) {
    const segments = file.relativePath.split('/').filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) continue;

    let currentDir = rootHandle;
    for (const dirName of segments) {
      currentDir = await currentDir.getDirectoryHandle(dirName, { create: true });
    }
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file.content);
    await writable.close();
    count += 1;
  }
  return count;
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

  const preFlight = useMemo(
    () => validateModPhysics(modFiles, chassis, tune),
    [modFiles, chassis, tune]
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

  // Unpacked directory sync state (Chrome/Edge File System Access API)
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{
    tone: 'ok' | 'warn';
    text: string;
  } | null>(null);

  // Reference JBeam Calibrator state
  const [calibratorOpen, setCalibratorOpen] = useState(false);
  const [refInputText, setRefInputText] = useState('');
  const [refSummary, setRefSummary] = useState<ReferenceJbeamSummary | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleSyncUnpacked = async (forcePick = false) => {
    const picker = (window as unknown as WritableDirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setSyncNotice({
        tone: 'warn',
        text: 'Direct folder sync requires Chromium desktop outside a blocked frame. Use Download Complete .zip Mod or extract once into mods/unpacked/.',
      });
      return;
    }

    setSyncing(true);
    setSyncNotice(null);
    try {
      const targetHandle = !forcePick && dirHandle
        ? dirHandle
        : await picker({ mode: 'readwrite' });
      setDirHandle(targetHandle);
      const written = await writeModFilesToDirectory(targetHandle, modFiles);
      setSyncNotice({
        tone: 'ok',
        text: `Synced ${written} files to "${targetHandle.name}/" — press Ctrl+R in BeamNG.drive to reload live.`,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setSyncNotice(null);
      } else {
        setSyncNotice({
          tone: 'warn',
          text:
            err instanceof Error
              ? `Folder sync unavailable here (${err.message}). Use .zip download below.`
              : 'Folder sync blocked by browser frame security; use .zip download below.',
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  const runReferenceAnalysis = (raw: string) => {
    setRefInputText(raw);
    if (!raw.trim()) {
      setRefSummary(null);
      setRefError(null);
      return;
    }
    try {
      const summary = analyzeReferenceJbeam(raw, modFiles);
      setRefSummary(summary);
      setRefError(null);
    } catch (err) {
      setRefSummary(null);
      setRefError(
        err instanceof Error
          ? `Could not parse .jbeam: ${err.message}`
          : 'Invalid JBeam syntax'
      );
    }
  };

  const handleUploadRefFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    runReferenceAnalysis(text);
    e.target.value = '';
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
            onClick={() => handleSyncUnpacked(false)}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <FolderSync className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {syncing
                ? 'Syncing...'
                : dirHandle
                  ? `Re-Sync "${dirHandle.name}" (Ctrl+R)`
                  : 'Sync Unpacked Folder (Ctrl+R)'}
            </span>
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

      {syncNotice && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2.5 text-xs ${
            syncNotice.tone === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <span>{syncNotice.text}</span>
          {dirHandle && (
            <button
              type="button"
              onClick={() => handleSyncUnpacked(true)}
              className="font-semibold underline hover:text-white"
            >
              Choose Different Folder
            </button>
          )}
        </div>
      )}

      {/* BeamNG 2000 Hz Physics Pre-Flight Verifier */}
      <div className="rounded-lg border border-[#232834] bg-[#13161D] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E232E] pb-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck
              className={`h-4 w-4 ${
                preFlight.overallStatus === 'pass'
                  ? 'text-emerald-400'
                  : preFlight.overallStatus === 'warn'
                    ? 'text-amber-400'
                    : 'text-rose-400'
              }`}
              aria-hidden="true"
            />
            <h2 className="text-xs font-semibold tracking-wide text-[#F4F6F8]">
              BeamNG 2000 Hz Physics Pre-Flight Verifier
            </h2>
            <span
              className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                preFlight.overallStatus === 'pass'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : preFlight.overallStatus === 'warn'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              {preFlight.overallStatus === 'pass'
                ? 'SOLVER SAFE'
                : preFlight.overallStatus === 'warn'
                  ? 'HIGH STIFFNESS WARN'
                  : 'INSTABILITY RISK'}
            </span>
          </div>
          <div className="font-mono text-[11px] text-[#9AA4B2]">
            Peak Σk/m: <span className="text-[#F4F6F8]">{(preFlight.maxStiffnessRatio / 1e6).toFixed(2)}</span> MN/(m·kg) · Peak Σc/m: <span className="text-[#F4F6F8]">{Math.round(preFlight.maxDampingRatio)}</span> s⁻¹
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-5">
          {preFlight.checks.map((chk) => (
            <div
              key={chk.id}
              className="rounded border border-[#232834] bg-[#0B0D11] px-3 py-2.5"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#F4F6F8]">
                {chk.status === 'pass' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                ) : chk.status === 'warn' ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
                )}
                <span className="truncate">{chk.label}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-[#8D97A5]">
                {chk.detail}
              </p>
            </div>
          ))}
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
              Fast Unpacked Workflow (No Re-Zip / Cache Clear)
            </div>
            <p className="mt-1.5 leading-relaxed">
              Remove older <span className="font-mono text-[#F4F6F8]">driftmod_*.zip</span> files, create this folder once, and click <span className="text-emerald-300 font-semibold">Sync Unpacked Folder</span>:
            </p>
            <code className="mt-2 block rounded bg-[#0B0D11] px-2.5 py-2 font-mono text-[11px] text-orange-300 break-all">
              %localappdata%\BeamNG.drive\0.4x\mods\unpacked\driftmod_{chassis.beamngInternalId}_pack\
            </code>
            <p className="mt-2.5 leading-relaxed text-[#9AA4B2]">
              Test first on clean <span className="text-[#F4F6F8]">Gridmap V2</span> (without conflicting third-party BX packs or heavy map mods that overflow <span className="font-mono">beamng.log</span> past 15,000 lines). Spawn your {chassis.name}, press{' '}
              <span className="font-mono text-[#F4F6F8]">Ctrl+R</span> after any sync, then pick{' '}
              <span className="text-orange-300">DriftMod Double Wishbone Front Suspension</span>{' '}
              &amp; <span className="text-orange-300">DriftMod Anti-Squat Rear Suspension</span> under <span className="font-mono text-[#F4F6F8]">Ctrl+W → Parts</span>.
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

      {/* Stock BX / Reference Mod JBeam Calibrator */}
      <div className="rounded-lg border border-[#232834] bg-[#13161D]">
        <button
          type="button"
          onClick={() => setCalibratorOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#171B24]"
        >
          <div className="flex items-center gap-2.5">
            <FileCode2 className="h-4 w-4 text-orange-400" aria-hidden="true" />
            <div>
              <div className="text-xs font-semibold text-[#F4F6F8]">
                Stock BX / Reference Mod JBeam Calibrator
              </div>
              <div className="text-[11px] text-[#9AA4B2]">
                Upload or paste stock <span className="font-mono">bx_body.jbeam</span>, <span className="font-mono">bx_suspension_F.jbeam</span>, or a working drift mod file to diff node coordinates &amp; tie-in contracts.
              </div>
            </div>
          </div>
          {calibratorOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-[#9AA4B2]" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-[#9AA4B2]" aria-hidden="true" />
          )}
        </button>

        {calibratorOpen && (
          <div className="border-t border-[#232834] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jbeam,.json,.txt"
                  onChange={handleUploadRefFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded border border-[#2C3240] bg-[#0B0D11] px-3 py-1.5 text-xs font-semibold text-[#F4F6F8] hover:border-orange-500/60"
                >
                  <Upload className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />
                  <span>Upload .jbeam File</span>
                </button>
                {refInputText && (
                  <button
                    type="button"
                    onClick={() => runReferenceAnalysis('')}
                    className="rounded border border-[#2C3240] px-2.5 py-1.5 text-xs text-[#9AA4B2] hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
              <span className="text-[11px] text-[#7D8796]">
                Supports standard BeamNG JBeam comments (<span className="font-mono">//</span>, <span className="font-mono">/* */</span>) and trailing commas.
              </span>
            </div>

            <textarea
              value={refInputText}
              onChange={(e) => runReferenceAnalysis(e.target.value)}
              placeholder='Paste stock bx_body.jbeam or bx_suspension_F.jbeam contents here...'
              rows={5}
              className="w-full rounded border border-[#232834] bg-[#0B0D11] p-3 font-mono text-xs text-[#E2E8F0] placeholder-[#586273] focus:border-orange-500 focus:outline-none"
            />

            {refError && (
              <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {refError}
              </div>
            )}

            {refSummary && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                <div className="rounded border border-[#232834] bg-[#0B0D11] p-3 space-y-1.5">
                  <div className="font-semibold text-[#F4F6F8]">Parts &amp; Nodes</div>
                  <div className="text-[#9AA4B2]">
                    Parts: <span className="font-mono text-[#F4F6F8]">{refSummary.partNames.join(', ') || 'none'}</span>
                  </div>
                  <div className="text-[#9AA4B2]">
                    Slot Types: <span className="font-mono text-[#F4F6F8]">{refSummary.slotTypes.join(', ') || 'none'}</span>
                  </div>
                  <div className="text-[#9AA4B2]">
                    Parsed Nodes: <span className="font-mono text-[#F4F6F8]">{refSummary.nodeCount}</span>
                  </div>
                </div>

                <div className="rounded border border-[#232834] bg-[#0B0D11] p-3 space-y-1.5">
                  <div className="font-semibold text-[#F4F6F8]">Axle &amp; Solver Ranges</div>
                  <div className="text-[#9AA4B2]">
                    Front / Rear Y Avg:{' '}
                    <span className="font-mono text-[#F4F6F8]">
                      {refSummary.frontAxleYAvg !== null ? `${refSummary.frontAxleYAvg.toFixed(3)}m` : 'n/a'} /{' '}
                      {refSummary.rearAxleYAvg !== null ? `${refSummary.rearAxleYAvg.toFixed(3)}m` : 'n/a'}
                    </span>
                  </div>
                  <div className="text-[#9AA4B2]">
                    nodeWeight:{' '}
                    <span className="font-mono text-[#F4F6F8]">
                      {refSummary.nodeWeightRange ? `${refSummary.nodeWeightRange[0]}..${refSummary.nodeWeightRange[1]} kg` : 'n/a'}
                    </span>
                  </div>
                  <div className="text-[#9AA4B2]">
                    beamSpring:{' '}
                    <span className="font-mono text-[#F4F6F8]">
                      {refSummary.beamSpringRange ? `${(refSummary.beamSpringRange[0] / 1e6).toFixed(2)}..${(refSummary.beamSpringRange[1] / 1e6).toFixed(2)} MN/m` : 'n/a'}
                    </span>
                  </div>
                </div>

                <div className="rounded border border-[#232834] bg-[#0B0D11] p-3 space-y-1.5">
                  <div className="font-semibold text-[#F4F6F8]">Unibody Tie-In Match</div>
                  <div className="text-[#9AA4B2]">
                    Matched Tie-In Nodes:{' '}
                    <span className="font-mono text-emerald-300">{refSummary.matchedTieInNodes.length}</span>
                    {' · '}Missing:{' '}
                    <span className="font-mono text-amber-300">{refSummary.missingUnibodyTieIns.length}</span>
                  </div>
                  {refSummary.matchedTieInNodes.length > 0 && (
                    <div className="max-h-24 overflow-auto font-mono text-[10px] text-[#9AA4B2]">
                      {refSummary.matchedTieInNodes.slice(0, 6).map((m) => (
                        <div key={m.nodeId}>
                          {m.nodeId} ↔ {m.nearestDriftModNode} ({(m.distanceM * 1000).toFixed(0)}mm)
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
