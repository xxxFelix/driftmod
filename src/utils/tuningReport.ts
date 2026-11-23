import { ChassisPreset, DriftTuneParams, TrackDefinition } from '../types/drift';

export function generateTuningReportMarkdown(
  chassis: ChassisPreset,
  tune: DriftTuneParams,
  track?: TrackDefinition
): string {
  const rearWeightPct = Number((100 - tune.frontWeightPct).toFixed(1));
  const outerLockDeg = Math.max(
    22,
    tune.steeringLockDeg * (1 - (tune.ackermannPct / 100) * 0.28)
  );
  const estPeakHp = Math.round(
    chassis.basePowerHp * (1 + (tune.turboBoostPsi / 24) * 0.62)
  );
  const frontArbPct = 100 - tune.rearArbBiasPct;
  const springRatio = (tune.frontSpringKn / Math.max(1, tune.rearSpringKn)).toFixed(2);
  const diffLabel =
    tune.lsdLockPct >= 98
      ? 'Welded Spool (100%)'
      : `${tune.lsdLockPct}% 2-Way Drift LSD`;

  const formatSigned = (val: number, decimals: number) =>
    `${val > 0 ? '+' : ''}${val.toFixed(decimals)}`;

  const lines: string[] = [
    `# DriftMod Tuning Report — ${chassis.name}`,
    '',
    `- **BeamNG Vehicle ID:** \`${chassis.beamngInternalId}\``,
    `- **Drivetrain / Engine:** ${chassis.drivetrain}`,
    `- **Chassis Mass / Wheelbase:** ${chassis.massKg} kg / ${chassis.wheelbaseM} m`,
    `- **Estimated Output:** ~${estPeakHp} HP (${chassis.basePowerHp} HP base @ ${tune.turboBoostPsi} PSI boost, ${chassis.redlineRpm.toLocaleString()} RPM redline)`,
    ...(track
      ? [
          `- **Test Track & Surface:** ${track.name} — ${track.surfaceLabel} (μ ${track.surfaceGripMult.toFixed(2)})`,
        ]
      : []),
    `- **Static Weight Balance:** ${tune.frontWeightPct.toFixed(1)}% Front / ${rearWeightPct.toFixed(1)}% Rear`,
    `- **JBeam Part Slot:** \`vehicles/${chassis.beamngInternalId}/driftmod/${chassis.beamngInternalId}_driftmod_suspension_F.jbeam\` (\`${chassis.beamngInternalId}_driftmod_dw_suspension_F\`)`,
    '',
    '## 1. Steering & Alignment Geometry',
    '',
    '| Parameter | Value | Setup Note |',
    '| :--- | :--- | :--- |',
    `| Max Steering Lock | ${tune.steeringLockDeg}° (Outer ~${outerLockDeg.toFixed(1)}°) | Angle kit hydro travel limit |`,
    `| Ackermann Geometry | ${tune.ackermannPct}% | ${tune.ackermannPct <= 0 ? 'Parallel / anti-Ackermann reduces mid-drift bind' : 'Positive Ackermann favors street turn-in'} |`,
    `| Kingpin Inclination (KPI) | ${tune.kpiDeg.toFixed(1)}° | ${tune.kpiDeg <= 6.5 ? 'Low-KPI drop-knuckle prevents lock jacking' : 'Stock-range knuckle inclination'} |`,
    `| Front Caster Angle | ${formatSigned(tune.frontCasterDeg, 1)}° | Self-aligning countersteer torque & camber gain |`,
    `| Front Camber | ${formatSigned(tune.frontCamberDeg, 1)}° | Leading front contact patch at high lock |`,
    `| Rear Camber | ${formatSigned(tune.rearCamberDeg, 1)}° | Static rear alignment under squat |`,
    `| Front Static Toe | ${formatSigned(tune.frontToeDeg, 2)}° | ${tune.frontToeDeg < 0 ? 'Toe-out sharpens initiation' : 'Toe-in calms straight-line steering'} |`,
    `| Rear Static Toe | ${formatSigned(tune.rearToeDeg, 2)}° | ${tune.rearToeDeg > 0 ? 'Toe-in boosts forward bite & stability' : 'Neutral/toe-out loosens rear transitions'} |`,
    `| Steering Rack Speed | ${tune.steeringSpeed.toFixed(2)}x | BeamNG hydro in/out catch speed |`,
    `| FFB Wheel Lock | ${tune.steeringWheelDeg}° (${Math.round(tune.steeringWheelDeg / 2)}° half-lock) | Physical DD/belt steering wheel calibration |`,
    `| FFB Self-Steer Gain | ${tune.ffbStrengthPct}% | Self-aligning torque (SAT) rack force multiplier |`,
    `| Steering Rack Damping | ${tune.ffbDampingPct}% | Filters high-frequency DD oscillation |`,
    '',
    '## 2. Coilovers & Suspension Kinematics',
    '',
    '| Parameter | Value | Setup Note |',
    '| :--- | :--- | :--- |',
    `| Front Coilover Spring | ${tune.frontSpringKn} kN/m (${(tune.frontSpringKn * 1000).toLocaleString()} N/m) | F/R spring ratio: ${springRatio}:1 |`,
    `| Rear Coilover Spring | ${tune.rearSpringKn} kN/m (${(tune.rearSpringKn * 1000).toLocaleString()} N/m) | Controls rear squat & weight transfer |`,
    `| Anti-Roll Bar Bias | ${frontArbPct}% Front / ${tune.rearArbBiasPct}% Rear | ${tune.rearArbBiasPct <= 35 ? 'Soft/disconnected rear bar for chase grip' : 'Stiffer rear bar sharpens oversteer snap'} |`,
    `| Rear Anti-Squat | ${tune.antiSquatPct}% | Subframe pickup geometry under throttle |`,
    '',
    '## 3. Chassis, Wheels, Tires & Brakes',
    '',
    '| Parameter | Value | Setup Note |',
    '| :--- | :--- | :--- |',
    `| Weight Distribution | ${tune.frontWeightPct.toFixed(1)}% F / ${rearWeightPct.toFixed(1)}% R | Radiator/fuel cell ballast balance |`,
    `| Chromoly Cage Rigidity | ${tune.chassisRigidity.toFixed(2)}x | Torsional chassis & strut-tower bracing |`,
    `| Rear Tire Width | ${tune.rearTireWidthMm} mm | Staggered rear section width |`,
    `| Rear Tire Pressure | ${tune.rearTirePsi} PSI | ${tune.rearTirePsi <= 21 ? 'Aired down for max FD contact patch' : 'Higher PSI reduces bite for easier slide'} |`,
    `| Tire Compound Grip | ${tune.rearTireGrip.toFixed(2)} μ | ${tune.rearTireGrip >= 0.98 ? '200TW competition semi-slick range' : 'Street / grassroots compound range'} |`,
    `| Brake Bias | ${tune.brakeBiasPct}% Front / ${100 - tune.brakeBiasPct}% Rear | ${tune.brakeBiasPct >= 63 ? 'Front-biased for mid-drift left-foot braking' : 'Balanced street brake split'} |`,
    '',
    '## 4. Drivetrain & Forced Induction',
    '',
    '| Parameter | Value | Setup Note |',
    '| :--- | :--- | :--- |',
    `| Differential Lock | ${diffLabel} | Rear axle lockup behavior |`,
    `| Final Drive Ratio | ${tune.finalDriveRatio.toFixed(2)}:1 | Quick-change ring & pinion gearing |`,
    `| Target Wastegate Boost | ${tune.turboBoostPsi} PSI (~${Math.round(tune.turboBoostPsi * 6.895)} kPa) | Forced induction pressure ceiling |`,
    '',
    '_Generated with DriftMod Workbench_',
  ];

  return lines.join('\n');
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback for restricted contexts
    }
  }

  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}
