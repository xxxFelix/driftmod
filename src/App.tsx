import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHASSIS_PRESETS, TRACK_PRESETS } from './data/presets';
import { FrontGeometryWireframe } from './components/FrontGeometryWireframe';
import { Header } from './components/Header';
import { ModExportView } from './components/ModExportView';
import { SuspensionMeshPreview } from './components/SuspensionMeshPreview';
import { TelemetryCurves } from './components/TelemetryCurves';
import { TrackCanvas } from './components/TrackCanvas';
import { TuneAdvisorToast } from './components/TuneAdvisorToast';
import { TuningPanel } from './components/TuningPanel';
import {
  ChassisId,
  DriftTuneParams,
  TelemetrySample,
  TrackId,
  ViewTab,
} from './types/drift';
import {
  buildModZipBlob,
  generateBeamNGModFiles,
  triggerFileDownload,
} from './utils/jbeamGenerator';
import {
  evaluateSignificantTuneChange,
  TuneAdjustmentTip,
} from './utils/tuneAdvisor';

export function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('sandbox');
  const [chassisId, setChassisId] = useState<ChassisId>('bx_coupe');
  const [trackId, setTrackId] = useState<TrackId>('west_coast_pad');
  const [tune, setTune] = useState<DriftTuneParams>(
    CHASSIS_PRESETS[0].defaultTune
  );
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetrySample[]>(
    []
  );
  const [advisorTip, setAdvisorTip] = useState<TuneAdjustmentTip | null>(null);
  const [isTipHovered, setIsTipHovered] = useState(false);
  const [setupPreviewMode, setSetupPreviewMode] = useState<'mesh3d' | 'wireframe2d'>(
    'mesh3d'
  );

  const baselineRef = useRef<DriftTuneParams>({
    ...CHASSIS_PRESETS[0].defaultTune,
  });
  const activeAdjustKeyRef = useRef<keyof DriftTuneParams | null>(null);

  const chassis = useMemo(
    () => CHASSIS_PRESETS.find((c) => c.id === chassisId) ?? CHASSIS_PRESETS[0],
    [chassisId]
  );

  const track = useMemo(
    () => TRACK_PRESETS.find((t) => t.id === trackId) ?? TRACK_PRESETS[0],
    [trackId]
  );

  useEffect(() => {
    if (!advisorTip || isTipHovered) return;
    const timer = window.setTimeout(() => {
      setAdvisorTip(null);
    }, 7500);
    return () => window.clearTimeout(timer);
  }, [advisorTip, isTipHovered]);

  const handleSelectChassis = (id: ChassisId) => {
    const next = CHASSIS_PRESETS.find((c) => c.id === id);
    if (!next) return;
    setChassisId(id);
    setTune({ ...next.defaultTune });
    baselineRef.current = { ...next.defaultTune };
    activeAdjustKeyRef.current = null;
    setAdvisorTip(null);
  };

  const handleChangeTune = (patch: Partial<DriftTuneParams>) => {
    const entries = Object.entries(patch) as [
      keyof DriftTuneParams,
      number,
    ][];

    for (const [key, newVal] of entries) {
      if (typeof newVal !== 'number') continue;
      if (
        activeAdjustKeyRef.current !== null &&
        activeAdjustKeyRef.current !== key
      ) {
        const prevKey = activeAdjustKeyRef.current;
        baselineRef.current[prevKey] = tune[prevKey];
      }
      activeAdjustKeyRef.current = key;
      const tip = evaluateSignificantTuneChange(
        key,
        baselineRef.current[key],
        newVal
      );
      if (tip) {
        setAdvisorTip(tip);
      }
    }

    setTune((prev) => ({ ...prev, ...patch }));
  };

  const handleResetChassisDefault = () => {
    const next = { ...chassis.defaultTune };
    setTune(next);
    baselineRef.current = { ...next };
    activeAdjustKeyRef.current = null;
    setAdvisorTip(null);
  };

  const handleApplyProPreset = () => {
    const proPatch: DriftTuneParams = {
      ...tune,
      steeringLockDeg: 68,
      ackermannPct: -5,
      kpiDeg: 5.5,
      steeringSpeed: 1.42,
      steeringWheelDeg: 900,
      ffbStrengthPct: 125,
      ffbDampingPct: 14,
      frontCasterDeg: 8.8,
      frontCamberDeg: -5.8,
      rearCamberDeg: -0.2,
      frontToeDeg: -0.25,
      rearToeDeg: 0.42,
      frontSpringKn: 94,
      rearSpringKn: 56,
      rearArbBiasPct: 30,
      antiSquatPct: 62,
      frontWeightPct: 49.5,
      chassisRigidity: 1.45,
      rearTireWidthMm: 305,
      rearTirePsi: 18,
      brakeBiasPct: 67,
      lsdLockPct: 100,
      finalDriveRatio: 4.11,
      turboBoostPsi: 25,
      rearTireGrip: 1.04,
    };
    setTune(proPatch);
    baselineRef.current = { ...proPatch };
    activeAdjustKeyRef.current = null;
    setAdvisorTip(null);
  };

  const handleTelemetrySample = useCallback((sample: TelemetrySample) => {
    setTelemetryHistory((prev) => {
      const next = [...prev, sample];
      return next.length > 90 ? next.slice(next.length - 90) : next;
    });
  }, []);

  const handleDownloadPack = () => {
    const files = generateBeamNGModFiles(chassis, tune);
    const zipBlob = buildModZipBlob(files, chassis.name);
    triggerFileDownload(
      zipBlob,
      `driftmod_${chassis.beamngInternalId}_pack.zip`
    );
  };

  return (
    <div className="min-h-screen bg-[#0B0D11] text-[#F4F6F8]">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onDownloadPack={handleDownloadPack}
      />

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {activeTab === 'sandbox' && (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <TrackCanvas
                chassis={chassis}
                tune={tune}
                track={track}
                onSelectTrack={setTrackId}
                onTelemetrySample={handleTelemetrySample}
              />
            </div>
            <div className="xl:col-span-4">
              <TuningPanel
                chassis={chassis}
                tune={tune}
                track={track}
                onSelectChassis={handleSelectChassis}
                onChangeTune={handleChangeTune}
                onResetChassisDefault={handleResetChassisDefault}
                onApplyProPreset={handleApplyProPreset}
                compact
              />
            </div>
          </div>
        )}

        {activeTab === 'setup' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <TuningPanel
                chassis={chassis}
                tune={tune}
                track={track}
                onSelectChassis={handleSelectChassis}
                onChangeTune={handleChangeTune}
                onResetChassisDefault={handleResetChassisDefault}
                onApplyProPreset={handleApplyProPreset}
              />
            </div>
            <div className="space-y-6 lg:col-span-5 lg:sticky lg:top-20 lg:self-start">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSetupPreviewMode('mesh3d')}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    setupPreviewMode === 'mesh3d'
                      ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                      : 'border-[#232834] bg-[#13161D] text-[#9AA4B2] hover:text-[#F4F6F8]'
                  }`}
                >
                  3D Suspension Meshes (.dae)
                </button>
                <button
                  type="button"
                  onClick={() => setSetupPreviewMode('wireframe2d')}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    setupPreviewMode === 'wireframe2d'
                      ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                      : 'border-[#232834] bg-[#13161D] text-[#9AA4B2] hover:text-[#F4F6F8]'
                  }`}
                >
                  2D CAD Kinematics
                </button>
              </div>

              {setupPreviewMode === 'mesh3d' ? (
                <SuspensionMeshPreview chassis={chassis} tune={tune} />
              ) : (
                <FrontGeometryWireframe chassis={chassis} tune={tune} />
              )}

              <div className="space-y-4 rounded-lg border border-[#232834] bg-[#13161D] p-5">
                <h2 className="font-display text-xl font-bold tracking-tight text-[#F4F6F8]">
                  {chassis.name} Handling Brief
                </h2>
                <p className="text-sm leading-relaxed text-[#9AA4B2]">
                  {chassis.summary}
                </p>

                <div className="grid grid-cols-2 gap-3 border-t border-[#232834] pt-4 font-mono text-xs tabular-nums">
                  <div>
                    <div className="text-[#7D8796]">BeamNG Vehicle ID</div>
                    <div className="mt-0.5 font-semibold text-[#F4F6F8]">
                      {chassis.beamngInternalId}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#7D8796]">Curb Weight</div>
                    <div className="mt-0.5 font-semibold text-[#F4F6F8]">
                      {chassis.massKg} kg
                    </div>
                  </div>
                  <div>
                    <div className="text-[#7D8796]">Base Output</div>
                    <div className="mt-0.5 font-semibold text-[#F4F6F8]">
                      {chassis.basePowerHp} HP
                    </div>
                  </div>
                  <div>
                    <div className="text-[#7D8796]">Engine Redline</div>
                    <div className="mt-0.5 font-semibold text-[#F4F6F8]">
                      {chassis.redlineRpm.toLocaleString()} RPM
                    </div>
                  </div>
                </div>

                <div className="border-t border-[#232834] pt-4">
                  <h3 className="text-xs font-semibold text-[#F4F6F8]">
                    Setup Trade-Off Notes
                  </h3>
                  <ul className="mt-2 space-y-2 text-xs leading-relaxed text-[#9AA4B2]">
                    <li>
                      <strong className="text-[#F4F6F8]">Drop Knuckles, Low KPI &amp; Anti-Ackermann:</strong>{' '}
                      66–70° lock with 0% to -5% anti-Ackermann, low 5.5° KPI, +8.8° caster, -5.8° front camber, and -0.25° front toe-out eliminate high-angle wheel jacking and front scrub.
                    </li>
                    <li>
                      <strong className="text-[#F4F6F8]">Anti-Squat, Soft Rear ARB &amp; Rear Alignment:</strong>{' '}
                      55–65% anti-squat pickups, near-zero -0.2° rear camber, +0.42° rear toe-in, and a soft/disconnected rear ARB (28–35% bias) plant the rear tires for rapid chase drive.
                    </li>
                    <li>
                      <strong className="text-[#F4F6F8]">Chromoly Cage, Weight Bias &amp; Staggered Tires:</strong>{' '}
                      1.45x roll-cage rigidity, 49.5% rear-shifted weight, 305mm 200TW tires aired down to 18 PSI, and 67% front brake bias enable clean left-foot braking without locking the rear axle.
                    </li>
                    <li>
                      <strong className="text-[#F4F6F8]">900° Direct Drive &amp; Belt FFB Calibration:</strong>{' '}
                      1:1 900° wheel lock, fast hydro rack rates (≥ 3.6), +8.5° caster trail, and 120–125% SAT gain deliver crisp self-steer without lock-end inversion or DD straight-line chatter.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'telemetry' && (
          <TelemetryCurves
            chassis={chassis}
            tune={tune}
            track={track}
            history={telemetryHistory}
          />
        )}

        {activeTab === 'export' && (
          <ModExportView chassis={chassis} tune={tune} track={track} />
        )}
      </main>

      <TuneAdvisorToast
        tip={advisorTip}
        onDismiss={() => {
          if (advisorTip) {
            baselineRef.current[advisorTip.key] = tune[advisorTip.key];
          }
          setAdvisorTip(null);
        }}
        onMouseEnter={() => setIsTipHovered(true)}
        onMouseLeave={() => setIsTipHovered(false)}
      />
    </div>
  );
}

export default App;
