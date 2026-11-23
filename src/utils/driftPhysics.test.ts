import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASSIS_PRESETS, TRACK_PRESETS } from '../data/presets';
import {
  analyzeDriftSetup,
  createInitialCarState,
  stepDriftPhysics,
} from './driftPhysics';
import type { ChassisPreset, DriftTuneParams, TrackDefinition } from '../types/drift';

function simulateAutopilotRun(
  chassis: ChassisPreset,
  track: TrackDefinition,
  tune: DriftTuneParams,
  seconds = 28
) {
  const car = createInitialCarState(track);
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  const blankInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    clutchKick: false,
  };
  let lastHud = stepDriftPhysics(car, blankInput, true, chassis, tune, track, dt);
  for (let i = 1; i < steps; i++) {
    lastHud = stepDriftPhysics(car, blankInput, true, chassis, tune, track, dt);
  }
  const effectiveScore = Math.round(
    car.totalScore + car.currentDriftPoints * car.comboMultiplier
  );
  return {
    car,
    lastHud,
    effectiveScore,
  };
}

test('all 5 chassis presets across all 3 tracks score PRO and drift cleanly with zero spinouts or bogs', () => {
  for (const chassis of CHASSIS_PRESETS) {
    for (const track of TRACK_PRESETS) {
      const analysis = analyzeDriftSetup(
        chassis,
        chassis.defaultTune,
        track.surfaceGripMult
      );
      assert.equal(
        analysis.grade,
        'PRO',
        `${chassis.id} on ${track.id} expected PRO grade, got ${analysis.grade} (${analysis.mechanicalScore}): ${analysis.issues.map((i) => i.code).join(', ')}`
      );
      assert.equal(analysis.issues.length, 0);

      const { car, effectiveScore } = simulateAutopilotRun(
        chassis,
        track,
        chassis.defaultTune
      );
      assert.equal(
        car.spinoutCount,
        0,
        `${chassis.id} on ${track.id} had unexpected spinoutCount=${car.spinoutCount}`
      );
      assert.equal(
        car.bogCount,
        0,
        `${chassis.id} on ${track.id} had unexpected bogCount=${car.bogCount}`
      );
      assert.ok(
        effectiveScore >= 400,
        `${chassis.id} on ${track.id} expected >= 400 pts, got ${effectiveScore}`
      );
    }
  }
});

test('bad drift setups consistently underperform the calibrated BX baseline in both setup analysis and live simulation', () => {
  const bx = CHASSIS_PRESETS[0];
  const pad = TRACK_PRESETS[0];
  const goodSetup = analyzeDriftSetup(bx, bx.defaultTune, pad.surfaceGripMult);
  const goodSim = simulateAutopilotRun(bx, pad, bx.defaultTune);

  const badCases: { name: string; patch: Partial<DriftTuneParams>; expectedCode: string }[] = [
    { name: 'open differential', patch: { lsdLockPct: 0 }, expectedCode: 'OPEN_DIFF' },
    { name: 'rear brake bias', patch: { brakeBiasPct: 50 }, expectedCode: 'REAR_BRAKE_BIAS' },
    { name: 'low steering lock', patch: { steeringLockDeg: 40 }, expectedCode: 'LOW_LOCK' },
    {
      name: 'inverted springs',
      patch: { frontSpringKn: 45, rearSpringKn: 75 },
      expectedCode: 'INVERTED_SPRINGS',
    },
    {
      name: 'overinflated hard tires',
      patch: { rearTirePsi: 42, rearTireGrip: 0.72 },
      expectedCode: 'LOW_REAR_TRACTION',
    },
    {
      name: 'extreme negative rear camber',
      patch: { rearCamberDeg: -5.5 },
      expectedCode: 'EXCESS_REAR_CAMBER',
    },
    { name: 'high positive Ackermann', patch: { ackermannPct: 90 }, expectedCode: 'HIGH_ACKERMANN' },
    { name: 'high KPI', patch: { kpiDeg: 13.5 }, expectedCode: 'HIGH_KPI' },
    {
      name: 'underpowered vs sticky wide tires',
      patch: { turboBoostPsi: 0, rearTireGrip: 1.12, rearTireWidthMm: 315, rearTirePsi: 15 },
      expectedCode: 'UNDERPOWERED_BOG',
    },
    { name: 'rear toe-out', patch: { rearToeDeg: -0.2 }, expectedCode: 'REAR_TOE_OUT' },
  ];

  for (const c of badCases) {
    const badTune: DriftTuneParams = { ...bx.defaultTune, ...c.patch };
    const analysis = analyzeDriftSetup(bx, badTune, pad.surfaceGripMult);
    assert.ok(
      analysis.mechanicalScore < goodSetup.mechanicalScore - 10,
      `${c.name} setup score (${analysis.mechanicalScore}) should be well below good (${goodSetup.mechanicalScore})`
    );
    assert.ok(
      analysis.issues.some((i) => i.code === c.expectedCode),
      `${c.name} should flag issue ${c.expectedCode}, got ${analysis.issues.map((i) => i.code).join(', ')}`
    );

    const sim = simulateAutopilotRun(bx, pad, badTune);
    assert.ok(
      sim.effectiveScore < goodSim.effectiveScore,
      `${c.name} sim score (${sim.effectiveScore}) should be lower than good BX (${goodSim.effectiveScore})`
    );
  }
});

test('extreme manual spinout triggers SPINOUT fault and voids active unbanked drift points', () => {
  const bx = CHASSIS_PRESETS[0];
  const pad = TRACK_PRESETS[0];
  const car = createInitialCarState(pad);

  // Build up an active drift run on autopilot first
  const blank = { throttle: 0, brake: 0, steer: 0, handbrake: false, clutchKick: false };
  for (let i = 0; i < 120; i++) {
    stepDriftPhysics(car, blank, true, bx, bx.defaultTune, pad, 1 / 60);
  }

  // Force over-rotation spinout via sustained lock + throttle + handbrake
  let sawSpinout = false;
  for (let i = 0; i < 180; i++) {
    const hud = stepDriftPhysics(
      car,
      { throttle: 1, brake: 0, steer: 1, handbrake: true, clutchKick: true },
      false,
      bx,
      { ...bx.defaultTune, steeringLockDeg: 40, rearToeDeg: -0.2 },
      pad,
      1 / 60
    );
    if (hud.faultStatus === 'SPINOUT') {
      sawSpinout = true;
      assert.equal(hud.currentDriftPoints, 0);
      assert.equal(hud.comboMultiplier, 1.0);
      break;
    }
  }
  assert.ok(sawSpinout, 'Expected manual over-rotation to trigger SPINOUT fault');
});
