import {
  ChassisPreset,
  DriftTuneParams,
  LiveHudState,
  TrackDefinition,
} from '../types/drift';

export interface InputControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  clutchKick: boolean;
}

export interface SkidSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  alpha: number;
}

export interface SmokeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface TrackSample {
  x: number;
  y: number;
  tx: number;
  ty: number;
  curvature: number;
}

export interface SetupIssue {
  severity: 'critical' | 'warning';
  code: string;
  label: string;
  detail: string;
}

export interface DriftSetupAnalysis {
  mechanicalScore: number;
  grade: 'PRO' | 'COMP' | 'STREET' | 'UNBALANCED';
  powerToGripRatio: number;
  springRatio: number;
  estPeakHp: number;
  rearGripIndex: number;
  frontAuthorityIndex: number;
  issues: SetupIssue[];
}

export interface CarSimState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  angularVel: number;
  steerAngle: number;
  aiSteerCmd: number;
  rpm: number;
  gear: number;
  boostPsi: number;
  simTime: number;
  waypointIdx: number;
  splineSamples: TrackSample[];
  prevRearLeft: { x: number; y: number } | null;
  prevRearRight: { x: number; y: number } | null;
  skidmarks: SkidSegment[];
  smoke: SmokeParticle[];
  totalScore: number;
  currentDriftPoints: number;
  comboMultiplier: number;
  bestDriftRun: number;
  driftDropTimer: number;
  lastSlipAngleDeg: number;
  lastLateralG: number;
  clipZoneActive: string | null;
  clutchKickCooldown: number;
  faultStatus: 'SPINOUT' | 'BOGGED' | 'OFF_TRACK' | null;
  faultTimer: number;
  spinRecoveryTimer: number;
  recoveryCooldown: number;
  bogStreakSec: number;
  spinoutCount: number;
  bogCount: number;
  offTrackCount: number;
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computeRearTireFactors(tune: DriftTuneParams) {
  const tireWidthFactor = clamp(
    0.84 + ((tune.rearTireWidthMm - 235) / 80) * 0.2,
    0.81,
    1.1
  );
  const psiDelta = tune.rearTirePsi - 18;
  const tirePsiFactor =
    psiDelta >= 0
      ? clamp(1.04 - psiDelta * 0.0125, 0.7, 1.04)
      : clamp(1.04 + psiDelta * 0.014, 0.94, 1.04);

  const rearCamberFactor =
    1 - Math.max(0, Math.abs(tune.rearCamberDeg) - 0.8) * 0.072;
  const rearToeStability =
    tune.rearToeDeg >= 0
      ? 1 + clamp(tune.rearToeDeg, 0, 0.7) * 0.16
      : 1 + tune.rearToeDeg * 0.55;
  const rearWeightGripBias = clamp(
    1 + (51 - tune.frontWeightPct) * 0.016,
    0.9,
    1.09
  );
  const arbRearFactor = clamp(
    1 - ((tune.rearArbBiasPct - 38) / 100) * 0.44,
    0.74,
    1.1
  );

  return {
    tireWidthFactor,
    tirePsiFactor,
    rearCamberFactor,
    rearToeStability,
    rearWeightGripBias,
    arbRearFactor,
  };
}

export function analyzeDriftSetup(
  chassis: ChassisPreset,
  tune: DriftTuneParams,
  surfaceGripMult = 1.0
): DriftSetupAnalysis {
  const issues: SetupIssue[] = [];
  let penalty = 0;

  const estPeakHp = Math.round(
    chassis.basePowerHp * (1 + (tune.turboBoostPsi / 24) * 0.62)
  );
  const springRatio = Number(
    (tune.frontSpringKn / Math.max(1, tune.rearSpringKn)).toFixed(2)
  );

  const {
    tireWidthFactor,
    tirePsiFactor,
    rearCamberFactor,
    rearToeStability,
    rearWeightGripBias,
    arbRearFactor,
  } = computeRearTireFactors(tune);

  const rearGripNominal = Number(
    (
      tune.rearTireGrip *
      tireWidthFactor *
      tirePsiFactor *
      rearCamberFactor *
      rearToeStability *
      rearWeightGripBias *
      arbRearFactor
    ).toFixed(2)
  );
  const rearGripIndex = Number((rearGripNominal * surfaceGripMult).toFixed(2));

  const kpiMult = 1 - Math.max(0, tune.kpiDeg - 6.0) * 0.045;
  const ackMult = 1 + clamp((8 - tune.ackermannPct) / 100, -0.34, 0.08);
  const frontCamberMult = 1 - Math.abs(tune.frontCamberDeg + 5.1) * 0.032;
  const frontAuthorityIndex = Number(
    clamp(
      (tune.steeringLockDeg / 64) *
        kpiMult *
        ackMult *
        frontCamberMult *
        clamp(tune.frontCasterDeg / 7.8, 0.65, 1.12),
      0.32,
      1.25
    ).toFixed(2)
  );

  const finalDriveMult = tune.finalDriveRatio / 3.9;
  const wheelForceIndex =
    (estPeakHp / chassis.massKg) * (0.72 + finalDriveMult * 0.28);
  const powerToGripRatio = Number(
    (wheelForceIndex / Math.max(0.24, 0.355 * rearGripNominal)).toFixed(2)
  );

  // 1. Steering lock ceiling
  if (tune.steeringLockDeg < 50) {
    penalty += 38;
    issues.push({
      severity: 'critical',
      code: 'LOW_LOCK',
      label: `Low Steering Lock (${tune.steeringLockDeg}°)`,
      detail:
        'Runs out of front countersteer angle above ~42° slip, triggering spinouts in deep entries.',
    });
  } else if (tune.steeringLockDeg < 57) {
    penalty += 14;
    issues.push({
      severity: 'warning',
      code: 'MODEST_LOCK',
      label: `Limited Angle (${tune.steeringLockDeg}°)`,
      detail:
        'Narrower catch margin on fast switchbacks; 62–68° gives safer drift recovery.',
    });
  }

  // 2. Ackermann & KPI
  if (tune.ackermannPct > 40) {
    penalty += tune.ackermannPct > 65 ? 20 : 11;
    issues.push({
      severity: tune.ackermannPct > 65 ? 'critical' : 'warning',
      code: 'HIGH_ACKERMANN',
      label: `High Positive Ackermann (${tune.ackermannPct}%)`,
      detail:
        'Inside tire turns sharper than outer wheel, scrubbing speed and causing high-lock push.',
    });
  }
  if (tune.kpiDeg > 8.5) {
    penalty += tune.kpiDeg > 11 ? 18 : 9;
    issues.push({
      severity: tune.kpiDeg > 11 ? 'critical' : 'warning',
      code: 'HIGH_KPI',
      label: `High KPI (${tune.kpiDeg.toFixed(1)}°)`,
      detail:
        'Steep kingpin angle jacks the leading corner up at high lock and hurts front bite.',
    });
  }

  // 3. Caster, rack speed & FFB damping
  if (tune.frontCasterDeg < 5.2) {
    penalty += 14;
    issues.push({
      severity: 'warning',
      code: 'LOW_CASTER',
      label: `Low Caster (+${tune.frontCasterDeg.toFixed(1)}°)`,
      detail:
        'Weak self-aligning torque slows countersteer catch during fast transitions.',
    });
  }
  if (tune.steeringSpeed < 0.9) {
    penalty += 14;
    issues.push({
      severity: 'warning',
      code: 'SLOW_RACK',
      label: `Slow Steering Rack (${tune.steeringSpeed.toFixed(2)}x)`,
      detail:
        'Hydro travel lags quick yaw snaps; aim for 1.25–1.45x for clean drift catches.',
    });
  }
  if (tune.ffbStrengthPct > 136 && tune.ffbDampingPct < 8) {
    penalty += 12;
    issues.push({
      severity: 'warning',
      code: 'DD_CHATTER',
      label: `Undamped High FFB (${tune.ffbStrengthPct}% / ${tune.ffbDampingPct}% damp)`,
      detail:
        'Zero damping with high SAT gain induces steering rack oscillation and wobble.',
    });
  } else if (tune.ffbDampingPct > 38) {
    penalty += 10;
    issues.push({
      severity: 'warning',
      code: 'OVER_DAMPED',
      label: `Over-Damped Rack (${tune.ffbDampingPct}%)`,
      detail:
        'Excessive steering damping fights natural self-aligning wheel spin.',
    });
  }

  // 4. Camber & toe
  if (tune.frontCamberDeg > -2.4) {
    penalty += 10;
    issues.push({
      severity: 'warning',
      code: 'LOW_FRONT_CAMBER',
      label: `Low Front Camber (${tune.frontCamberDeg.toFixed(1)}°)`,
      detail:
        'Leading front tire rolls onto its outer shoulder at full lock instead of sitting flat.',
    });
  } else if (tune.frontCamberDeg < -6.3) {
    penalty += 6;
    issues.push({
      severity: 'warning',
      code: 'EXCESS_FRONT_CAMBER',
      label: `Over-Cambered Front (${tune.frontCamberDeg.toFixed(1)}°)`,
      detail:
        'Reduces straight-ahead braking bite and turn-in stability before lock builds.',
    });
  }
  if (tune.rearCamberDeg < -2.0) {
    const severeRearCamber = tune.rearCamberDeg < -3.6;
    penalty += severeRearCamber ? 26 : 12;
    issues.push({
      severity: severeRearCamber ? 'critical' : 'warning',
      code: 'EXCESS_REAR_CAMBER',
      label: `Excess Rear Negative Camber (${tune.rearCamberDeg.toFixed(1)}°)`,
      detail:
        'Shrinks the rear contact patch under throttle squat, hurting chase speed and mid-drift bite.',
    });
  }
  if (tune.rearToeDeg < -0.02) {
    penalty += 25;
    issues.push({
      severity: 'critical',
      code: 'REAR_TOE_OUT',
      label: `Rear Toe-Out (${tune.rearToeDeg.toFixed(2)}°)`,
      detail:
        'Rear axle steers outward under lateral load, triggering snap spinouts on transitions.',
    });
  }

  // 5. Coilover ratio, ARB & anti-squat
  if (springRatio < 1.15) {
    penalty += 38;
    issues.push({
      severity: 'critical',
      code: 'INVERTED_SPRINGS',
      label: `Inverted F/R Springs (${tune.frontSpringKn}/${tune.rearSpringKn} kN/m)`,
      detail:
        'Front is too soft relative to the rear, causing front dive washout and snappy rear breakaway.',
    });
  } else if (springRatio > 2.4) {
    penalty += 12;
    issues.push({
      severity: 'warning',
      code: 'STIFF_FRONT_SPLIT',
      label: `Extreme F/R Spring Split (${springRatio}:1)`,
      detail:
        'Front can push wide on bumpy entries while soft rear bottoms out under throttle.',
    });
  }
  if (tune.rearArbBiasPct > 58) {
    penalty += 16;
    issues.push({
      severity: 'warning',
      code: 'STIFF_REAR_ARB',
      label: `Stiff Rear ARB (${tune.rearArbBiasPct}%)`,
      detail:
        'Unloads the inside rear tire mid-corner, trading forward drive for snappy oversteer.',
    });
  }
  if (tune.antiSquatPct > 76) {
    penalty += 10;
    issues.push({
      severity: 'warning',
      code: 'HIGH_ANTI_SQUAT',
      label: `Excess Anti-Squat (${tune.antiSquatPct}%)`,
      detail:
        'Stiffens rear suspension under power and causes axle hop over curbing.',
    });
  }

  // 6. Differential lock
  if (tune.lsdLockPct < 45) {
    penalty += 40;
    issues.push({
      severity: 'critical',
      code: 'OPEN_DIFF',
      label: `Open Differential (${tune.lsdLockPct}%)`,
      detail:
        'One-wheel peel unloads the inside tire under throttle, snapping the car straight mid-drift.',
    });
  } else if (tune.lsdLockPct < 75) {
    penalty += 16;
    issues.push({
      severity: 'warning',
      code: 'SOFT_LSD',
      label: `Weak LSD Lock (${tune.lsdLockPct}%)`,
      detail:
        'Inconsistent dual-wheel lockup causes mid-corner straightening during transitions.',
    });
  }

  // 7. Brake bias
  if (tune.brakeBiasPct < 58) {
    penalty += 34;
    issues.push({
      severity: 'critical',
      code: 'REAR_BRAKE_BIAS',
      label: `Rear-Biased Brakes (${tune.brakeBiasPct}% F)`,
      detail:
        'Braking into corners or left-foot braking mid-drift locks the rear wheels into a spin.',
    });
  }

  // 8. Power vs rear tire traction balance
  if (powerToGripRatio < 0.78) {
    penalty += 38;
    issues.push({
      severity: 'critical',
      code: 'UNDERPOWERED_BOG',
      label: 'Under-Powered vs Rear Tire Grip',
      detail:
        'Wide/sticky tires overpower engine torque & gearing — car hooks straight and bogs out of drift.',
    });
  } else if (rearGripNominal < 0.72 || powerToGripRatio > 1.85) {
    const severe = rearGripNominal < 0.62 || powerToGripRatio > 2.1;
    penalty += severe ? 42 : 18;
    issues.push({
      severity: severe ? 'critical' : 'warning',
      code: 'LOW_REAR_TRACTION',
      label: 'Over-Pressured / Low Rear Traction',
      detail:
        'Excessive PSI or narrow hard tires overwhelm forward drive, causing slow wheelspin crawls and snaps.',
    });
  }

  const mechanicalScore = Math.round(clamp(100 - penalty, 5, 100));
  const grade: DriftSetupAnalysis['grade'] =
    mechanicalScore >= 88
      ? 'PRO'
      : mechanicalScore >= 72
      ? 'COMP'
      : mechanicalScore >= 52
      ? 'STREET'
      : 'UNBALANCED';

  return {
    mechanicalScore,
    grade,
    powerToGripRatio,
    springRatio,
    estPeakHp,
    rearGripIndex,
    frontAuthorityIndex,
    issues,
  };
}

export function buildTrackSpline(track: TrackDefinition): TrackSample[] {
  const wps = track.waypoints;
  const n = wps.length;
  const subPerSeg = 16;
  const rawPts: { x: number; y: number }[] = [];

  for (let i = 0; i < n; i++) {
    const pPrev = wps[(i - 1 + n) % n];
    const pCurr = wps[i];
    const pNext = wps[(i + 1) % n];
    const startX = (pPrev.x + pCurr.x) / 2;
    const startY = (pPrev.y + pCurr.y) / 2;
    const endX = (pCurr.x + pNext.x) / 2;
    const endY = (pCurr.y + pNext.y) / 2;

    for (let s = 0; s < subPerSeg; s++) {
      const t = s / subPerSeg;
      const mt = 1 - t;
      const x = mt * mt * startX + 2 * mt * t * pCurr.x + t * t * endX;
      const y = mt * mt * startY + 2 * mt * t * pCurr.y + t * t * endY;
      rawPts.push({ x, y });
    }
  }

  const total = rawPts.length;
  const samples: TrackSample[] = [];
  for (let i = 0; i < total; i++) {
    const prev = rawPts[(i - 3 + total) % total];
    const curr = rawPts[i];
    const next = rawPts[(i + 3) % total];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.max(1e-4, Math.hypot(dx, dy));
    const tx = dx / len;
    const ty = dy / len;

    const a1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
    const dAngle = normalizeAngle(a2 - a1);
    const curvature = dAngle / (len * 0.5);
    samples.push({ x: curr.x, y: curr.y, tx, ty, curvature });
  }
  return samples;
}

export function createInitialCarState(track: TrackDefinition): CarSimState {
  const splineSamples = buildTrackSpline(track);
  const start = splineSamples[0];
  const heading = Math.atan2(start.ty, start.tx);

  const startSpeedPx = track.roadWidth < 100 ? 105 : 135;

  return {
    x: start.x,
    y: start.y,
    heading,
    vx: Math.cos(heading) * startSpeedPx,
    vy: Math.sin(heading) * startSpeedPx,
    angularVel: 0,
    steerAngle: 0,
    aiSteerCmd: 0,
    rpm: 3400,
    gear: 2,
    boostPsi: 0,
    simTime: 0,
    waypointIdx: 0,
    splineSamples,
    prevRearLeft: null,
    prevRearRight: null,
    skidmarks: [],
    smoke: [],
    totalScore: 0,
    currentDriftPoints: 0,
    comboMultiplier: 1.0,
    bestDriftRun: 0,
    driftDropTimer: 0,
    lastSlipAngleDeg: 0,
    lastLateralG: 0,
    clipZoneActive: null,
    clutchKickCooldown: 0,
    faultStatus: null,
    faultTimer: 0,
    spinRecoveryTimer: 0,
    recoveryCooldown: 0,
    bogStreakSec: 0,
    spinoutCount: 0,
    bogCount: 0,
    offTrackCount: 0,
  };
}

function computeAutopilotInput(
  car: CarSimState,
  tune: DriftTuneParams,
  track: TrackDefinition,
  safeDt: number
): InputControls {
  const samples = car.splineSamples;
  const n = samples.length;

  let closestIdx = car.waypointIdx;
  let minDist = Infinity;
  for (let offset = 0; offset <= 24; offset++) {
    const idx = (car.waypointIdx + offset) % n;
    const d = Math.hypot(samples[idx].x - car.x, samples[idx].y - car.y);
    if (d < minDist) {
      minDist = d;
      closestIdx = idx;
    }
  }
  car.waypointIdx = closestIdx;

  const speed = Math.hypot(car.vx, car.vy);
  const speedKmh = speed * 0.46;

  // Look ahead along the track spline, blending subtly toward nearby clipping zones
  const lookAheadSteps = Math.round(clamp(7 + speedKmh * 0.05, 7, 12));
  const targetSample = samples[(closestIdx + lookAheadSteps) % n];
  let aimX = targetSample.x;
  let aimY = targetSample.y;

  for (const zone of track.clippingZones) {
    const distZone = Math.hypot(zone.x - targetSample.x, zone.y - targetSample.y);
    if (distZone < zone.radius + 32) {
      aimX = targetSample.x * 0.72 + zone.x * 0.28;
      aimY = targetSample.y * 0.72 + zone.y * 0.28;
      break;
    }
  }

  let signedCurv = 0;
  let upcomingPeakCurv = 0;
  let brakePeakCurv = 0;
  for (let k = 2; k <= 26; k += 2) {
    const c = samples[(closestIdx + k) % n].curvature;
    brakePeakCurv = Math.max(brakePeakCurv, Math.abs(c));
    if (k <= 20) {
      const w = k <= 10 ? 1.0 : 0.55;
      signedCurv += c * w;
      upcomingPeakCurv = Math.max(upcomingPeakCurv, Math.abs(c));
    }
  }
  signedCurv /= 7.75;
  const curvMag = Math.abs(signedCurv);

  const lookaheadAngle = Math.atan2(aimY - car.y, aimX - car.x);

  const nearest = samples[closestIdx];
  const crossVecX = car.x - nearest.x;
  const crossVecY = car.y - nearest.y;
  const crossErr = crossVecX * -nearest.ty + crossVecY * nearest.tx;
  const absCross = Math.abs(crossErr);
  const edgeRatio = clamp(absCross / (track.roadWidth * 0.48), 0, 1.15);

  const velAngle = speed > 20 ? Math.atan2(car.vy, car.vx) : car.heading;
  const desiredTravelAngle = normalizeAngle(
    lookaheadAngle - clamp(crossErr / (track.roadWidth * 0.26), -1.0, 1.0)
  );
  const travelErr = normalizeAngle(desiredTravelAngle - velAngle);

  // Target competitive drift angle (36-46 deg in corners, 18-24 deg transitions)
  // Low steering lock (<54 deg) and high Ackermann hit physical bump stops trying to hold real drift angles!
  const targetMaxCornerDeg =
    upcomingPeakCurv > 0.011
      ? clamp(44 - upcomingPeakCurv * 180, 35, 44)
      : 46;

  const isCorner = curvMag > 0.0011 || upcomingPeakCurv > 0.0024;
  const rawSlipDeg = isCorner
    ? clamp(curvMag * 9600 + upcomingPeakCurv * 2100, 38, targetMaxCornerDeg)
    : Math.abs(travelErr) > 0.07
    ? 25
    : 15;

  const baseSlipDeg = rawSlipDeg * (1 - Math.max(0, edgeRatio - 0.38) * 0.58);
  const turnDir =
    curvMag > 0.001 ? Math.sign(signedCurv) : Math.sign(travelErr || 1);

  const targetSlipRad = clamp(
    (turnDir * baseSlipDeg * Math.PI) / 180,
    (-targetMaxCornerDeg * Math.PI) / 180,
    (targetMaxCornerDeg * Math.PI) / 180
  );

  const desiredHeading = normalizeAngle(desiredTravelAngle + targetSlipRad);
  const headingErr = normalizeAngle(desiredHeading - car.heading);

  const currentSlipRad = normalizeAngle(car.heading - velAngle);
  const absSlipDeg = (Math.abs(currentSlipRad) * 180) / Math.PI;
  const lockRad = (tune.steeringLockDeg * Math.PI) / 180;

  const { tireWidthFactor, tirePsiFactor, rearToeStability, arbRearFactor } =
    computeRearTireFactors(tune);
  const estRearGrip = clamp(
    tune.rearTireGrip *
      tireWidthFactor *
      tirePsiFactor *
      rearToeStability *
      arbRearFactor,
    0.42,
    1.32
  );

  const nearWall =
    car.x < 72 ||
    car.x > track.worldWidth - 72 ||
    car.y < 72 ||
    car.y > track.worldHeight - 72;
  const minCornerRadiusM = 1 / Math.max(0.0028, brakePeakCurv) / 7.8;
  const isHairpin = brakePeakCurv >= 0.011;
  const gripSpeedBonus = clamp((estRearGrip - 0.9) * 24, -15, 10);
  const latGripMs2 =
    (isHairpin ? 9.1 : track.roadWidth < 102 ? 12.1 : 13.6) *
    track.surfaceGripMult;
  const physCornerKmh =
    Math.sqrt(latGripMs2 * minCornerRadiusM) * 3.6 + gripSpeedBonus;
  const targetSpeedKmh = clamp(
    physCornerKmh * (1 - clamp(edgeRatio, 0, 1) * 0.28) - (nearWall ? 12 : 0),
    isHairpin ? 32 : 36,
    98
  );

  let throttle = 0.88;
  let brake = 0;
  let handbrake = false;
  let clutchKick = false;

  let desiredSteerRad: number;
  const overRotating =
    absSlipDeg > Math.min(56, targetMaxCornerDeg + 7) ||
    (absSlipDeg > 42 &&
      Math.sign(car.angularVel) === Math.sign(currentSlipRad) &&
      Math.abs(car.angularVel) > 1.12);

  if (overRotating) {
    desiredSteerRad = clamp(
      -currentSlipRad * 1.2 +
        clamp(travelErr, -0.42, 0.42) * 0.48 -
        car.angularVel * 0.42,
      -lockRad,
      lockRad
    );
    throttle = 0.06;
  } else {
    desiredSteerRad = clamp(
      -currentSlipRad * 0.72 +
        headingErr * 1.88 +
        clamp(travelErr, -0.62, 0.62) * 0.54 -
        car.angularVel * 0.25,
      -lockRad,
      lockRad
    );

    const targetSlipDeg = (Math.abs(targetSlipRad) * 180) / Math.PI;
    const initSlipGate = estRearGrip > 1.02 ? 22 : 16;

    if (speedKmh > targetSpeedKmh + 2.5 && speedKmh > 34) {
      const canLeftFootBrake =
        estRearGrip > 0.92 && absSlipDeg >= 16 && tune.brakeBiasPct >= 60;
      throttle = canLeftFootBrake ? 0.56 : 0.06;
      brake =
        absSlipDeg < 28 || speedKmh > targetSpeedKmh + 8
          ? speedKmh > targetSpeedKmh + 10
            ? 0.72
            : 0.48
          : 0.3;
    } else if (edgeRatio > 0.76 || nearWall) {
      throttle = speedKmh > targetSpeedKmh - 2 ? 0.24 : 0.56;
    } else if (
      (curvMag > 0.0011 || upcomingPeakCurv > 0.0026) &&
      edgeRatio < 0.68 &&
      speedKmh <= targetSpeedKmh + 6 &&
      absSlipDeg < targetSlipDeg - 2 &&
      Math.abs(travelErr) < 0.78
    ) {
      if (
        (curvMag > 0.002 ||
          (estRearGrip > 1.0 && upcomingPeakCurv > 0.0036)) &&
        absSlipDeg < initSlipGate &&
        Math.abs(car.angularVel) < 0.65 &&
        speedKmh > 26
      ) {
        handbrake = true;
        throttle = 0.56;
      } else {
        clutchKick = true;
        throttle = 0.96;
      }
    } else if (speedKmh < targetSpeedKmh - 3) {
      throttle = 0.95;
    } else {
      throttle = isCorner ? 0.9 : 0.76;
    }
  }

  // Keep commanded steering within peak front-tire grip band (~21 deg around velocity vector)
  // so turn-in bites sharply instead of plowing at 64 deg lock, while still hitting physical lock limits in deep slides.
  desiredSteerRad = clamp(
    desiredSteerRad,
    -currentSlipRad - 0.38,
    -currentSlipRad + 0.38
  );
  desiredSteerRad = clamp(desiredSteerRad, -lockRad, lockRad);

  // Fast realistic driver hand speed (11.5 norm/s); mechanical steering lag still limits bad racks
  const rawSteerNorm = clamp(desiredSteerRad / lockRad, -1, 1);
  const driverHandRate = 11.5;
  car.aiSteerCmd += clamp(
    rawSteerNorm - car.aiSteerCmd,
    -driverHandRate * safeDt,
    driverHandRate * safeDt
  );

  return {
    throttle,
    brake,
    steer: car.aiSteerCmd,
    handbrake,
    clutchKick,
  };
}

export function stepDriftPhysics(
  car: CarSimState,
  rawInput: InputControls,
  autopilot: boolean,
  chassis: ChassisPreset,
  tune: DriftTuneParams,
  track: TrackDefinition,
  dt: number
): LiveHudState {
  const safeDt = Math.min(dt, 0.04);
  car.simTime += safeDt;
  if (car.faultTimer > 0) {
    car.faultTimer = Math.max(0, car.faultTimer - safeDt);
    if (car.faultTimer === 0) car.faultStatus = null;
  }
  if (car.recoveryCooldown > 0) {
    car.recoveryCooldown = Math.max(0, car.recoveryCooldown - safeDt);
  }

  // Brief spinout recovery for AI demo so bad setups visibly spin out, void unbanked score, then resume
  if (car.spinRecoveryTimer > 0) {
    car.spinRecoveryTimer -= safeDt;
    car.vx *= Math.pow(0.25, safeDt);
    car.vy *= Math.pow(0.25, safeDt);
    car.angularVel *= Math.pow(0.15, safeDt);
    car.x += car.vx * safeDt;
    car.y += car.vy * safeDt;
    car.heading = normalizeAngle(car.heading + car.angularVel * safeDt);
    if (car.spinRecoveryTimer <= 0 && autopilot && car.splineSamples.length > 0) {
      const s = car.splineSamples[car.waypointIdx % car.splineSamples.length];
      car.x = s.x;
      car.y = s.y;
      car.heading = Math.atan2(s.ty, s.tx);
      car.vx = Math.cos(car.heading) * 125;
      car.vy = Math.sin(car.heading) * 125;
      car.angularVel = 0;
      car.steerAngle = 0;
      car.aiSteerCmd = 0;
      car.prevRearLeft = null;
      car.prevRearRight = null;
      car.recoveryCooldown = 1.4;
    }
    const speedKmh = Math.hypot(car.vx, car.vy) * 0.46;
    return {
      speedKmh: Math.round(speedKmh),
      rpm: 2400,
      gear: 2,
      slipAngleDeg: Number(car.lastSlipAngleDeg.toFixed(1)),
      lateralG: 0,
      boostPsi: 0,
      throttle: 0,
      brake: 0,
      handbrake: false,
      isDrifting: false,
      currentDriftPoints: 0,
      comboMultiplier: 1.0,
      totalScore: car.totalScore,
      bestDriftRun: car.bestDriftRun,
      clipZoneActive: null,
      faultStatus: car.faultStatus,
    };
  }

  const input = autopilot
    ? computeAutopilotInput(car, tune, track, safeDt)
    : rawInput;

  const lockRad = (tune.steeringLockDeg * Math.PI) / 180;
  const cosH = Math.cos(car.heading);
  const sinH = Math.sin(car.heading);

  const forwardVel = car.vx * cosH + car.vy * sinH;
  const lateralVel = -car.vx * sinH + car.vy * cosH;
  const speedPx = Math.hypot(car.vx, car.vy);
  const speedKmh = speedPx * 0.46;

  // Body slip angle (velHeading - car.heading)
  const velHeading = speedPx > 16 ? Math.atan2(car.vy, car.vx) : car.heading;
  const bodySlipRad =
    speedPx > 16 ? normalizeAngle(velHeading - car.heading) : 0;

  // Caster Self-Aligning Torque (SAT), FFB Wheel Calibration, Rack Damping & DD Chatter
  const casterAssist = clamp((tune.frontCasterDeg - 3.0) / 5.5, 0.22, 1.25);
  const ffbSatGain = clamp(tune.ffbStrengthPct / 100, 0.6, 1.6);
  const ffbDampPenalty = clamp(
    1 - Math.max(0, tune.ffbDampingPct - 20) * 0.012,
    0.48,
    1.04
  );
  const wheelRatioFactor = clamp(
    900 / Math.max(540, tune.steeringWheelDeg),
    0.82,
    1.35
  );
  const rigidityFactor = clamp(
    0.85 + (tune.chassisRigidity - 1.0) * 0.26,
    0.78,
    1.12
  );
  const satTarget = clamp(bodySlipRad * 1.02, -lockRad, lockRad);
  const steerRate =
    (4.6 + casterAssist * 3.1) *
    tune.steeringSpeed *
    wheelRatioFactor *
    ffbDampPenalty *
    rigidityFactor;

  const ddChatterAmp =
    clamp((tune.ffbStrengthPct - 132) / 28, 0, 1) *
    clamp((8 - tune.ffbDampingPct) / 8, 0, 1);
  const chatterOffset =
    ddChatterAmp > 0 && speedKmh > 22
      ? Math.sin(car.simTime * 27) * ddChatterAmp * 0.34 * lockRad
      : 0;

  if (Math.abs(input.steer) > 0.04) {
    const targetSteer = clamp(
      input.steer * lockRad + chatterOffset,
      -lockRad,
      lockRad
    );
    const steerDiff = targetSteer - car.steerAngle;
    car.steerAngle += clamp(steerDiff, -steerRate * safeDt, steerRate * safeDt);
  } else {
    const satPull =
      (satTarget + chatterOffset - car.steerAngle) *
      (9.5 * (tune.frontCasterDeg / 7.5) * ffbSatGain * ffbDampPenalty);
    car.steerAngle += clamp(
      satPull * safeDt,
      -steerRate * safeDt,
      steerRate * safeDt
    );
  }

  // Powertrain & Turbo Spool
  const boostFactor = 1 + (tune.turboBoostPsi / 24) * 0.62;
  const effectiveHp = chassis.basePowerHp * boostFactor;
  const massFactor = 1260 / chassis.massKg;
  const finalDriveMult = tune.finalDriveRatio / 3.9;

  const gearThresholds = [0, 52, 92, 138, 185, 235];
  let gear = 1;
  for (let i = 1; i < gearThresholds.length; i++) {
    if (speedKmh > gearThresholds[i]) gear = i + 1;
  }
  if (forwardVel < -10) gear = 0;

  const gearRatios = [3.2, 2.8, 1.95, 1.45, 1.15, 0.94, 0.78];
  const currentRatio = gearRatios[gear] || 1.0;

  const targetBoost =
    input.throttle > 0.25 && car.rpm > 2500
      ? tune.turboBoostPsi *
        input.throttle *
        clamp((car.rpm - 2100) / 3000, 0.2, 1)
      : 0;
  car.boostPsi += (targetBoost - car.boostPsi) * Math.min(1, safeDt * 6.0);

  const wheelSpinBonus =
    input.throttle *
    (tune.lsdLockPct / 100) *
    (input.clutchKick ? 2400 : 1400);
  const baseWheelRpm =
    Math.abs(speedKmh) * 32 * currentRatio * finalDriveMult + 1150;
  const targetRpm = clamp(
    baseWheelRpm + wheelSpinBonus,
    1050,
    chassis.redlineRpm
  );
  car.rpm += (targetRpm - car.rpm) * Math.min(1, safeDt * 11);

  // Rear Tire & Suspension Parameters
  const {
    tireWidthFactor,
    tirePsiFactor,
    rearCamberFactor,
    rearToeStability,
    rearWeightGripBias,
    arbRearFactor,
  } = computeRearTireFactors(tune);

  const springRatio = tune.frontSpringKn / Math.max(1, tune.rearSpringKn);
  const rearSquatDriveBonus = clamp(
    1 + (54 - tune.rearSpringKn) * 0.0052,
    0.74,
    1.14
  );
  const antiSquatDriveBonus =
    tune.antiSquatPct <= 74
      ? clamp(1 + (tune.antiSquatPct - 45) * 0.0032, 0.9, 1.12)
      : clamp(1.09 - (tune.antiSquatPct - 74) * 0.012, 0.84, 1.09);
  const rearWeightDriveFactor = clamp(
    1 + (51.5 - tune.frontWeightPct) * 0.018,
    0.88,
    1.1
  );
  const springInversionPenalty = Math.max(0, 1.22 - springRatio);
  const frontTurnInCrispness = clamp(
    0.88 +
      (tune.frontSpringKn - 42) * 0.004 +
      (tune.chassisRigidity - 1.0) * 0.1 -
      springInversionPenalty * 0.34,
    0.58,
    1.18
  );

  let minSplineDist = 0;
  if (car.splineSamples.length > 0) {
    const s = car.splineSamples[car.waypointIdx % car.splineSamples.length];
    minSplineDist = Math.hypot(s.x - car.x, s.y - car.y);
  }
  const onTarmac = minSplineDist <= track.roadWidth * 0.66;
  const farOffTrack = minSplineDist > track.roadWidth * 0.98;
  const surfaceMult = onTarmac
    ? track.surfaceGripMult
    : track.surfaceGripMult * 0.78;

  // Front Geometry: Camber + Caster + KPI Jacking + Front Toe-Out + Ackermann Scrub
  const lockFrac = clamp(
    Math.abs(car.steerAngle) / Math.max(0.2, lockRad),
    0,
    1
  );
  const optimalFrontCamber = -5.1;
  const frontCamberBite =
    1 - Math.abs(tune.frontCamberDeg - optimalFrontCamber) * 0.028;
  const ackermannBite =
    1 + clamp((10 - tune.ackermannPct) / 100, -0.36, 0.1);
  const casterBite = clamp(1 + (tune.frontCasterDeg - 6.0) * 0.024, 0.86, 1.1);
  const kpiPenalty = clamp(
    1 - Math.max(0, tune.kpiDeg - 5.8) * lockFrac * 0.048,
    0.55,
    1.0
  );
  const frontToeBite = 1 + clamp(-tune.frontToeDeg, -0.3, 0.5) * 0.12;
  const frontWeightGripBias = clamp(
    1 + (tune.frontWeightPct - 51) * 0.012,
    0.94,
    1.08
  );
  const arbFrontFactor = 1 + ((50 - tune.rearArbBiasPct) / 100) * 0.18;

  const outerAckermanDegLoss = Math.max(0, tune.ackermannPct) * 0.12;
  const effectiveSteerAngle =
    car.steerAngle *
    clamp(
      (tune.steeringLockDeg - outerAckermanDegLoss) /
        Math.max(30, tune.steeringLockDeg),
      0.7,
      1.0
    );

  // Genuine Power-to-Tire-Grip Balance
  const baseRearGrip =
    tune.rearTireGrip *
    tireWidthFactor *
    tirePsiFactor *
    surfaceMult *
    rearCamberFactor *
    rearToeStability *
    rearWeightGripBias *
    arbRearFactor;

  const wheelForceIndex =
    (effectiveHp / chassis.massKg) * (0.72 + finalDriveMult * 0.28);
  const torqueRatio = wheelForceIndex / Math.max(0.24, 0.355 * baseRearGrip);

  // Longitudinal forces & scrub drag: forward drift drive requires real tire bite!
  const lsdFrac = tune.lsdLockPct / 100;
  const openDiffPenalty = clamp((0.72 - lsdFrac) / 0.72, 0, 1);
  const openDiffDriveLoss = 1 - openDiffPenalty * 0.42;
  const tireLongBite = clamp(baseRearGrip / 0.94, 0.4, 1.18);
  const blowoutSpinLoss =
    torqueRatio > 1.8 && baseRearGrip < 0.72
      ? clamp(1 - (torqueRatio - 1.8) * 0.28, 0.36, 1.0)
      : 1.0;

  const frontScrubDrag =
    (Math.max(0, tune.ackermannPct) / 100) * lockFrac * 36 +
    Math.max(0, tune.kpiDeg - 6.2) * lockFrac * 4.5;

  const driveAccel =
    input.throttle *
    (effectiveHp * 0.24) *
    massFactor *
    rearSquatDriveBonus *
    antiSquatDriveBonus *
    rearWeightDriveFactor *
    tireLongBite *
    blowoutSpinLoss *
    openDiffDriveLoss *
    (0.75 + finalDriveMult * 0.25);

  const brakeForce = input.brake * 165;
  const handbrakeDrag = input.handbrake ? 22 : 0;

  let longAccel = 0;
  if (input.throttle > 0) {
    longAccel += driveAccel;
  }
  if (input.brake > 0) {
    if (forwardVel > 16) {
      longAccel -= brakeForce;
    } else {
      longAccel -= input.brake * 65;
    }
  }
  longAccel -=
    forwardVel * (onTarmac ? 0.26 : 0.54) +
    Math.sign(forwardVel) * (handbrakeDrag + frontScrubDrag);

  // Axle Slip Angles
  const lf = chassis.bodyLengthPx * 0.34;
  const lr = chassis.bodyLengthPx * 0.34;
  const absFwd = Math.max(24, Math.abs(forwardVel));
  const fwdSign = forwardVel >= -5 ? 1 : -1;

  const frontAlpha =
    Math.atan2(lateralVel + car.angularVel * lf, absFwd) -
    effectiveSteerAngle * fwdSign;
  const rearAlpha = Math.atan2(lateralVel - car.angularVel * lr, absFwd);

  // Rear Brake Bias Lockup Penalty
  const rearLockupIntensity =
    input.brake > 0.08
      ? clamp((60 - tune.brakeBiasPct) * input.brake * 0.115, 0, 0.85)
      : 0;
  const rearBrakeBiasPenalty = 1 - rearLockupIntensity;

  // Throttle wheelspin authority vs rear grip:
  // Healthy torque + LSD lets rear tires hold steady kinetic slip under throttle without hooking straight
  const throttleSpinAuthority =
    clamp((torqueRatio - 0.64) / 0.4, 0.08, 1.45) *
    (1 - openDiffPenalty * 0.82);

  const kineticSpinHold =
    Math.abs(rearAlpha) > 0.2 &&
    input.throttle > 0.45 &&
    torqueRatio >= 0.78 &&
    openDiffPenalty < 0.45
      ? 1 - 0.24 * input.throttle
      : 1.0;

  const lsdSlipFactor = clamp(
    (1 -
      input.throttle *
        0.46 *
        throttleSpinAuthority *
        clamp(1 + car.boostPsi / 28, 1, 1.24)) *
      kineticSpinHold,
    0.3,
    1.0
  );

  // Open diff chatter: outside loaded tire hooks and snaps car straight under throttle
  const openDiffHookBoost =
    openDiffPenalty > 0.2 && Math.abs(rearAlpha) > 0.12 && input.throttle > 0.25
      ? 1 + openDiffPenalty * (0.68 + 0.18 * Math.sin(car.simTime * 11))
      : 1.0;

  const handbrakeGrip = input.handbrake
    ? torqueRatio < 0.76
      ? 0.56
      : 0.32
    : 1.0;
  const clutchGrip = input.clutchKick
    ? torqueRatio < 0.76 || openDiffPenalty > 0.45
      ? 0.74
      : 0.34
    : 1.0;

  const muFront =
    1.18 *
    surfaceMult *
    frontCamberBite *
    ackermannBite *
    casterBite *
    kpiPenalty *
    frontToeBite *
    frontWeightGripBias *
    frontTurnInCrispness *
    arbFrontFactor;

  const muRear =
    baseRearGrip *
    lsdSlipFactor *
    openDiffHookBoost *
    rearBrakeBiasPenalty *
    handbrakeGrip *
    clutchGrip;

  // Realistic Pacejka with front tire stall only well past peak turn-in (~21 deg)
  const lateralGScale = 76;
  const frontAlphaAbs = Math.abs(frontAlpha);
  const frontStallFactor = clamp(
    1 - Math.max(0, frontAlphaAbs - 0.37) * 0.9,
    0.34,
    1.0
  );
  const frontLatForce =
    -muFront *
    lateralGScale *
    Math.sin(1.62 * Math.atan(4.9 * frontAlpha)) *
    frontStallFactor;

  const rearLatForce =
    -muRear * lateralGScale * Math.sin(1.48 * Math.atan(4.5 * rearAlpha));

  const yawWeightFactor = clamp(0.72 + massFactor * 0.28, 0.78, 1.08);
  const totalLatAccel = frontLatForce + rearLatForce;

  // Destabilizing yaw moments from genuine mechanical flaws
  const absBodySlipDeg = (Math.abs(bodySlipRad) * 180) / Math.PI;
  const slipDir = Math.sign(-bodySlipRad || car.angularVel || 1);
  const latVelNorm = clamp(Math.abs(lateralVel) / 65, 0, 1.6);

  const springSnapYaw =
    springInversionPenalty *
    latVelNorm *
    4.2 *
    Math.sign(car.angularVel || slipDir);
  const arbSnapYaw =
    (Math.max(0, tune.rearArbBiasPct - 55) / 25) *
    latVelNorm *
    1.95 *
    Math.sign(car.angularVel || slipDir);
  const rearToeOutYaw =
    Math.max(0, -tune.rearToeDeg) * latVelNorm * 9.5 * slipDir;
  const rearLockupYaw =
    rearLockupIntensity *
    clamp(speedKmh / 28, 0, 2.0) *
    28.0 *
    (Math.abs(bodySlipRad) > 0.04 ? slipDir : Math.sign(car.steerAngle || 1));

  // Excess negative rear camber (-3.0+ deg) rides the inner shoulder and snaps on load
  const camberSnapYaw =
    tune.rearCamberDeg < -2.8
      ? Math.abs(tune.rearCamberDeg + 2.8) *
        0.95 *
        latVelNorm *
        Math.sign(car.angularVel || slipDir)
      : 0;

  // Lock-stop spin torque: once drift angle pushes into the front steering bump stop
  // (accounting for ~3 deg front slip angle reserve), countersteer saturates!
  const effectiveLockCeilingDeg =
    tune.steeringLockDeg - outerAckermanDegLoss - 3.2;
  const lockExceededDeg = Math.max(
    0,
    absBodySlipDeg - effectiveLockCeilingDeg
  );
  const lockStopYawTorque =
    lockExceededDeg > 0 && speedKmh > 25
      ? lockExceededDeg * 0.55 * slipDir
      : 0;

  // Ice blowout snap: massive torque excess on slick over-inflated tires over-rotates on throttle
  const blowoutSnapYaw =
    torqueRatio > 1.75 && baseRearGrip < 0.7 && input.throttle > 0.45 && absBodySlipDeg > 16
      ? clamp((torqueRatio - 1.75) * 2.1, 0, 3.4) *
        input.throttle *
        slipDir
      : 0;

  const baseYawTorque =
    (frontLatForce * lf * Math.cos(effectiveSteerAngle * 0.55) -
      rearLatForce * lr) *
    0.0042 *
    yawWeightFactor *
    rigidityFactor;

  const yawTorque =
    baseYawTorque +
    springSnapYaw +
    arbSnapYaw +
    rearToeOutYaw +
    rearLockupYaw +
    camberSnapYaw +
    lockStopYawTorque +
    blowoutSnapYaw;

  const worldAx = longAccel * cosH - totalLatAccel * sinH;
  const worldAy = longAccel * sinH + totalLatAccel * cosH;
  car.vx += worldAx * safeDt;
  car.vy += worldAy * safeDt;

  if (input.throttle < 0.22 && absBodySlipDeg > 24 && !input.handbrake) {
    const scrub = clamp((absBodySlipDeg - 24) / 45, 0, 1) * 0.72 * safeDt;
    car.vx *= 1 - scrub;
    car.vy *= 1 - scrub;
  }

  if (speedPx < 20 && input.throttle === 0) {
    car.vx *= 0.88;
    car.vy *= 0.88;
  }

  car.angularVel += yawTorque * safeDt;
  car.angularVel *= Math.pow(0.28, safeDt);
  car.angularVel = clamp(car.angularVel, -3.6, 3.6);
  car.heading = normalizeAngle(car.heading + car.angularVel * safeDt);

  const cosNew = Math.cos(car.heading);
  const sinNew = Math.sin(car.heading);

  car.x += car.vx * safeDt;
  car.y += car.vy * safeDt;

  // World perimeter wall impact voids active drift run
  const margin = 34;
  let hitWall = false;
  if (car.x < margin) {
    car.x = margin;
    car.vx = Math.abs(car.vx) * 0.42;
    hitWall = true;
  } else if (car.x > track.worldWidth - margin) {
    car.x = track.worldWidth - margin;
    car.vx = -Math.abs(car.vx) * 0.42;
    hitWall = true;
  }
  if (car.y < margin) {
    car.y = margin;
    car.vy = Math.abs(car.vy) * 0.42;
    hitWall = true;
  } else if (car.y > track.worldHeight - margin) {
    car.y = track.worldHeight - margin;
    car.vy = -Math.abs(car.vy) * 0.42;
    hitWall = true;
  }

  const finalVelHeading = Math.atan2(car.vy, car.vx);
  const slipRad =
    speedPx > 22 ? normalizeAngle(finalVelHeading - car.heading) : 0;
  const slipAngleDeg = Math.abs((slipRad * 180) / Math.PI);
  const lateralG = Number((Math.abs(totalLatAccel) / 76.5).toFixed(2));

  car.lastSlipAngleDeg = slipAngleDeg;
  car.lastLateralG = lateralG;

  // Clipping zone detection
  let activeClip: string | null = null;
  for (const zone of track.clippingZones) {
    const distToZone = Math.hypot(car.x - zone.x, car.y - zone.y);
    if (distToZone <= zone.radius + 16) {
      activeClip = zone.label;
      break;
    }
  }
  car.clipZoneActive = activeClip;

  // Spinout / Wall Impact / Off-track / Bogging fault detection
  const spunOut =
    car.recoveryCooldown <= 0 &&
    ((slipAngleDeg > 74 && speedKmh > 20) ||
      (slipAngleDeg > tune.steeringLockDeg + 7 && speedKmh > 26) ||
      (Math.abs(car.angularVel) > 2.45 && slipAngleDeg > 60));

  if (spunOut || (hitWall && speedKmh > 25 && car.recoveryCooldown <= 0)) {
    car.currentDriftPoints = 0;
    car.comboMultiplier = 1.0;
    car.driftDropTimer = 0;
    car.faultStatus = spunOut ? 'SPINOUT' : 'OFF_TRACK';
    car.faultTimer = 1.9;
    car.spinRecoveryTimer = autopilot ? 0.55 : 0;
    if (spunOut) car.spinoutCount += 1;
    else car.offTrackCount += 1;
  } else if (farOffTrack && car.recoveryCooldown <= 0) {
    if (car.currentDriftPoints > 0) {
      car.currentDriftPoints = 0;
      car.comboMultiplier = 1.0;
      car.faultStatus = 'OFF_TRACK';
      car.faultTimer = 1.4;
      car.offTrackCount += 1;
    }
  }

  let inCornerSample = false;
  if (car.splineSamples.length > 0) {
    const s = car.splineSamples[car.waypointIdx % car.splineSamples.length];
    inCornerSample = Math.abs(s.curvature) > 0.0022;
  }
  if (
    inCornerSample &&
    input.throttle > 0.65 &&
    slipAngleDeg < 11 &&
    speedKmh > 28 &&
    !spunOut
  ) {
    car.bogStreakSec += safeDt;
    if (car.bogStreakSec > 0.85) {
      car.bogStreakSec = 0;
      car.bogCount += 1;
      if (!car.faultStatus) {
        car.faultStatus = 'BOGGED';
        car.faultTimer = 1.4;
      }
    }
  } else {
    car.bogStreakSec = Math.max(0, car.bogStreakSec - safeDt * 1.5);
  }

  // Drift scoring engine (tarmac bounds, valid slip window, speed, lateral G grip & smoothness)
  const maxValidSlip = Math.min(70, tune.steeringLockDeg + 3);
  const minDriftSpeedKmh = track.roadWidth < 100 ? 25 : 30;
  const isDrifting =
    onTarmac &&
    !spunOut &&
    !hitWall &&
    speedKmh >= minDriftSpeedKmh &&
    slipAngleDeg >= 14 &&
    slipAngleDeg <= maxValidSlip;

  if (isDrifting) {
    car.driftDropTimer = 0.95;
    const clipMult = activeClip ? 1.6 : 1.0;
    const angleWeight =
      slipAngleDeg <= 48
        ? clamp((slipAngleDeg - 8) / 30, 0.25, 1.45)
        : clamp(1.45 - (slipAngleDeg - 48) * 0.035, 0.65, 1.45);
    const speedWeight = clamp(Math.pow(speedKmh / 58, 1.65), 0.18, 2.45);
    const gripGWeight = clamp(Math.pow(clamp(lateralG / 0.76, 0.25, 1.45), 1.3), 0.24, 1.45);
    const smoothnessMult = clamp(
      1.08 - Math.abs(car.angularVel) * 0.18,
      0.62,
      1.08
    );

    car.currentDriftPoints +=
      angleWeight *
      speedWeight *
      gripGWeight *
      smoothnessMult *
      clipMult *
      150 *
      safeDt;
    car.comboMultiplier = clamp(
      car.comboMultiplier + safeDt * 0.24 * clipMult,
      1.0,
      5.0
    );
  } else {
    car.driftDropTimer -= safeDt;
    if (car.driftDropTimer <= 0 && car.currentDriftPoints > 0) {
      const banked = Math.round(car.currentDriftPoints * car.comboMultiplier);
      car.totalScore += banked;
      if (banked > car.bestDriftRun) {
        car.bestDriftRun = banked;
      }
      car.currentDriftPoints = 0;
      car.comboMultiplier = 1.0;
    }
  }

  // Rear tire positions for skidmarks & smoke
  const rearOffset = -chassis.bodyLengthPx * 0.36;
  const halfTrack = chassis.bodyWidthPx * 0.42;
  const rl = {
    x: car.x + cosNew * rearOffset - sinNew * -halfTrack,
    y: car.y + sinNew * rearOffset + cosNew * -halfTrack,
  };
  const rr = {
    x: car.x + cosNew * rearOffset - sinNew * halfTrack,
    y: car.y + sinNew * rearOffset + cosNew * halfTrack,
  };

  const smoking =
    isDrifting ||
    input.handbrake ||
    (input.throttle > 0.7 && speedKmh < 45) ||
    input.clutchKick;

  if (smoking && car.prevRearLeft && car.prevRearRight) {
    const intensity = clamp(slipAngleDeg / 42, 0.28, 0.88);
    car.skidmarks.push(
      {
        x1: car.prevRearLeft.x,
        y1: car.prevRearLeft.y,
        x2: rl.x,
        y2: rl.y,
        alpha: intensity * 0.56,
      },
      {
        x1: car.prevRearRight.x,
        y1: car.prevRearRight.y,
        x2: rr.x,
        y2: rr.y,
        alpha: intensity * 0.56,
      }
    );
    if (car.skidmarks.length > 560) {
      car.skidmarks.splice(0, car.skidmarks.length - 560);
    }

    if (Math.random() < 0.78) {
      const wheel = Math.random() < 0.5 ? rl : rr;
      car.smoke.push({
        x: wheel.x + (Math.random() - 0.5) * 4,
        y: wheel.y + (Math.random() - 0.5) * 4,
        vx: -car.vx * 0.08 + (Math.random() - 0.5) * 20,
        vy: -car.vy * 0.08 + (Math.random() - 0.5) * 20,
        radius: 4 + Math.random() * 5.5,
        alpha: 0.38,
        life: 0,
        maxLife: 0.8 + Math.random() * 0.45,
      });
    }
  }

  car.prevRearLeft = rl;
  car.prevRearRight = rr;

  for (let i = car.smoke.length - 1; i >= 0; i--) {
    const p = car.smoke[i];
    p.life += safeDt;
    if (p.life >= p.maxLife) {
      car.smoke.splice(i, 1);
      continue;
    }
    p.x += p.vx * safeDt;
    p.y += p.vy * safeDt;
    p.radius += 16 * safeDt;
    p.alpha = (1 - p.life / p.maxLife) * 0.36;
  }

  return {
    speedKmh: Math.round(speedKmh),
    rpm: Math.round(car.rpm),
    gear,
    slipAngleDeg: Number(slipAngleDeg.toFixed(1)),
    lateralG,
    boostPsi: Number(car.boostPsi.toFixed(1)),
    throttle: Number(input.throttle.toFixed(2)),
    brake: Number(input.brake.toFixed(2)),
    handbrake: input.handbrake,
    isDrifting,
    currentDriftPoints: Math.round(car.currentDriftPoints),
    comboMultiplier: Number(car.comboMultiplier.toFixed(1)),
    totalScore: car.totalScore,
    bestDriftRun: car.bestDriftRun,
    clipZoneActive: activeClip,
    faultStatus: car.faultStatus,
  };
}
