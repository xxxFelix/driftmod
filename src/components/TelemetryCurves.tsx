import React, { useMemo } from 'react';
import {
  ChassisPreset,
  DriftTuneParams,
  TelemetrySample,
  TrackDefinition,
} from '../types/drift';

interface TelemetryCurvesProps {
  chassis: ChassisPreset;
  tune: DriftTuneParams;
  track: TrackDefinition;
  history: TelemetrySample[];
}

export const TelemetryCurves: React.FC<TelemetryCurvesProps> = ({
  chassis,
  tune,
  track,
  history,
}) => {
  // 1. Pacejka Lateral Force vs Slip Angle Curve (0..70 deg)
  const slipCurvePoints = useMemo(() => {
    const pts: { deg: number; force: number }[] = [];
    const rearCamberFactor =
      1 - Math.max(0, Math.abs(tune.rearCamberDeg) - 1.0) * 0.032;
    const arbRearFactor = 1 - ((tune.rearArbBiasPct - 42) / 100) * 0.3;
    const tireWidthFactor = Math.max(
      0.85,
      Math.min(1.08, 0.88 + ((tune.rearTireWidthMm - 235) / 80) * 0.16)
    );
    const psiDelta = tune.rearTirePsi - 18;
    const tirePsiFactor =
      psiDelta >= 0
        ? Math.max(0.82, Math.min(1.03, 1.03 - psiDelta * 0.0082))
        : Math.max(0.94, Math.min(1.03, 1.03 + psiDelta * 0.012));
    const rearToeStability =
      1 + Math.max(-0.2, Math.min(0.7, tune.rearToeDeg)) * 0.14;
    const rearWeightBias = Math.max(
      0.92,
      Math.min(1.08, 1 + (51 - tune.frontWeightPct) * 0.014)
    );

    const peakMu =
      tune.rearTireGrip *
      tireWidthFactor *
      tirePsiFactor *
      rearToeStability *
      rearWeightBias *
      track.surfaceGripMult *
      rearCamberFactor *
      arbRearFactor;

    for (let deg = 0; deg <= 70; deg += 2) {
      const rad = (deg * Math.PI) / 180;
      const force = peakMu * Math.sin(1.45 * Math.atan(4.5 * rad));
      pts.push({ deg, force });
    }
    return pts;
  }, [
    tune.rearTireGrip,
    tune.rearCamberDeg,
    tune.rearArbBiasPct,
    tune.rearTireWidthMm,
    tune.rearTirePsi,
    tune.rearToeDeg,
    tune.frontWeightPct,
    track.surfaceGripMult,
  ]);

  // 2. Engine Torque Curve (1000..Redline RPM)
  const torqueCurve = useMemo(() => {
    const pts: { rpm: number; nm: number; hp: number }[] = [];
    const baseNm = (chassis.basePowerHp * 7127) / (chassis.redlineRpm * 0.85);
    const boostMult = 1 + (tune.turboBoostPsi / 24) * 0.62;
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const rpm = 1200 + ((chassis.redlineRpm - 1200) * i) / steps;
      const norm = rpm / chassis.redlineRpm;
      const spool = Math.max(0.25, Math.min(1, (rpm - 2100) / 2400));
      const shape = Math.sin(norm * Math.PI * 0.85) * 0.45 + 0.55;
      const nm = baseNm * shape * (1 + (boostMult - 1) * spool);
      const hp = (nm * rpm) / 7127;
      pts.push({ rpm: Math.round(rpm), nm: Math.round(nm), hp: Math.round(hp) });
    }
    return pts;
  }, [chassis, tune.turboBoostPsi]);

  const pacejkaSvgPath = useMemo(() => {
    const w = 480;
    const h = 190;
    const padL = 40;
    const padB = 26;
    const padT = 16;
    const padR = 16;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    return slipCurvePoints
      .map((p, idx) => {
        const x = padL + (p.deg / 70) * plotW;
        const y = padT + plotH - (Math.min(1.35, p.force) / 1.35) * plotH;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [slipCurvePoints]);

  const torqueSvgPaths = useMemo(() => {
    const w = 480;
    const h = 190;
    const padL = 40;
    const padB = 26;
    const padT = 16;
    const padR = 16;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxVal = Math.max(
      700,
      ...torqueCurve.map((p) => Math.max(p.nm, p.hp))
    );

    const nmPath = torqueCurve
      .map((p, idx) => {
        const x = padL + (idx / (torqueCurve.length - 1)) * plotW;
        const y = padT + plotH - (p.nm / maxVal) * plotH;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    const hpPath = torqueCurve
      .map((p, idx) => {
        const x = padL + (idx / (torqueCurve.length - 1)) * plotW;
        const y = padT + plotH - (p.hp / maxVal) * plotH;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    return { nmPath, hpPath, maxVal };
  }, [torqueCurve]);

  const liveTracePaths = useMemo(() => {
    if (history.length < 2) return null;
    const w = 960;
    const h = 180;
    const padL = 42;
    const padR = 16;
    const padT = 14;
    const padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const slipPath = history
      .map((s, i) => {
        const x = padL + (i / (history.length - 1)) * plotW;
        const y = padT + plotH - (Math.min(80, s.slipAngleDeg) / 80) * plotH;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    const speedPath = history
      .map((s, i) => {
        const x = padL + (i / (history.length - 1)) * plotW;
        const y = padT + plotH - (Math.min(180, s.speedKmh) / 180) * plotH;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    return { slipPath, speedPath };
  }, [history]);

  const peakPower = Math.max(...torqueCurve.map((p) => p.hp));
  const peakTorque = Math.max(...torqueCurve.map((p) => p.nm));
  const peakGrip = Math.max(...slipCurvePoints.map((p) => p.force));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[#232834] pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#F4F6F8]">
            Tire Slip, Powertrain &amp; Live Track Telemetry
          </h1>
          <p className="mt-1 text-sm text-[#9AA4B2]">
            {chassis.name} · {track.surfaceLabel} (μ {track.surfaceGripMult.toFixed(2)}) ·{' '}
            {tune.steeringLockDeg}° Lock · {tune.kpiDeg.toFixed(1)}° KPI ·{' '}
            {tune.rearTireWidthMm}mm @ {tune.rearTirePsi} PSI ·{' '}
            {tune.frontWeightPct.toFixed(1)}% F
          </p>
        </div>
        <div className="flex items-center gap-6 font-mono text-xs tabular-nums">
          <div>
            <span className="text-[#9AA4B2]">Peak Output </span>
            <span className="font-semibold text-orange-400">{peakPower} HP</span>
          </div>
          <div>
            <span className="text-[#9AA4B2]">Peak Torque </span>
            <span className="font-semibold text-sky-400">{peakTorque} Nm</span>
          </div>
          <div>
            <span className="text-[#9AA4B2]">Rear Peak </span>
            <span className="font-semibold text-emerald-400">{peakGrip.toFixed(2)} μ</span>
          </div>
        </div>
      </div>

      {/* Top 2 analytical curves */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[#232834] bg-[#13161D] p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#F4F6F8]">
              Pacejka Rear Tire Lateral Force vs Slip Angle
            </h2>
            <span className="font-mono text-xs text-[#9AA4B2] tabular-nums">
              {tune.rearTireWidthMm}mm @ {tune.rearTirePsi} PSI · Toe +{tune.rearToeDeg.toFixed(2)}°
            </span>
          </div>
          <svg
            viewBox="0 0 480 190"
            className="w-full"
            role="img"
            aria-label="Lateral tire grip versus slip angle curve"
          >
            {/* Grid lines */}
            {[0.25, 0.5, 0.75, 1.0, 1.25].map((g) => {
              const y = 16 + 148 - (g / 1.35) * 148;
              return (
                <g key={g}>
                  <line x1="40" y1={y} x2="464" y2={y} stroke="#1E2430" strokeWidth="1" />
                  <text
                    x="34"
                    y={y + 3}
                    textAnchor="end"
                    className="fill-[#7D8796] font-mono text-[9px]"
                  >
                    {g.toFixed(2)}
                  </text>
                </g>
              );
            })}
            {[0, 15, 30, 45, 60, 70].map((deg) => {
              const x = 40 + (deg / 70) * 424;
              return (
                <g key={deg}>
                  <line x1={x} y1="16" x2={x} y2="164" stroke="#1E2430" strokeWidth="1" />
                  <text
                    x={x}
                    y="179"
                    textAnchor="middle"
                    className="fill-[#7D8796] font-mono text-[9px]"
                  >
                    {deg}°
                  </text>
                </g>
              );
            })}
            {/* Target lock reference line */}
            <line
              x1={40 + (Math.min(70, tune.steeringLockDeg) / 70) * 424}
              y1="16"
              x2={40 + (Math.min(70, tune.steeringLockDeg) / 70) * 424}
              y2="164"
              stroke="#0EA5E9"
              strokeDasharray="4 3"
              strokeWidth="1.2"
            />
            <path
              d={pacejkaSvgPath}
              fill="none"
              stroke="#F97316"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <p className="mt-2 text-xs text-[#9AA4B2]">
            Dashed cyan marker indicates your current {tune.steeringLockDeg}° steering lock limit; lower rear PSI and wider section width elevate peak forward &amp; lateral bite.
          </p>
        </div>

        <div className="rounded-lg border border-[#232834] bg-[#13161D] p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-[#F4F6F8]">
              Engine Torque (Nm) &amp; Horsepower Curve
            </h2>
            <span className="font-mono text-xs text-[#9AA4B2] tabular-nums">
              {tune.turboBoostPsi} PSI Boost · {chassis.redlineRpm} RPM
            </span>
          </div>
          <svg
            viewBox="0 0 480 190"
            className="w-full"
            role="img"
            aria-label="Engine torque and horsepower curve"
          >
            {[0.25, 0.5, 0.75, 1.0].map((frac) => {
              const y = 16 + 148 - frac * 148;
              const labelVal = Math.round(torqueSvgPaths.maxVal * frac);
              return (
                <g key={frac}>
                  <line x1="40" y1={y} x2="464" y2={y} stroke="#1E2430" strokeWidth="1" />
                  <text
                    x="34"
                    y={y + 3}
                    textAnchor="end"
                    className="fill-[#7D8796] font-mono text-[9px]"
                  >
                    {labelVal}
                  </text>
                </g>
              );
            })}
            {[1500, 3000, 4500, 6000, 7500].map((rpm) => {
              const frac = (rpm - 1200) / (chassis.redlineRpm - 1200);
              if (frac < 0 || frac > 1) return null;
              const x = 40 + frac * 424;
              return (
                <g key={rpm}>
                  <line x1={x} y1="16" x2={x} y2="164" stroke="#1E2430" strokeWidth="1" />
                  <text
                    x={x}
                    y="179"
                    textAnchor="middle"
                    className="fill-[#7D8796] font-mono text-[9px]"
                  >
                    {(rpm / 1000).toFixed(1)}k
                  </text>
                </g>
              );
            })}
            <path
              d={torqueSvgPaths.nmPath}
              fill="none"
              stroke="#0EA5E9"
              strokeWidth="2.2"
            />
            <path
              d={torqueSvgPaths.hpPath}
              fill="none"
              stroke="#F97316"
              strokeWidth="2.5"
            />
          </svg>
          <div className="mt-2 flex items-center gap-5 text-xs text-[#9AA4B2]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 bg-orange-500" /> Power (HP)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 bg-sky-500" /> Torque (Nm)
            </span>
          </div>
        </div>
      </div>

      {/* Live Track Oscilloscope */}
      <div className="rounded-lg border border-[#232834] bg-[#13161D] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#F4F6F8]">
            Rolling Track Sandbox Telemetry (Last {history.length} Samples)
          </h2>
          <div className="flex items-center gap-5 text-xs text-[#9AA4B2]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 bg-orange-500" /> Slip Angle (0–80°)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 bg-sky-500" /> Speed (0–180 km/h)
            </span>
          </div>
        </div>

        {liveTracePaths ? (
          <svg
            viewBox="0 0 960 180"
            className="w-full"
            role="img"
            aria-label="Live slip angle and speed trace from the track simulator"
          >
            {[0, 20, 40, 60, 80].map((deg) => {
              const y = 14 + 142 - (deg / 80) * 142;
              return (
                <g key={deg}>
                  <line x1="42" y1={y} x2="944" y2={y} stroke="#1E2430" strokeWidth="1" />
                  <text
                    x="36"
                    y={y + 3}
                    textAnchor="end"
                    className="fill-[#7D8796] font-mono text-[9px]"
                  >
                    {deg}°
                  </text>
                </g>
              );
            })}
            <path
              d={liveTracePaths.speedPath}
              fill="none"
              stroke="#0EA5E9"
              strokeWidth="2"
            />
            <path
              d={liveTracePaths.slipPath}
              fill="none"
              stroke="#F97316"
              strokeWidth="2.4"
            />
          </svg>
        ) : (
          <div className="flex h-36 items-center justify-center rounded border border-[#232834] bg-[#0B0D11] text-sm text-[#9AA4B2]">
            Run the Track Sandbox for 2 seconds to populate live slip-angle &amp; speed telemetry.
          </div>
        )}
      </div>
    </div>
  );
};
