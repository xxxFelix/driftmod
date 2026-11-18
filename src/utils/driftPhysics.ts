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

export interface CarSimState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  angularVel: number;
  steerAngle: number;
  rpm: number;
  gear: number;
  boostPsi: number;
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

  return {
    x: start.x,
    y: start.y,
    heading,
    vx: Math.cos(heading) * 145,
    vy: Math.sin(heading) * 145,
    angularVel: 0,
    steerAngle: 0,
    rpm: 3400,
    gear: 2,
    boostPsi: 0,
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
  };
}

function computeAutopilotInput(
  car: CarSimState,
  tune: DriftTuneParams,
  track: TrackDefinition
): InputControls {
  const samples = car.splineSamples;
  const n = samples.length;

  // Search strictly forward along the closed track spline to prevent figure-8 snaps or backward donuts
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

  // Look ahead along the track spline (scales with speed)
  const lookAheadSteps = Math.round(clamp(7 + speedKmh * 0.05, 7, 12));
  const targetSample = samples[(closestIdx + lookAheadSteps) % n];

  // Sample upcoming corner curvature (extended 2..26 braking lookahead for tight hairpins)
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

  const lookaheadAngle = Math.atan2(
    targetSample.y - car.y,
    targetSample.x - car.x
  );

  // Cross-track correction toward centerline
  const nearest = samples[closestIdx];
  const crossVecX = car.x - nearest.x;
  const crossVecY = car.y - nearest.y;
  const crossErr = crossVecX * -nearest.ty + crossVecY * nearest.tx;
  const absCross = Math.abs(crossErr);
  const edgeRatio = clamp(absCross / (track.roadWidth * 0.48), 0, 1);

  const velAngle = speed > 20 ? Math.atan2(car.vy, car.vx) : car.heading;
  const desiredTravelAngle = normalizeAngle(
    lookaheadAngle - clamp(crossErr / (track.roadWidth * 0.28), -1.0, 1.0)
  );
  const travelErr = normalizeAngle(desiredTravelAngle - velAngle);

  // Cornering drift target: 24-36 deg slides in corners, gentle 8-14 deg link transitions
  const lockCapDeg = clamp(tune.steeringLockDeg * 0.58, 28, 36);
  const maxDriftDeg =
    upcomingPeakCurv > 0.011
      ? clamp(33 - upcomingPeakCurv * 400, 22, lockCapDeg)
      : lockCapDeg;

  const isCorner = curvMag > 0.0013 || upcomingPeakCurv > 0.0028;
  const rawSlipDeg = isCorner
    ? clamp(curvMag * 7000 + upcomingPeakCurv * 1500, 26, maxDriftDeg)
    : Math.abs(travelErr) > 0.08
      ? 16
      : 9;

  // Taper drift angle near road edge so car hooks cleanly back inside tarmac
  const baseSlipDeg = rawSlipDeg * (1 - Math.max(0, edgeRatio - 0.38) * 0.6);
  const turnDir =
    curvMag > 0.0012 ? Math.sign(signedCurv) : Math.sign(travelErr || 1);

  const targetSlipRad = clamp(
    ((turnDir * baseSlipDeg) * Math.PI) / 180,
    -(maxDriftDeg * Math.PI) / 180,
    (maxDriftDeg * Math.PI) / 180
  );

  // Anchor desired car heading directly to track trajectory + target slip (prevents 360 donuts)
  const desiredHeading = normalizeAngle(desiredTravelAngle + targetSlipRad);
  const headingErr = normalizeAngle(desiredHeading - car.heading);

  // Current slip (+ = nose clockwise of velocity vector)
  const currentSlipRad = normalizeAngle(car.heading - velAngle);
  const absSlipDeg = (Math.abs(currentSlipRad) * 180) / Math.PI;
  const lockRad = (tune.steeringLockDeg * Math.PI) / 180;

  // Rear mechanical grip estimate so AI matches corner speed & initiation energy to tire setup
  const psiDelta = tune.rearTirePsi - 18;
  const estPsi = psiDelta >= 0 ? 1.03 - psiDelta * 0.0082 : 1.03 + psiDelta * 0.012;
  const estRearGrip = clamp(
    tune.rearTireGrip *
      clamp(0.88 + ((tune.rearTireWidthMm - 235) / 80) * 0.16, 0.85, 1.08) *
      clamp(estPsi, 0.82, 1.03) *
      (1 + clamp(tune.rearToeDeg, -0.2, 0.7) * 0.14) *
      (1 - ((tune.rearArbBiasPct - 42) / 100) * 0.3),
    0.68,
    1.28
  );

  // Physics-derived corner speed limit: v = sqrt(a_lat * R) matched to track & chassis grip
  const nearWall =
    car.x < 70 ||
    car.x > track.worldWidth - 70 ||
    car.y < 70 ||
    car.y > track.worldHeight - 70;
  const minCornerRadiusM = 1 / Math.max(0.0028, brakePeakCurv) / 7.8;
  const isHairpin = brakePeakCurv >= 0.011;
  const gripSpeedBonus = clamp((estRearGrip - 0.92) * 20, -2, 8);
  const latGripMs2 = (isHairpin ? 9.1 : 11.1) * track.surfaceGripMult;
  const physCornerKmh = Math.sqrt(latGripMs2 * minCornerRadiusM) * 3.6 + gripSpeedBonus;
  const targetSpeedKmh = clamp(
    physCornerKmh * (1 - edgeRatio * 0.25) - (nearWall ? 12 : 0),
    36,
    90
  );
  let throttle = 0.86;
  let brake = 0;
  let handbrake = false;
  let clutchKick = false;

  let desiredSteerRad: number;
  const overRotating =
    absSlipDeg > maxDriftDeg + 4 ||
    (absSlipDeg > 32 &&
      Math.sign(car.angularVel) === Math.sign(currentSlipRad) &&
      Math.abs(car.angularVel) > 0.86);

  if (overRotating) {
    desiredSteerRad = clamp(
      -currentSlipRad * 1.2 +
        clamp(travelErr, -0.45, 0.45) * 0.5 -
        car.angularVel * 0.44,
      -lockRad,
      lockRad
    );
    throttle = 0.05;
  } else {
    desiredSteerRad = clamp(
      -currentSlipRad * 0.7 +
        headingErr * 1.92 +
        clamp(travelErr, -0.65, 0.65) * 0.55 -
        car.angularVel * 0.26,
      -lockRad,
      lockRad
    );

    const targetSlipDeg = (Math.abs(targetSlipRad) * 180) / Math.PI;
    const initSlipGate = estRearGrip > 1.02 ? 20 : 11;
    if (speedKmh > targetSpeedKmh + 6 && speedKmh > 38) {
      // Left-foot brake while holding throttle on sticky FD setups so rear tires don't hook straight
      const canLeftFootBrake =
        estRearGrip > 0.96 && tune.brakeBiasPct >= 63 && absSlipDeg >= 12;
      throttle = canLeftFootBrake ? 0.62 : 0.08;
      brake = absSlipDeg < 22 ? (speedKmh > targetSpeedKmh + 14 ? 0.62 : 0.36) : 0.14;
    } else if (edgeRatio > 0.76 || nearWall) {
      throttle = speedKmh > targetSpeedKmh - 2 ? 0.24 : 0.56;
    } else if (
      (curvMag > 0.0012 || upcomingPeakCurv > 0.003) &&
      edgeRatio < 0.65 &&
      speedKmh <= targetSpeedKmh + 6 &&
      absSlipDeg < targetSlipDeg - 2 &&
      Math.abs(travelErr) < 0.72
    ) {
      if (
        (curvMag > 0.0024 || (estRearGrip > 1.02 && upcomingPeakCurv > 0.004)) &&
        absSlipDeg < initSlipGate &&
        Math.abs(car.angularVel) < 0.68 &&
        speedKmh > 40
      ) {
        handbrake = true;
        throttle = 0.54;
      } else {
        clutchKick = true;
        throttle = 0.96;
      }
    } else if (speedKmh < targetSpeedKmh - 4) {
      throttle = 0.94;
    } else {
      throttle = isCorner ? 0.88 : 0.74;
    }
  }

  return {
    throttle,
    brake,
    steer: clamp(desiredSteerRad / lockRad, -1, 1),
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
  const input = autopilot
    ? computeAutopilotInput(car, tune, track)
    : rawInput;

  const lockRad = (tune.steeringLockDeg * Math.PI) / 180;
  const cosH = Math.cos(car.heading);
  const sinH = Math.sin(car.heading);

  const forwardVel = car.vx * cosH + car.vy * sinH;
  const lateralVel = -car.vx * sinH + car.vy * cosH;
  const speedPx = Math.hypot(car.vx, car.vy);
  const speedKmh = speedPx * 0.46;

  // Body slip angle (velHeading - car.heading): negative when nose points clockwise of travel
  const velHeading = speedPx > 16 ? Math.atan2(car.vy, car.vx) : car.heading;
  const bodySlipRad =
    speedPx > 16 ? normalizeAngle(velHeading - car.heading) : 0;

  // Caster Self-Aligning Torque (SAT), FFB Wheel Calibration & Chassis Rigidity rack response
  const casterFactor = tune.frontCasterDeg / 7.5;
  const ffbSatGain = clamp(tune.ffbStrengthPct / 100, 0.6, 1.6);
  const ffbDampFactor = clamp(1 - (tune.ffbDampingPct / 100) * 0.3, 0.78, 1.0);
  const wheelRatioFactor = clamp(900 / Math.max(540, tune.steeringWheelDeg), 0.82, 1.35);
  const rigidityFactor = clamp(0.88 + (tune.chassisRigidity - 1.0) * 0.24, 0.82, 1.08);
  const satTarget = clamp(bodySlipRad * 1.02, -lockRad, lockRad);
  const steerRate =
    9.0 * tune.steeringSpeed * wheelRatioFactor * ffbDampFactor * rigidityFactor;

  if (Math.abs(input.steer) > 0.04) {
    const targetSteer = input.steer * lockRad;
    const steerDiff = targetSteer - car.steerAngle;
    car.steerAngle += clamp(steerDiff, -steerRate * safeDt, steerRate * safeDt);
  } else {
    const satPull =
      (satTarget - car.steerAngle) * (10.5 * casterFactor * ffbSatGain * ffbDampFactor);
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
    input.throttle * (tune.lsdLockPct / 100) * (input.clutchKick ? 2400 : 1400);
  const baseWheelRpm =
    Math.abs(speedKmh) * 32 * currentRatio * finalDriveMult + 1150;
  const targetRpm = clamp(
    baseWheelRpm + wheelSpinBonus,
    1050,
    chassis.redlineRpm
  );
  car.rpm += (targetRpm - car.rpm) * Math.min(1, safeDt * 11);

  // Rear Tire Width (225-315mm) & Tire Pressure (12-42 PSI) footprint model
  const tireWidthFactor = clamp(0.88 + ((tune.rearTireWidthMm - 235) / 80) * 0.16, 0.85, 1.08);
  // Optimal FD footprint bite sits around 16-20 PSI; airing up to 34-42 PSI crowns & loosens rear
  const psiDelta = tune.rearTirePsi - 18;
  const tirePsiFactor =
    psiDelta >= 0
      ? clamp(1.03 - psiDelta * 0.0082, 0.82, 1.03)
      : clamp(1.03 + psiDelta * 0.012, 0.94, 1.03);

  // Suspension Spring, Anti-Squat & Weight Balance Coupling
  const rearSquatDriveBonus = clamp(
    1 + (52 - tune.rearSpringKn) * 0.0042,
    0.88,
    1.12
  );
  const antiSquatDriveBonus = clamp(
    1 + (tune.antiSquatPct - 45) * 0.0028,
    0.92,
    1.13
  );
  const rearWeightDriveFactor = clamp(
    1 + (51.5 - tune.frontWeightPct) * 0.016,
    0.9,
    1.08
  );
  const frontTurnInCrispness = clamp(
    0.88 + (tune.frontSpringKn - 40) * 0.0036 + (tune.chassisRigidity - 1.0) * 0.08,
    0.86,
    1.18
  );

  let minSplineDist = 0;
  if (car.splineSamples.length > 0) {
    const s = car.splineSamples[car.waypointIdx % car.splineSamples.length];
    minSplineDist = Math.hypot(s.x - car.x, s.y - car.y);
  }
  const onTarmac = minSplineDist <= track.roadWidth * 0.65;
  const surfaceMult = onTarmac
    ? track.surfaceGripMult
    : track.surfaceGripMult * 0.85;

  // Longitudinal forces: FD Pro wide/low-PSI tires + anti-squat + rear weight drive forward hard while sideways
  const driveAccel =
    input.throttle *
    (effectiveHp * 0.24) *
    massFactor *
    rearSquatDriveBonus *
    antiSquatDriveBonus *
    rearWeightDriveFactor *
    tireWidthFactor *
    tirePsiFactor *
    (0.75 + finalDriveMult * 0.25);
  const brakeForce = input.brake * 165;
  const handbrakeDrag = input.handbrake ? 24 : 0;

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
    forwardVel * (onTarmac ? 0.26 : 0.48) +
    Math.sign(forwardVel) * handbrakeDrag;

  // Axle Slip Angles
  const lf = chassis.bodyLengthPx * 0.34;
  const lr = chassis.bodyLengthPx * 0.34;
  const absFwd = Math.max(24, Math.abs(forwardVel));
  const fwdSign = forwardVel >= -5 ? 1 : -1;

  const frontAlpha =
    Math.atan2(lateralVel + car.angularVel * lf, absFwd) -
    car.steerAngle * fwdSign;
  const rearAlpha = Math.atan2(lateralVel - car.angularVel * lr, absFwd);

  // Front Geometry: Camber + Caster + KPI Jacking Penalty + Front Toe-Out + Ackermann
  const optimalFrontCamber = -5.2;
  const frontCamberBite =
    1 - Math.abs(tune.frontCamberDeg - optimalFrontCamber) * 0.022;
  const ackermannBite = 1 + ((25 - tune.ackermannPct) / 100) * 0.2;
  const casterBite = 1 + (tune.frontCasterDeg - 5.0) * 0.022;
  const lockFrac = clamp(Math.abs(car.steerAngle) / Math.max(0.2, lockRad), 0, 1);
  // High OEM KPI (>6 deg) jacks the outside/leading front tire and costs lateral grip at high lock
  const kpiPenalty = 1 - Math.max(0, tune.kpiDeg - 6.0) * lockFrac * 0.018;
  // Front toe-out (negative) sharpens turn-in bite
  const frontToeBite = 1 + clamp(-tune.frontToeDeg, -0.3, 0.5) * 0.12;

  // Rear Geometry: Camber + Positive Rear Toe-In Stability + Weight Distribution
  const rearCamberFactor =
    1 - Math.max(0, Math.abs(tune.rearCamberDeg) - 1.0) * 0.032;
  const rearToeStability = 1 + clamp(tune.rearToeDeg, -0.2, 0.7) * 0.14;
  const frontWeightGripBias = clamp(1 + (tune.frontWeightPct - 51) * 0.012, 0.94, 1.08);
  const rearWeightGripBias = clamp(1 + (51 - tune.frontWeightPct) * 0.014, 0.92, 1.08);

  // ARB bias: higher rear ARB stiffness loosens rear bite & sharpens oversteer
  const arbFrontFactor = 1 + ((50 - tune.rearArbBiasPct) / 100) * 0.18;
  const arbRearFactor = 1 - ((tune.rearArbBiasPct - 42) / 100) * 0.3;

  // Left-foot braking mid-drift: lower front brake bias (<62%) risks rear brake lockup & spin
  const rearBrakeBiasPenalty =
    input.brake > 0.1
      ? clamp(1 - Math.max(0, 62 - tune.brakeBiasPct) * input.brake * 0.024, 0.65, 1.0)
      : 1.0;

  // Balanced rear friction-circle drop under throttle + LSD lock + high-HP wheelspin torque
  const torqueWheelspin = clamp(
    (effectiveHp / 365) * (0.76 + finalDriveMult * 0.24),
    0.78,
    1.46
  );
  const kineticSpinHold =
    Math.abs(rearAlpha) > 0.24 && input.throttle > 0.55
      ? 1 - 0.14 * input.throttle
      : 1.0;
  const lsdSlipFactor = clamp(
    (1 -
      input.throttle *
        (0.24 + (tune.lsdLockPct / 100) * 0.16) *
        torqueWheelspin *
        clamp(1 + car.boostPsi / 28, 1, 1.24)) *
      kineticSpinHold,
    0.45,
    1.0
  );
  const handbrakeGrip = input.handbrake ? 0.24 : 1.0;
  const clutchGrip = input.clutchKick ? 0.38 : 1.0;

  const muFront =
    1.16 *
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
    tune.rearTireGrip *
    tireWidthFactor *
    tirePsiFactor *
    surfaceMult *
    rearCamberFactor *
    rearToeStability *
    rearWeightGripBias *
    arbRearFactor *
    lsdSlipFactor *
    rearBrakeBiasPenalty *
    handbrakeGrip *
    clutchGrip;

  // Progressive Pacejka curves: predictable breakaway & smooth high-angle holding
  const lateralGScale = 76;
  const frontLatForce =
    -muFront * lateralGScale * Math.sin(1.42 * Math.atan(5.0 * frontAlpha));
  const rearLatForce =
    -muRear * lateralGScale * Math.sin(1.45 * Math.atan(4.5 * rearAlpha));

  const yawWeightFactor = clamp(0.72 + massFactor * 0.28, 0.78, 1.08);
  const totalLatAccel = frontLatForce + rearLatForce;
  const yawTorque =
    (frontLatForce * lf * Math.cos(car.steerAngle * 0.55) - rearLatForce * lr) *
    0.0042 *
    yawWeightFactor *
    rigidityFactor;

  const worldAx = longAccel * cosH - totalLatAccel * sinH;
  const worldAy = longAccel * sinH + totalLatAccel * cosH;
  car.vx += worldAx * safeDt;
  car.vy += worldAy * safeDt;

  if (speedPx < 20 && input.throttle === 0) {
    car.vx *= 0.88;
    car.vy *= 0.88;
  }

  car.angularVel += yawTorque * safeDt;
  car.angularVel *= Math.pow(0.28, safeDt);
  car.angularVel = clamp(car.angularVel, -2.8, 2.8);
  car.heading = normalizeAngle(car.heading + car.angularVel * safeDt);

  const cosNew = Math.cos(car.heading);
  const sinNew = Math.sin(car.heading);

  car.x += car.vx * safeDt;
  car.y += car.vy * safeDt;

  // World perimeter bounds
  const margin = 34;
  if (car.x < margin) {
    car.x = margin;
    car.vx = Math.abs(car.vx) * 0.45;
  } else if (car.x > track.worldWidth - margin) {
    car.x = track.worldWidth - margin;
    car.vx = -Math.abs(car.vx) * 0.45;
  }
  if (car.y < margin) {
    car.y = margin;
    car.vy = Math.abs(car.vy) * 0.45;
  } else if (car.y > track.worldHeight - margin) {
    car.y = track.worldHeight - margin;
    car.vy = -Math.abs(car.vy) * 0.45;
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

  // Drift scoring engine
  const isDrifting =
    speedKmh >= 24 && slipAngleDeg >= 12 && slipAngleDeg <= 86;
  if (isDrifting) {
    car.driftDropTimer = 1.1;
    const clipMult = activeClip ? 1.5 : 1.0;
    const angleWeight = clamp(slipAngleDeg / 36, 0.35, 2.0);
    const speedWeight = clamp(speedKmh / 62, 0.45, 2.0);
    car.currentDriftPoints += angleWeight * speedWeight * clipMult * 155 * safeDt;
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
  };
}
