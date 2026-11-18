import React, { useState } from 'react';
import { Check, FileText, RotateCcw } from 'lucide-react';
import { CHASSIS_PRESETS } from '../data/presets';
import {
  ChassisId,
  ChassisPreset,
  DriftTuneParams,
  TrackDefinition,
} from '../types/drift';
import {
  copyTextToClipboard,
  generateTuningReportMarkdown,
} from '../utils/tuningReport';

interface TuningPanelProps {
  chassis: ChassisPreset;
  tune: DriftTuneParams;
  track?: TrackDefinition;
  onSelectChassis: (id: ChassisId) => void;
  onChangeTune: (patch: Partial<DriftTuneParams>) => void;
  onResetChassisDefault: () => void;
  onApplyProPreset: () => void;
  compact?: boolean;
}

type TuneSectionId =
  | 'geometry'
  | 'ffb'
  | 'coilovers'
  | 'chassis_tires'
  | 'drivetrain';

interface SliderSpec {
  key: keyof DriftTuneParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  format?: (val: number) => string;
  hint: string;
}

const GEOMETRY_SLIDERS: SliderSpec[] = [
  {
    key: 'steeringLockDeg',
    label: 'Max Steering Lock',
    min: 40,
    max: 72,
    step: 1,
    unit: '°',
    hint: 'FD Wisefab angle kit limit (64–70° prevents spinouts at big angle)',
  },
  {
    key: 'ackermannPct',
    label: 'Ackermann Geometry',
    min: -15,
    max: 100,
    step: 1,
    unit: '%',
    hint: '0% parallel to -5% anti-Ackermann keeps leading wheel scrub-free',
  },
  {
    key: 'kpiDeg',
    label: 'Kingpin Inclination (KPI)',
    min: 4.0,
    max: 14.0,
    step: 0.1,
    unit: '°',
    format: (v) => v.toFixed(1),
    hint: 'Drop knuckles lower KPI (5–6°) to eliminate steering jacking & bind',
  },
  {
    key: 'frontCasterDeg',
    label: 'Front Caster Angle',
    min: 3.0,
    max: 10.5,
    step: 0.1,
    unit: '°',
    format: (v) => v.toFixed(1),
    hint: '+8.0–9.5° drives rapid self-aligning countersteer on transitions',
  },
  {
    key: 'frontCamberDeg',
    label: 'Front Camber Angle',
    min: -7.0,
    max: 0.0,
    step: 0.1,
    unit: '°',
    format: (v) => v.toFixed(1),
    hint: '-5.0° to -6.0° keeps leading tire contact patch flat at 65°+ lock',
  },
  {
    key: 'rearCamberDeg',
    label: 'Rear Camber Angle',
    min: -6.0,
    max: 0.5,
    step: 0.1,
    unit: '°',
    format: (v) => v.toFixed(1),
    hint: '-0.2° to -0.5° static lands near 0° under squat for max rear bite',
  },
  {
    key: 'frontToeDeg',
    label: 'Front Static Toe',
    min: -0.6,
    max: 0.3,
    step: 0.05,
    unit: '°',
    format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
    hint: 'Slight toe-out (-0.20° to -0.30°) sharpens initiation & front feel',
  },
  {
    key: 'rearToeDeg',
    label: 'Rear Static Toe',
    min: -0.2,
    max: 0.8,
    step: 0.02,
    unit: '°',
    format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
    hint: 'Positive rear toe-in (+0.25° to +0.50°) boosts forward drive & stability',
  },
  {
    key: 'steeringSpeed',
    label: 'Rack Speed Multiplier',
    min: 0.6,
    max: 1.8,
    step: 0.05,
    unit: 'x',
    format: (v) => v.toFixed(2),
    hint: 'Quick-ratio steering rack catch speed in BeamNG hydros',
  },
];

const COILOVER_SLIDERS: SliderSpec[] = [
  {
    key: 'frontSpringKn',
    label: 'Front Coilover Spring',
    min: 35,
    max: 110,
    step: 1,
    unit: ' kN/m',
    hint: 'Stiff 85–98 kN/m front springs prevent nose dive & sharpen turn-in',
  },
  {
    key: 'rearSpringKn',
    label: 'Rear Coilover Spring',
    min: 25,
    max: 90,
    step: 1,
    unit: ' kN/m',
    hint: 'Softer 48–58 kN/m rear springs transfer weight smoothly for chase speed',
  },
  {
    key: 'rearArbBiasPct',
    label: 'Rear ARB Stiffness Bias',
    min: 20,
    max: 80,
    step: 1,
    unit: '%',
    hint: 'FD teams run stiff front ARB & soft/disconnected rear ARB (25–35%)',
  },
  {
    key: 'antiSquatPct',
    label: 'Rear Anti-Squat Geometry',
    min: 20,
    max: 90,
    step: 1,
    unit: '%',
    hint: 'Subframe pickup brackets (55–68%) plant rear tires without bottoming out',
  },
];

const CHASSIS_TIRE_SLIDERS: SliderSpec[] = [
  {
    key: 'frontWeightPct',
    label: 'Static Weight Bias (Front)',
    min: 47.0,
    max: 58.0,
    step: 0.5,
    unit: '%',
    format: (v) => v.toFixed(1),
    hint: 'Trunk radiator & fuel cell shift FD cars to ~49.5% F / 50.5% R',
  },
  {
    key: 'chassisRigidity',
    label: 'Chromoly Cage Rigidity',
    min: 0.8,
    max: 1.5,
    step: 0.05,
    unit: 'x',
    format: (v) => v.toFixed(2),
    hint: 'Seam-welded shell + FIA chromoly cage isolates suspension response',
  },
  {
    key: 'rearTireWidthMm',
    label: 'Rear Tire Width',
    min: 225,
    max: 315,
    step: 10,
    unit: ' mm',
    hint: 'Staggered 295–315mm FD rear tires trade low-speed slip for huge bite',
  },
  {
    key: 'rearTirePsi',
    label: 'Rear Tire Pressure',
    min: 12,
    max: 42,
    step: 1,
    unit: ' PSI',
    hint: 'FD cars air down to 15–20 PSI for massive footprint; 32+ PSI slides easily',
  },
  {
    key: 'rearTireGrip',
    label: 'Tire Compound Grip',
    min: 0.65,
    max: 1.15,
    step: 0.01,
    unit: ' μ',
    format: (v) => v.toFixed(2),
    hint: 'Street (0.78) vs FD Spec 200TW Semi-Slick (1.02–1.08)',
  },
  {
    key: 'brakeBiasPct',
    label: 'Brake Bias (Front)',
    min: 50,
    max: 75,
    step: 1,
    unit: '%',
    hint: '65–68% front bias lets drivers left-foot brake mid-drift without locking rear',
  },
];

const DRIVETRAIN_SLIDERS: SliderSpec[] = [
  {
    key: 'lsdLockPct',
    label: 'Rear LSD / Spool Lock',
    min: 0,
    max: 100,
    step: 2,
    unit: '%',
    hint: '100% welded spool or quick-change clutch diff for predictable snap',
  },
  {
    key: 'finalDriveRatio',
    label: 'Quick-Change Final Drive',
    min: 3.1,
    max: 4.9,
    step: 0.05,
    unit: ':1',
    format: (v) => v.toFixed(2),
    hint: 'Tune 3rd/4th gear wheel speed to match track layout & tire grip',
  },
  {
    key: 'turboBoostPsi',
    label: 'Boost / Supercharger PSI',
    min: 0,
    max: 28,
    step: 1,
    unit: ' PSI',
    hint: 'High output (20–26 PSI) overcomes sticky 305mm @ 18 PSI FD tires',
  },
];

const FFB_SLIDERS: SliderSpec[] = [
  {
    key: 'steeringWheelDeg',
    label: 'FFB Wheel Rotation Lock',
    min: 540,
    max: 1080,
    step: 90,
    unit: '°',
    hint: 'Match your physical wheel (900° for DD/belt bases = 450° BeamNG half-lock)',
  },
  {
    key: 'ffbStrengthPct',
    label: 'FFB Self-Steer Gain (SAT)',
    min: 60,
    max: 160,
    step: 5,
    unit: '%',
    hint: '115–130% sharpens self-aligning countersteer kick on wheel release',
  },
  {
    key: 'ffbDampingPct',
    label: 'Steering Rack Damping',
    min: 0,
    max: 60,
    step: 2,
    unit: '%',
    hint: '12–20% filters high-frequency DD oscillation without numbing road feel',
  },
];

const SUBSYSTEM_TABS: { id: TuneSectionId; label: string; specs: SliderSpec[] }[] = [
  { id: 'geometry', label: 'Geometry', specs: GEOMETRY_SLIDERS },
  { id: 'ffb', label: 'FFB Wheel', specs: FFB_SLIDERS },
  { id: 'coilovers', label: 'Coilovers', specs: COILOVER_SLIDERS },
  { id: 'chassis_tires', label: 'Tires', specs: CHASSIS_TIRE_SLIDERS },
  { id: 'drivetrain', label: 'Drivetrain', specs: DRIVETRAIN_SLIDERS },
];

export const TuningPanel: React.FC<TuningPanelProps> = ({
  chassis,
  tune,
  track,
  onSelectChassis,
  onChangeTune,
  onResetChassisDefault,
  onApplyProPreset,
  compact = false,
}) => {
  const [activeSection, setActiveSection] = useState<TuneSectionId>('geometry');
  const [copiedReport, setCopiedReport] = useState(false);

  const handleCopyReport = async () => {
    const markdown = generateTuningReportMarkdown(chassis, tune, track);
    const ok = await copyTextToClipboard(markdown);
    if (ok) {
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    }
  };

  const renderSliderList = (specs: SliderSpec[]) => (
    <div className="space-y-3.5">
      {specs.map((spec) => {
        const val = tune[spec.key];
        const formatted = spec.format ? spec.format(val) : String(val);
        return (
          <div key={spec.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor={`slider-${spec.key}`}
                className="text-xs font-medium text-[#F4F6F8]"
              >
                {spec.label}
              </label>
              <span className="font-mono text-xs font-semibold text-orange-400 tabular-nums">
                {formatted}
                {spec.unit}
              </span>
            </div>
            <input
              id={`slider-${spec.key}`}
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={val}
              onChange={(e) =>
                onChangeTune({ [spec.key]: parseFloat(e.target.value) })
              }
              className="drift-slider"
            />
            {!compact && (
              <p className="text-[11px] text-[#7D8796]">{spec.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );

  // Live front wheel lock visual calculations for SVG geometry preview
  const innerAngle = tune.steeringLockDeg;
  const outerAngle = Math.max(
    22,
    tune.steeringLockDeg * (1 - (tune.ackermannPct / 100) * 0.28)
  );
  const currentSection =
    SUBSYSTEM_TABS.find((t) => t.id === activeSection) ?? SUBSYSTEM_TABS[0];

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-[#232834] bg-[#13161D] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-[#F4F6F8]">
            Chassis &amp; JBeam Calibration
          </h2>
          <p className="mt-0.5 text-xs text-[#9AA4B2]">
            {chassis.drivetrain} · {chassis.massKg} kg · {chassis.wheelbaseM} m WB
          </p>
        </div>
        <button
          type="button"
          onClick={onResetChassisDefault}
          title="Reset to chassis stock drift baseline"
          className="inline-flex items-center gap-1.5 rounded border border-[#2C3240] bg-[#191D26] px-2.5 py-1.5 text-xs font-medium text-[#D1D5DB] transition-colors hover:border-[#3E4658] hover:text-white whitespace-nowrap shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Reset</span>
        </button>
      </div>

      {/* Chassis Selector */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2">
        {CHASSIS_PRESETS.map((preset) => {
          const active = preset.id === chassis.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectChassis(preset.id)}
              className={`rounded border px-2.5 py-2 text-left text-xs font-medium transition-colors truncate ${
                active
                  ? 'border-orange-500 bg-orange-500/15 text-orange-200'
                  : 'border-[#232834] bg-[#0F1218] text-[#9AA4B2] hover:border-[#343B4C] hover:text-[#F4F6F8]'
              }`}
            >
              {preset.name.replace(' Drift Spec', '').replace(' Conv.', '')}
            </button>
          );
        })}
      </div>

      {/* Live Front Steering Lock & Rear Geometry Diagram */}
      <div className="flex items-center justify-between gap-4 rounded border border-[#232834] bg-[#0B0D11] px-3 py-2.5">
        <svg
          viewBox="0 0 140 72"
          className="h-16 w-28 shrink-0"
          aria-label="Live steering lock and Ackermann geometry preview"
        >
          {/* Chassis spine */}
          <line
            x1="34"
            y1="36"
            x2="108"
            y2="36"
            stroke="#2C3240"
            strokeWidth="2"
          />
          {/* Front & Rear Axles */}
          <line x1="94" y1="14" x2="94" y2="58" stroke="#3E4658" strokeWidth="2" />
          <line x1="40" y1="14" x2="40" y2="58" stroke="#3E4658" strokeWidth="2" />
          {/* Rear Tires (taper width subtly with rearTireWidthMm) */}
          <rect
            x="31"
            y="9"
            width="18"
            height={6 + ((tune.rearTireWidthMm - 225) / 90) * 3}
            rx="1.5"
            fill="#64748B"
          />
          <rect
            x="31"
            y="54"
            width="18"
            height={6 + ((tune.rearTireWidthMm - 225) / 90) * 3}
            rx="1.5"
            fill="#64748B"
          />
          {/* Front Left Wheel (inner at right turn) */}
          <g transform={`translate(94, 14) rotate(${innerAngle})`}>
            <rect x="-9" y="-3.5" width="18" height="7" rx="1.5" fill="#F97316" />
          </g>
          {/* Front Right Wheel (outer at right turn) */}
          <g transform={`translate(94, 58) rotate(${outerAngle})`}>
            <rect x="-9" y="-3.5" width="18" height="7" rx="1.5" fill="#0EA5E9" />
          </g>
        </svg>

        <div className="flex flex-1 flex-col gap-0.5 text-right font-mono text-[11px] tabular-nums">
          <div className="flex justify-between text-[#9AA4B2]">
            <span>Lock / KPI</span>
            <span className="text-orange-400">
              {innerAngle.toFixed(0)}°{' '}
              <span className="text-sky-400">({outerAngle.toFixed(0)}°)</span> ·{' '}
              <span className="text-[#F4F6F8]">{tune.kpiDeg.toFixed(1)}°</span>
            </span>
          </div>
          <div className="flex justify-between text-[#9AA4B2]">
            <span>Toe F / R</span>
            <span className="text-[#F4F6F8]">
              {tune.frontToeDeg.toFixed(2)}° / +{tune.rearToeDeg.toFixed(2)}°
            </span>
          </div>
          <div className="flex justify-between text-[#9AA4B2]">
            <span>Rear Tire</span>
            <span className="text-[#F4F6F8]">
              {tune.rearTireWidthMm}mm @ {tune.rearTirePsi} PSI
            </span>
          </div>
          <div className="flex justify-between text-[#9AA4B2]">
            <span>Weight / FFB</span>
            <span className="text-[#F4F6F8]">
              {tune.frontWeightPct.toFixed(1)}% F · {tune.steeringWheelDeg}° ({tune.ffbStrengthPct}%)
            </span>
          </div>
        </div>
      </div>

      {/* Subsystem Tabs */}
      {compact ? (
        <>
          <div
            className="grid grid-cols-5 gap-1 rounded border border-[#232834] bg-[#0B0D11] p-1"
            role="tablist"
            aria-label="Tuning subsystems"
          >
            {SUBSYSTEM_TABS.map((tab) => {
              const active = tab.id === activeSection;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveSection(tab.id)}
                  className={`rounded px-1.5 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#1E2430] text-[#F4F6F8]'
                      : 'text-[#8F98A6] hover:text-[#F4F6F8]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="pt-1">{renderSliderList(currentSection.specs)}</div>
        </>
      ) : (
        <div className="space-y-5">
          {SUBSYSTEM_TABS.map((section) => (
            <div
              key={section.id}
              className="space-y-3 border-t border-[#232834] pt-4"
            >
              <h3 className="text-xs font-semibold tracking-wide text-[#9AA4B2]">
                {section.label}
              </h3>
              {renderSliderList(section.specs)}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 border-t border-[#232834] pt-3">
        <button
          type="button"
          onClick={onApplyProPreset}
          className="w-full rounded border border-[#2C3240] bg-[#191D26] px-3 py-2 text-xs font-semibold text-[#F4F6F8] transition-colors hover:border-orange-500/60 hover:bg-[#1E232E] whitespace-nowrap shrink-0"
        >
          Apply Formula Drift PRO Spec (68° · 5.5° KPI · 305mm)
        </button>
        <button
          type="button"
          onClick={handleCopyReport}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-[#232834] bg-[#0F1218] px-3 py-2 text-xs font-medium text-[#D1D5DB] transition-colors hover:border-[#3E4658] hover:text-white whitespace-nowrap shrink-0"
        >
          {copiedReport ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Copied Markdown Tuning Report</span>
            </>
          ) : (
            <>
              <FileText className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />
              <span>Copy Forum Tuning Report (Markdown)</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
