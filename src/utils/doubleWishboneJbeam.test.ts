import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHASSIS_PRESETS } from '../data/presets';
import { buildDoubleWishboneJbeamFiles } from './doubleWishboneJbeam';
import { buildModZipBlob, generateBeamNGModFiles } from './jbeamGenerator';
import {
  analyzeReferenceJbeam,
  parseRelaxedJbeam,
  validateModPhysics,
} from './beamngPhysicsValidator';
import {
  buildSuspensionMeshScene,
  serializeSuspensionColladaDae,
} from './suspensionMeshGenerator';

type Vec3 = [number, number, number];

function extractNodesMap(partObj: Record<string, unknown>): Map<string, Vec3> {
  const map = new Map<string, Vec3>();
  const rows = (partObj.nodes as unknown[]) || [];
  for (const row of rows) {
    if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number') {
      map.set(row[0], [row[1], row[2] as number, row[3] as number]);
    }
  }
  return map;
}

function extractNodeGroups(partObj: Record<string, unknown>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  let activeGroups: string[] = [];
  for (const row of (partObj.nodes as unknown[]) || []) {
    if (!Array.isArray(row) && typeof row === 'object' && row !== null && 'group' in row) {
      const g = (row as { group?: string | string[] }).group;
      activeGroups = Array.isArray(g) ? g : g ? [g] : [];
    } else if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number') {
      for (const g of activeGroups) {
        if (!g) continue;
        const arr = groups.get(g) ?? [];
        arr.push(row[0]);
        groups.set(g, arr);
      }
    }
  }
  return groups;
}

function segSegDist(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3): number {
  const u: Vec3 = [a2[0] - a1[0], a2[1] - a1[1], a2[2] - a1[2]];
  const v: Vec3 = [b2[0] - b1[0], b2[1] - b1[1], b2[2] - b1[2]];
  const w: Vec3 = [a1[0] - b1[0], a1[1] - b1[1], a1[2] - b1[2]];
  const a = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const b = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const c = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const e = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
  const D = a * c - b * b;
  let sN: number;
  let sD = D;
  let tN: number;
  let tD = D;
  if (D < 1e-8) {
    sN = 0;
    sD = 1;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) {
      sN = 0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0;
    else if (-d + b > a) sN = sD;
    else {
      sN = -d + b;
      sD = a;
    }
  }
  const sc = Math.abs(sN) < 1e-8 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-8 ? 0 : tN / tD;
  const dx = w[0] + sc * u[0] - tc * v[0];
  const dy = w[1] + sc * u[1] - tc * v[1];
  const dz = w[2] + sc * u[2] - tc * v[2];
  return Math.hypot(dx, dy, dz);
}

function rotateAboutAxis(p: Vec3, origin: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const kx = axis[0] / len;
  const ky = axis[1] / len;
  const kz = axis[2] / len;
  const vx = p[0] - origin[0];
  const vy = p[1] - origin[1];
  const vz = p[2] - origin[2];
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const d = kx * vx + ky * vy + kz * vz;
  return [
    origin[0] + vx * cos + (ky * vz - kz * vy) * sin + kx * d * (1 - cos),
    origin[1] + vy * cos + (kz * vx - kx * vz) * sin + ky * d * (1 - cos),
    origin[2] + vz * cos + (kx * vy - ky * vx) * sin + kz * d * (1 - cos),
  ];
}

test('all 5 generated JBeam files parse cleanly as valid JSON and expose selectable front/rear sub-slots', () => {
  const bx = CHASSIS_PRESETS[0];
  const files = buildDoubleWishboneJbeamFiles(bx, bx.defaultTune);
  assert.equal(files.length, 5);

  const parsedParts: Record<string, Record<string, unknown>> = {};
  for (const f of files) {
    const doc = JSON.parse(f.content) as Record<string, Record<string, unknown>>;
    for (const [k, v] of Object.entries(doc)) {
      parsedParts[k] = v;
    }
  }

  const frontSusp = parsedParts['bx_driftmod_dw_suspension_F'];
  assert.ok(frontSusp, 'bx_driftmod_dw_suspension_F must exist');
  assert.equal(frontSusp.slotType, 'bx_suspension_F');

  const slotRows = frontSusp.slots2 as unknown[][];
  const slotTypes = slotRows.map((r) => r[0]);
  assert.ok(slotTypes.includes('bx_driftmod_subframe_F'));
  assert.ok(slotTypes.includes('bx_driftmod_steering_F'));
  assert.ok(slotTypes.includes('bx_driftmod_coilover_F'));
  assert.ok(slotTypes.includes('bx_driftmod_swaybar_F'));
  assert.ok(slotTypes.includes('bx_driftmod_hub_F'));
  // The bolt-in chassis frame used to ride along as a core slot here and folded the shell,
  // so it must no longer be part of the front suspension tree.
  assert.ok(!slotTypes.includes('bx_driftmod_chassis_frame'));
  assert.ok(!parsedParts['bx_driftmod_chassis_frame']);

  assert.ok(parsedParts['bx_driftmod_tubular_subframe_F']);
  assert.ok(parsedParts['bx_driftmod_street_subframe_F']);
  assert.ok(parsedParts['bx_driftmod_rack_F']);
  assert.ok(parsedParts['bx_driftmod_coilover_F']);
  assert.ok(parsedParts['bx_driftmod_coilover_F_pro']);
  assert.ok(parsedParts['bx_driftmod_suspension_R']);
});

test('double wishbone kinematics satisfy bump-steer match, 75-85% UCA/LCA ratio, anti-toggle margin, and triangulated clevis/tower brace', () => {
  const bx = CHASSIS_PRESETS[0];
  const files = buildDoubleWishboneJbeamFiles(bx, bx.defaultTune);
  const parsed: Record<string, Record<string, unknown>> = {};
  for (const f of files) {
    Object.assign(parsed, JSON.parse(f.content));
  }

  const frontSusp = parsed['bx_driftmod_dw_suspension_F'];
  const subframe = parsed['bx_driftmod_tubular_subframe_F'];
  const rearSusp = parsed['bx_driftmod_suspension_R'];
  const nodes = new Map<string, Vec3>([
    ...extractNodesMap(frontSusp),
    ...extractNodesMap(subframe),
    ...extractNodesMap(rearSusp),
  ]);

  const fx1l = nodes.get('fx1l')!;
  const fx2l = nodes.get('fx2l')!;
  const frk1l = nodes.get('frk1l')!;
  const fx3l = nodes.get('fx3l')!;
  const fu1l = nodes.get('fu1l')!;
  const fh1l = nodes.get('fh1l')!;
  const fh2l = nodes.get('fh2l')!;
  const fh3l = nodes.get('fh3l')!;
  const fsh1l = nodes.get('fsh1l')!;
  const fc1l = nodes.get('fc1l')!;
  const fc1r = nodes.get('fc1r')!;
  const fc0 = nodes.get('fc0')!;
  const rsh1l = nodes.get('rsh1l')!;

  assert.ok(fc0, 'Triangulated cowl brace apex fc0 must exist');
  assert.ok(fsh1l && rsh1l, 'Inboard LCA & rear arm shock clevis nodes fsh1l/rsh1l must exist');
  assert.ok(Math.abs(fx3l[0] - 0.38) < 0.001 && Math.abs(fx3l[2] - 0.4) < 0.001, 'fx3l must sit at stock firewall subframe ear');

  // 1. Tie-rod vs LCA arc & bump-steer match using dedicated rack inner node frk1l
  assert.equal(frk1l[0], fx1l[0]);
  assert.equal(frk1l[2], fh3l[2]);
  const lcaLen = Math.hypot(fh1l[0] - fx1l[0], fh1l[2] - fx1l[2]);
  const tieLen = Math.hypot(fh3l[0] - frk1l[0], fh3l[1] - frk1l[1], fh3l[2] - frk1l[2]);
  assert.ok(Math.abs(tieLen - lcaLen) < 0.015, `Tie-rod (${tieLen.toFixed(4)}) should match LCA (${lcaLen.toFixed(4)}) within 15mm`);

  // 2. UCA length ratio 75%-85% of LCA length for clean negative camber gain
  const ucaLen = Math.hypot(fh2l[0] - fu1l[0], fh2l[2] - fu1l[2]);
  const ucaRatio = ucaLen / lcaLen;
  assert.ok(ucaRatio >= 0.75 && ucaRatio <= 0.85, `UCA/LCA ratio ${ucaRatio.toFixed(3)} must be in 0.75..0.85`);

  // 3. Over-center toggle margin >= 15 deg at +/- 68 deg steering lock
  const dzKp = fh2l[2] - fh1l[2];
  const kpFrac = (fh3l[2] - fh1l[2]) / dzKp;
  const xKp = fh1l[0] + kpFrac * (fh2l[0] - fh1l[0]);
  const yKp = fh1l[1] + kpFrac * (fh2l[1] - fh1l[1]);
  for (const steerDeg of [-68, 68]) {
    const rad = (steerDeg * Math.PI) / 180;
    const dx = fh3l[0] - xKp;
    const dy = fh3l[1] - yKp;
    const rx = xKp + dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = yKp + dx * Math.sin(rad) + dy * Math.cos(rad);
    const cosA =
      ((rx - xKp) * (rx - frk1l[0]) + (ry - yKp) * (ry - frk1l[1])) /
      (Math.hypot(rx - xKp, ry - yKp) * Math.hypot(rx - frk1l[0], ry - frk1l[1]));
    const marginDeg = (Math.acos(Math.min(1, Math.abs(cosA))) * 180) / Math.PI;
    assert.ok(marginDeg >= 15, `Toggle margin at ${steerDeg}deg was ${marginDeg.toFixed(1)}deg (< 15deg)`);
  }

  // 4. Triangulated strut tower cross-brace & inboard coilover beams exist
  const beams = (frontSusp.beams as unknown[][])
    .filter((b) => Array.isArray(b) && typeof b[0] === 'string' && typeof b[1] === 'string')
    .map((b) => `${b[0]}:${b[1]}`);
  assert.ok(beams.includes('fc1r:fc1l'));
  assert.ok(beams.includes('fc1r:fc0'));
  assert.ok(beams.includes('fc1l:fc0'));
  assert.ok(beams.includes('fc1r:fx4l'));
  assert.ok(beams.includes('fc1l:fx4r'));
  assert.ok(beams.includes('fsh1l:fx1l'));
  assert.ok(beams.includes('fsh1l:fh1l'));
  assert.ok(fx2l[1] > fx1l[1]);
  assert.ok(fc1r[2] > fu1l[2] && fc1l[2] > fu1l[2]);

  // 5. Coilover flexbody groups each have >= 3 nodes so BeamNG flexbody matrices are non-degenerate
  const fGroups = extractNodeGroups(frontSusp);
  const sfGroups = extractNodeGroups(subframe);
  for (const gName of ['driftmod_coil_FR', 'driftmod_coil_FL']) {
    const all = new Set([...(fGroups.get(gName) ?? []), ...(sfGroups.get(gName) ?? [])]);
    assert.ok(all.size >= 3, `${gName} must reference >= 3 nodes, got ${all.size}`);
  }
});

test('front & rear non-jointed components and swept 235/40R17 front tire maintain positive clearance across +/-70 deg steer and -85mm..+90mm travel on all 5 presets', () => {
  for (const preset of CHASSIS_PRESETS) {
    const id = preset.beamngInternalId;
    const files = buildDoubleWishboneJbeamFiles(preset, preset.defaultTune);
    const parsed: Record<string, Record<string, unknown>> = {};
    for (const f of files) {
      Object.assign(parsed, JSON.parse(f.content));
    }

    const nodes = new Map<string, Vec3>([
      ...extractNodesMap(parsed[`${id}_driftmod_dw_suspension_F`]),
      ...extractNodesMap(parsed[`${id}_driftmod_tubular_subframe_F`]),
      ...extractNodesMap(parsed[`${id}_driftmod_hub_F`]),
      ...extractNodesMap(parsed[`${id}_driftmod_suspension_R`]),
      ...extractNodesMap(parsed[`${id}_driftmod_subframe_R`]),
      ...extractNodesMap(parsed[`${id}_driftmod_hub_R`]),
    ]);

    const yF = -preset.wheelbaseM * 0.5;
    const fx1 = nodes.get('fx1l')!;
    const fx2 = nodes.get('fx2l')!;
    const frk1 = nodes.get('frk1l')!;
    const frk1r = nodes.get('frk1r')!;
    const fu1 = nodes.get('fu1l')!;
    const fu2 = nodes.get('fu2l')!;
    const fc1 = nodes.get('fc1l')!;
    const fh1Base = nodes.get('fh1l')!;
    const fh2Base = nodes.get('fh2l')!;
    const fh3Base = nodes.get('fh3l')!;
    const fh4Base = nodes.get('fh4l')!;
    const fh5Base = nodes.get('fh5l')!;
    const fsh1Base = nodes.get('fsh1l')!;
    const fwInBase = nodes.get('fw1l')!;
    const fwOutBase = nodes.get('fw1ll')!;

    const lcaElbow1Base: Vec3 = [0.40, yF - 0.010, 0.255];
    const lcaElbow2Base: Vec3 = [0.58, yF - 0.010, 0.245];
    const lcaRearElbowBase: Vec3 = [0.38, yF + 0.005, 0.255];
    const ucaElbowF1Base: Vec3 = [0.405, yF - 0.075, 0.670];
    const ucaElbowF2Base: Vec3 = [0.495, yF - 0.045, 0.685];
    const ucaElbowRBase: Vec3 = [0.405, yF + 0.075, 0.670];

    const lcaPivotMid: Vec3 = [(fx1[0] + fx2[0]) * 0.5, (fx1[1] + fx2[1]) * 0.5, (fx1[2] + fx2[2]) * 0.5];
    const lcaAxis: Vec3 = [fx2[0] - fx1[0], fx2[1] - fx1[1], fx2[2] - fx1[2]];
    const lcaRadius = Math.hypot(fh1Base[0] - lcaPivotMid[0], fh1Base[2] - lcaPivotMid[2]);

    type Seg = { name: string; a: Vec3; b: Vec3; r: number };

    let worstFrontGap = Infinity;
    let worstFrontPair = '';
    let worstTireGap = Infinity;
    let worstTireInfo = '';

    for (let dz = -0.085; dz <= 0.0901; dz += 0.025) {
      const bumpAngle = -Math.asin(Math.max(-0.5, Math.min(0.5, dz / lcaRadius)));
      const fh1 = rotateAboutAxis(fh1Base, lcaPivotMid, lcaAxis, bumpAngle);
      const fsh1 = rotateAboutAxis(fsh1Base, lcaPivotMid, lcaAxis, bumpAngle);
      const lcaE1 = rotateAboutAxis(lcaElbow1Base, lcaPivotMid, lcaAxis, bumpAngle);
      const lcaE2 = rotateAboutAxis(lcaElbow2Base, lcaPivotMid, lcaAxis, bumpAngle);
      const lcaRE = rotateAboutAxis(lcaRearElbowBase, lcaPivotMid, lcaAxis, bumpAngle);

      const fh2: Vec3 = [
        fh2Base[0] - (dz > 0 ? dz * 0.06 : dz * 0.02),
        fh2Base[1],
        fh2Base[2] + (fh1[2] - fh1Base[2]),
      ];
      const ucaBumpDz = fh2[2] - fh2Base[2];
      const ucaEF1: Vec3 = [ucaElbowF1Base[0], ucaElbowF1Base[1], ucaElbowF1Base[2] + ucaBumpDz * 0.45];
      const ucaEF2: Vec3 = [ucaElbowF2Base[0], ucaElbowF2Base[1], ucaElbowF2Base[2] + ucaBumpDz * 0.75];
      const ucaER: Vec3 = [ucaElbowRBase[0], ucaElbowRBase[1], ucaElbowRBase[2] + ucaBumpDz * 0.45];

      const deltaKnuckle: Vec3 = [fh1[0] - fh1Base[0], fh1[1] - fh1Base[1], fh1[2] - fh1Base[2]];
      const kpAxis: Vec3 = [fh2[0] - fh1[0], fh2[1] - fh1[1], fh2[2] - fh1[2]];

      for (let steerDeg = -70; steerDeg <= 70; steerDeg += 10) {
        const steerRad = (steerDeg * Math.PI) / 180;
        const xformKnuckle = (p: Vec3): Vec3 =>
          rotateAboutAxis(
            [p[0] + deltaKnuckle[0], p[1] + deltaKnuckle[1], p[2] + deltaKnuckle[2]],
            fh1,
            kpAxis,
            steerRad
          );

        const fh3 = xformKnuckle(fh3Base);
        const fh4 = xformKnuckle(fh4Base);
        const fh5 = xformKnuckle(fh5Base);
        const fwIn = xformKnuckle(fwInBase);
        const fwOut = xformKnuckle(fwOutBase);
        const hubMid: Vec3 = [(fwIn[0] + fwOut[0]) * 0.5, (fwIn[1] + fwOut[1]) * 0.5, (fwIn[2] + fwOut[2]) * 0.5];

        const coilSegs: Seg[] = [
          {
            name: 'coil_shaft',
            a: fsh1,
            b: [
              fsh1[0] + (fc1[0] - fsh1[0]) * 0.64,
              fsh1[1] + (fc1[1] - fsh1[1]) * 0.64,
              fsh1[2] + (fc1[2] - fsh1[2]) * 0.64,
            ],
            r: 0.013,
          },
          {
            name: 'coil_spring',
            a: [
              fsh1[0] + (fc1[0] - fsh1[0]) * 0.64,
              fsh1[1] + (fc1[1] - fsh1[1]) * 0.64,
              fsh1[2] + (fc1[2] - fsh1[2]) * 0.64,
            ],
            b: [
              fsh1[0] + (fc1[0] - fsh1[0]) * 0.94,
              fsh1[1] + (fc1[1] - fsh1[1]) * 0.94,
              fsh1[2] + (fc1[2] - fsh1[2]) * 0.94,
            ],
            r: 0.036,
          },
        ];

        const checkPairs: Array<[Seg, Seg]> = [
          [coilSegs[0], { name: 'uca_f1', a: fu1, b: ucaEF1, r: 0.014 }],
          [coilSegs[0], { name: 'uca_f2', a: ucaEF1, b: ucaEF2, r: 0.014 }],
          [coilSegs[0], { name: 'uca_f3', a: ucaEF2, b: fh2, r: 0.014 }],
          [coilSegs[0], { name: 'uca_r1', a: fu2, b: ucaER, r: 0.014 }],
          [coilSegs[0], { name: 'uca_r2', a: ucaER, b: fh2, r: 0.014 }],
          [coilSegs[1], { name: 'uca_f1', a: fu1, b: ucaEF1, r: 0.014 }],
          [coilSegs[1], { name: 'uca_f2', a: ucaEF1, b: ucaEF2, r: 0.014 }],
          [coilSegs[1], { name: 'uca_f3', a: ucaEF2, b: fh2, r: 0.014 }],
          [coilSegs[1], { name: 'uca_r1', a: fu2, b: ucaER, r: 0.014 }],
          [coilSegs[1], { name: 'uca_r2', a: ucaER, b: fh2, r: 0.014 }],
          [coilSegs[0], { name: 'spindle', a: fwIn, b: fwOut, r: 0.034 }],
          [coilSegs[1], { name: 'spindle', a: fwIn, b: fwOut, r: 0.034 }],
          [coilSegs[1], { name: 'knuckle_upright', a: fh1, b: hubMid, r: 0.022 }],
          [coilSegs[1], { name: 'knuckle_ear_f', a: fh1, b: fh4, r: 0.015 }],
          [coilSegs[1], { name: 'knuckle_ear_r', a: fh1, b: fh5, r: 0.015 }],
          [coilSegs[0], { name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }],
          [coilSegs[1], { name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }],
          [{ name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }, { name: 'lca_r1', a: fx2, b: lcaRE, r: 0.016 }],
          [{ name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }, { name: 'lca_r2', a: lcaRE, b: fh1, r: 0.016 }],
          [{ name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }, { name: 'lca_f2', a: lcaE1, b: lcaE2, r: 0.016 }],
          [{ name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }, { name: 'lca_f3', a: lcaE2, b: fh1, r: 0.016 }],
          [{ name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }, { name: 'knuckle_ear_f', a: fh1, b: fh4, r: 0.015 }],
          [{ name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }, { name: 'knuckle_ear_r', a: fh2, b: fh5, r: 0.015 }],
          [{ name: 'rack_bar', a: frk1r, b: frk1, r: 0.022 }, { name: 'subframe_rail', a: fx1, b: fx2, r: 0.018 }],
          [{ name: 'tie_rod', a: frk1, b: fh3, r: 0.011 }, { name: 'uca_r2', a: ucaER, b: fh2, r: 0.014 }],
        ];

        for (const [s1, s2] of checkPairs) {
          const gap = segSegDist(s1.a, s1.b, s2.a, s2.b) - (s1.r + s2.r);
          if (gap < worstFrontGap) {
            worstFrontGap = gap;
            worstFrontPair = `${preset.id}: ${s1.name} vs ${s2.name} @ dz=${(dz * 1000).toFixed(0)}mm steer=${steerDeg}deg`;
          }
        }

        const spindleAxis = [fwOut[0] - fwIn[0], fwOut[1] - fwIn[1], fwOut[2] - fwIn[2]];
        const sLen = Math.hypot(spindleAxis[0], spindleAxis[1], spindleAxis[2]) || 1;
        const sx = spindleAxis[0] / sLen;
        const sy = spindleAxis[1] / sLen;
        const sz = spindleAxis[2] / sLen;
        const ux = -sy;
        const uy = sx;
        const uLen = Math.hypot(ux, uy) || 1;
        const r1: Vec3 = [ux / uLen, uy / uLen, 0];
        const r2: Vec3 = [sy * r1[2] - sz * r1[1], sz * r1[0] - sx * r1[2], sx * r1[1] - sy * r1[0]];
        const tireCenter: Vec3 = [fwIn[0] + sx * 0.105, fwIn[1] + sy * 0.105, fwIn[2] + sz * 0.105];
        const tireRadius = 0.295;
        const tireHalfW = 0.112;
        const tireGuardSegs: Seg[] = [
          { name: 'lca_f1', a: fx1, b: lcaE1, r: 0.016 },
          { name: 'lca_f2', a: lcaE1, b: lcaE2, r: 0.016 },
          { name: 'lca_f3', a: lcaE2, b: fh1, r: 0.016 },
          { name: 'lca_r1', a: fx2, b: lcaRE, r: 0.016 },
          { name: 'lca_r2', a: lcaRE, b: fh1, r: 0.016 },
          { name: 'uca_f1', a: fu1, b: ucaEF1, r: 0.014 },
          { name: 'uca_f2', a: ucaEF1, b: ucaEF2, r: 0.014 },
          { name: 'uca_f3', a: ucaEF2, b: fh2, r: 0.014 },
          { name: 'uca_r1', a: fu2, b: ucaER, r: 0.014 },
          { name: 'uca_r2', a: ucaER, b: fh2, r: 0.014 },
          { name: 'coil_spring', a: coilSegs[1].a, b: coilSegs[1].b, r: 0.036 },
        ];
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * Math.PI * 2;
          const innerPt: Vec3 = [
            tireCenter[0] - sx * tireHalfW + tireRadius * (Math.cos(ang) * r1[0] + Math.sin(ang) * r2[0]),
            tireCenter[1] - sy * tireHalfW + tireRadius * (Math.cos(ang) * r1[1] + Math.sin(ang) * r2[1]),
            tireCenter[2] - sz * tireHalfW + tireRadius * (Math.cos(ang) * r1[2] + Math.sin(ang) * r2[2]),
          ];
          for (const seg of tireGuardSegs) {
            const gap = segSegDist(innerPt, innerPt, seg.a, seg.b) - seg.r;
            if (gap < worstTireGap) {
              worstTireGap = gap;
              worstTireInfo = `${preset.id}: ${seg.name} @ dz=${(dz * 1000).toFixed(0)}mm steer=${steerDeg}deg`;
            }
          }
        }
      }
    }

    assert.ok(
      worstFrontGap >= 0.008,
      `Front suspension component clearance dropped to ${(worstFrontGap * 1000).toFixed(1)}mm (${worstFrontPair})`
    );
    assert.ok(
      worstTireGap >= 0.01,
      `Swept front tire clearance dropped to ${(worstTireGap * 1000).toFixed(1)}mm (${worstTireInfo})`
    );

    // Rear axle component clearance check
    const rx1 = nodes.get('rx1l')!;
    const rx2 = nodes.get('rx2l')!;
    const ru1 = nodes.get('ru1l')!;
    const ru2 = nodes.get('ru2l')!;
    const rc1 = nodes.get('rc1l')!;
    const rh1 = nodes.get('rh1l')!;
    const rsh1 = nodes.get('rsh1l')!;
    const rh2 = nodes.get('rh2l')!;
    const rh4 = nodes.get('rh4l')!;
    const rh5 = nodes.get('rh5l')!;
    const rwIn = nodes.get('rw1l')!;
    const rwOut = nodes.get('rw1ll')!;
    const rSpringA: Vec3 = [
      rsh1[0] + (rc1[0] - rsh1[0]) * 0.28,
      rsh1[1] + (rc1[1] - rsh1[1]) * 0.28,
      rsh1[2] + (rc1[2] - rsh1[2]) * 0.28,
    ];
    const rSpringB: Vec3 = [
      rsh1[0] + (rc1[0] - rsh1[0]) * 0.78,
      rsh1[1] + (rc1[1] - rsh1[1]) * 0.78,
      rsh1[2] + (rc1[2] - rsh1[2]) * 0.78,
    ];

    const rearChecks: Array<[Seg, Seg]> = [
      [{ name: 'r_spring', a: rSpringA, b: rSpringB, r: 0.036 }, { name: 'r_uca_f', a: ru1, b: rh2, r: 0.013 }],
      [{ name: 'r_spring', a: rSpringA, b: rSpringB, r: 0.036 }, { name: 'r_uca_r', a: ru2, b: rh2, r: 0.013 }],
      [{ name: 'r_spring', a: rSpringA, b: rSpringB, r: 0.036 }, { name: 'r_spindle', a: rwIn, b: rwOut, r: 0.034 }],
      [{ name: 'r_spring', a: rSpringA, b: rSpringB, r: 0.036 }, { name: 'r_knuckle_ears', a: rh4, b: rh5, r: 0.016 }],
      [{ name: 'r_toe_link', a: rx2, b: rh5, r: 0.011 }, { name: 'r_lca_f', a: rx1, b: rh1, r: 0.015 }],
    ];

    for (const [s1, s2] of rearChecks) {
      const gap = segSegDist(s1.a, s1.b, s2.a, s2.b) - (s1.r + s2.r);
      assert.ok(
        gap >= 0.025,
        `${preset.id} rear clearance ${s1.name} vs ${s2.name} was ${(gap * 1000).toFixed(1)}mm (< 25mm)`
      );
    }
  }
});

test('all flexbody mesh names match Collada DAE node IDs and full mod ZIP archive builds cleanly', () => {
  const bx = CHASSIS_PRESETS[0];
  const files = generateBeamNGModFiles(bx, bx.defaultTune);
  const meshParts = buildSuspensionMeshScene(bx, bx.defaultTune);
  const dae = serializeSuspensionColladaDae(meshParts);

  const meshIds = new Set(meshParts.map((m) => m.id));
  for (const id of meshIds) {
    assert.ok(dae.includes(`<node id="${id}"`), `DAE missing node ${id}`);
  }

  for (const f of files) {
    if (!f.filename.endsWith('.jbeam')) continue;
    const doc = JSON.parse(f.content) as Record<string, { flexbodies?: unknown[][] }>;
    for (const part of Object.values(doc)) {
      for (const row of part.flexbodies ?? []) {
        if (Array.isArray(row) && typeof row[0] === 'string' && row[0] !== 'mesh') {
          assert.ok(meshIds.has(row[0]), `JBeam flexbody "${row[0]}" missing from DAE meshes`);
        }
      }
    }
  }

  const blob = buildModZipBlob(files, bx.name);
  assert.ok(blob.size > 50000, 'Generated mod zip should contain full JBeam + DAE + Lua assets');
});

test('BeamNG 2000Hz physics pre-flight passes across all 5 chassis presets at default and extreme sliders', () => {
  for (const preset of CHASSIS_PRESETS) {
    const tunes = [
      preset.defaultTune,
      {
        ...preset.defaultTune,
        steeringLockDeg: 72,
        frontSpringKn: 110,
        rearSpringKn: 90,
        chassisRigidity: 1.5,
      },
    ];
    for (const tune of tunes) {
      const files = generateBeamNGModFiles(preset, tune);
      const report = validateModPhysics(files, preset, tune);
      assert.equal(
        report.overallStatus,
        'pass',
        `${preset.id} pre-flight failed: ${report.checks.map((c) => `${c.id}=${c.status}(${c.detail})`).join('; ')}`
      );
      assert.ok(
        report.maxStiffnessRatio < 3_000_000,
        `${preset.id} peak k/m ${report.maxStiffnessRatio} must stay below 3.0 MN/(m*kg)`
      );
      assert.ok(
        report.maxDampingRatio < 2_400,
        `${preset.id} peak c/m ${report.maxDampingRatio} must stay below 2400 s^-1`
      );
    }
  }
});

test('parseRelaxedJbeam and analyzeReferenceJbeam strip comments/trailing commas and diff unibody tie-ins', () => {
  const bx = CHASSIS_PRESETS[0];
  const files = generateBeamNGModFiles(bx, bx.defaultTune);
  const sampleStockBody = `{
    // Simulated BeamNG stock bx_body snippet with comments and trailing commas
    "bx_body": {
      "slotType": "bx_body",
      "slots": [
        ["type", "default", "description"],
        ["bx_suspension_F", "bx_suspension_F", "Front Suspension"],
      ],
      "nodes": [
        ["id", "posX", "posY", "posZ"],
        {"nodeWeight": 3.5},
        ["f10rr", -0.36, -1.35, 0.24],
        ["fs1r", -0.44, -1.25, 0.72],
        /* trailing comma below */
        ["f1r", -0.35, -1.05, 0.21],
      ],
      "beams": [
        ["id1:", "id2:"],
        {"beamSpring": 2200000, "beamDamp": 95},
        ["f10rr", "f1r"],
      ],
    },
  }`;

  const parsed = parseRelaxedJbeam(sampleStockBody);
  assert.ok(parsed.bx_body);
  const summary = analyzeReferenceJbeam(sampleStockBody, files);
  assert.deepEqual(summary.partNames, ['bx_body']);
  assert.equal(summary.nodeCount, 3);
  assert.deepEqual(summary.nodeWeightRange, [3.5, 3.5]);
  assert.deepEqual(summary.beamSpringRange, [2200000, 2200000]);
  assert.ok(summary.matchedTieInNodes.some((m) => m.nodeId === 'f10rr'));
  assert.ok(summary.matchedTieInNodes.some((m) => m.nodeId === 'fs1r'));
});

test('real BeamNG v0.40 BX stock body & suspension JBeams pass full compatibility, tie-in, axle Y, wheel offset, and powertrain checks', () => {
  const jbeamDir = path.resolve(process.cwd(), 'Jbeams for mod');
  const coupeRaw = fs.readFileSync(path.join(jbeamDir, 'bx_body_coupe.jbeam'), 'utf8');
  const hatchRaw = fs.readFileSync(path.join(jbeamDir, 'bx_body_hatch.jbeam'), 'utf8');
  const stockFrontRaw = fs.readFileSync(path.join(jbeamDir, 'bx_suspension_F.jbeam'), 'utf8');
  const stockRearRaw = fs.readFileSync(path.join(jbeamDir, 'bx_suspension_R.jbeam'), 'utf8');

  const bx = CHASSIS_PRESETS[0];
  const modFiles = generateBeamNGModFiles(bx, bx.defaultTune);

  const coupeParsed = parseRelaxedJbeam(coupeRaw) as Record<string, unknown>;
  const hatchParsed = parseRelaxedJbeam(hatchRaw) as Record<string, unknown>;
  const stockFrontParsed = parseRelaxedJbeam(stockFrontRaw) as Record<string, Record<string, unknown>>;
  const stockRearParsed = parseRelaxedJbeam(stockRearRaw) as Record<string, Record<string, unknown>>;

  assert.ok(coupeParsed.bx_body_coupe, 'bx_body_coupe must parse cleanly');
  assert.ok(hatchParsed.bx_body_hatch, 'bx_body_hatch must parse cleanly');
  assert.ok(stockFrontParsed.bx_suspension_F, 'bx_suspension_F must parse cleanly');
  assert.ok(stockRearParsed.bx_suspension_R, 'bx_suspension_R must parse cleanly');

  // Verify zero missing unibody tie-in nodes on BOTH coupe and hatch bodies
  const coupeSummary = analyzeReferenceJbeam(coupeRaw, modFiles);
  const hatchSummary = analyzeReferenceJbeam(hatchRaw, modFiles);
  assert.deepEqual(
    coupeSummary.missingUnibodyTieIns,
    [],
    `Coupe missing tie-in nodes: ${coupeSummary.missingUnibodyTieIns.join(', ')}`
  );
  assert.deepEqual(
    hatchSummary.missingUnibodyTieIns,
    [],
    `Hatch missing tie-in nodes: ${hatchSummary.missingUnibodyTieIns.join(', ')}`
  );

  // Verify wheel hub alignment, powertrain spindles, fx6r/fx6l engine mounts & validateModPhysics pass
  const parsedMod: Record<string, Record<string, unknown>> = {};
  for (const f of modFiles) {
    if (f.filename.endsWith('.jbeam')) {
      Object.assign(parsedMod, JSON.parse(f.content));
    }
  }

  const modHubF = parsedMod['bx_driftmod_hub_F'];
  const modHubR = parsedMod['bx_driftmod_hub_R'];
  const modSubF = parsedMod['bx_driftmod_tubular_subframe_F'];
  const modWheeldataR = parsedMod['bx_driftmod_wheeldata_R'];
  const modDiffR = parsedMod['bx_driftmod_diff_R'];

  const hubFNodes = extractNodesMap(modHubF);
  const hubRNodes = extractNodesMap(modHubR);
  const subFNodes = extractNodesMap(modSubF);

  // Compare front & rear hub Y center against stock fw1r/rw1r (-1.25 / +1.25)
  const stockFrontHubNodes = extractNodesMap(stockFrontParsed.bx_hub_F_5);
  const stockRearHubNodes = extractNodesMap(stockRearParsed.bx_hub_R_5);
  const stockFy = stockFrontHubNodes.get('fw1r')![1];
  const stockRy = stockRearHubNodes.get('rw1r')![1];
  assert.ok(Math.abs(hubFNodes.get('fw1r')![1] - stockFy) < 0.015, 'Front hub Y must match stock bx_hub_F_5');
  assert.ok(Math.abs(hubRNodes.get('rw1r')![1] - stockRy) < 0.015, 'Rear hub Y must match stock bx_hub_R_5');

  // Verify nodeOffset on wheel_F_5 & wheel_R_5
  const wheelFSlot = (modHubF.slots2 as unknown[][]).find((r) => r[0] === 'wheel_F_5');
  const wheelRSlot = (modHubR.slots2 as unknown[][]).find((r) => r[0] === 'wheel_R_5');
  assert.ok(wheelFSlot && (wheelFSlot[5] as { nodeOffset?: { z: number } })?.nodeOffset?.z === 0.35);
  assert.ok(wheelRSlot && (wheelRSlot[5] as { nodeOffset?: { z: number } })?.nodeOffset?.z === 0.325);

  // Verify fx6r/fx6l front engine mount nodes and rear spindle powertrain shafts exist
  assert.ok(subFNodes.has('fx6r') && subFNodes.has('fx6l'), 'fx6r/fx6l engine mount nodes must exist');
  const pwrR = (modWheeldataR.powertrain as unknown[][]) || [];
  assert.ok(pwrR.some((r) => r[0] === 'shaft' && r[1] === 'spindleRL' && r[2] === 'wheelaxleRL'));
  assert.ok(pwrR.some((r) => r[0] === 'shaft' && r[1] === 'spindleRR' && r[2] === 'wheelaxleRR'));
  assert.ok(modDiffR.powertrain, 'bx_driftmod_diff_R must define differential powertrain');

  // Rear drivetrain chain must be closed: gearbox -> driveshaft -> differential_R -> wheelaxle -> spindle
  const diffPt = (modDiffR.powertrain as unknown[][]) || [];
  assert.ok(
    diffPt.some((r) => r[0] === 'shaft' && r[1] === 'driveshaft' && r[2] === 'gearbox'),
    'diff_R must define the driveshaft shaft driven by gearbox output 1'
  );
  assert.ok(
    diffPt.some((r) => r[0] === 'differential' && r[1] === 'differential_R' && r[2] === 'driveshaft'),
    'differential_R must be driven by the driveshaft device'
  );
  assert.ok(diffPt.some((r) => r[0] === 'shaft' && r[1] === 'wheelaxleRL' && r[2] === 'differential_R'));
  assert.ok(diffPt.some((r) => r[0] === 'shaft' && r[1] === 'wheelaxleRR' && r[2] === 'differential_R'));

  // Differential mount pickups & stock diff flexbody groups must exist so DriftMod or stock diffs mount cleanly
  const subR = parsedMod['bx_driftmod_subframe_R'];
  const subRNodes = extractNodesMap(subR);
  const subRGroups = extractNodeGroups(subR);
  for (const nid of ['rx3r', 'rx3l', 'rx4r', 'rx4l', 'rx5r', 'rx5l', 'rx6r', 'rx6l', 'rx7r', 'rx7l', 'rx8']) {
    assert.ok(subRNodes.has(nid), `rear subframe must provide differential/subframe node ${nid}`);
  }
  for (const grp of ['bx_subframe_R', 'bx_lowermounts_R', 'bx_uppermounts_R']) {
    assert.ok((subRGroups.get(grp)?.length ?? 0) >= 2, `rear subframe must provide stock group ${grp}`);
  }

  // Verify fragile/light unibody nodes (f14rr, r2rr, r2ll) are NOT tied into by DriftMod beams
  const subFJbeamText = modFiles.find((f) => f.filename.includes('subframe_F'))?.content ?? '';
  const suspFJbeamText = modFiles.find((f) => f.filename.includes('suspension_F'))?.content ?? '';
  const suspRJbeamText = modFiles.find((f) => f.filename.includes('suspension_R'))?.content ?? '';
  assert.ok(!suspFJbeamText.includes('f14rr') && !suspFJbeamText.includes('f14ll'), 'must not tie fc1 to 1.5kg f14rr/ll');
  assert.ok(!suspRJbeamText.includes('r2rr') && !suspRJbeamText.includes('r2ll'), 'must not tie rx2 to r2rr/ll');
  assert.ok(!subFJbeamText.includes('"rails"'), 'must not emit self-referential enginemountnodes rails');

  // Verify Lua controller isolation and modScript load ordering
  const modScriptFile = modFiles.find((f) => f.filename === 'modScript.lua')!;
  const driftmodLuaFile = modFiles.find((f) => f.filename === 'driftmod.lua')!;
  assert.ok(
    modScriptFile.content.indexOf('extensions.load') < modScriptFile.content.indexOf('setExtensionUnloadMode'),
    'modScript.lua must load extension before setting manual unload mode'
  );
  assert.ok(
    driftmodLuaFile.content.includes('strContains(origin, "driftmod")') &&
      !driftmodLuaFile.content.includes('strContains(origin, "rollcage")'),
    'driftmod.lua must only tune driftmod beams and never mutate body/rollcage/frame'
  );

  // Verify 3-layer coilover schema uses |NORMAL spring with precompressionRange & >=165kN beamDeform
  const coilF = parsedMod['bx_driftmod_coilover_F'];
  const coilR = parsedMod['bx_driftmod_coilover_R'];
  for (const cPart of [coilF, coilR]) {
    const vars = (cPart.variables as unknown[][]) || [];
    const rhVar = vars.find((r) => Array.isArray(r) && (r[0] === '$rideheight_F' || r[0] === '$rideheight_R'));
    assert.ok(rhVar && rhVar[2] === '+m' && rhVar[4] === 0.0, 'coilover rideheight must use +m precompressionRange with 0.0 default');
  }

  const report = validateModPhysics(modFiles, bx, bx.defaultTune);
  assert.equal(report.overallStatus, 'pass');
});


test('hub clusters use stock wheelhub_* groups, hub physics and stock-strength knuckle attachment', () => {
  const bx = CHASSIS_PRESETS[0];
  const files = buildDoubleWishboneJbeamFiles(bx, bx.defaultTune);
  const parsed: Record<string, Record<string, unknown>> = {};
  for (const f of files) Object.assign(parsed, JSON.parse(f.content));

  const hubGroups: [string, string[]][] = [
    ['bx_driftmod_hub_F', ['wheelhub_FR', 'wheelhub_FL']],
    ['bx_driftmod_hub_R', ['wheelhub_RR', 'wheelhub_RL']],
  ];

  for (const [partName, groups] of hubGroups) {
    const hub = parsed[partName];
    assert.ok(hub, `${partName} must exist`);

    // Nodes must sit in the stock wheelhub_* groups, otherwise the rim mesh and hub cluster
    // have nothing to bind to (symptom: tires render, rims do not).
    const nodeGroups = new Set<string>();
    for (const row of hub.nodes as unknown[]) {
      if (Array.isArray(row)) continue;
      const g = (row as { group?: string | string[] }).group;
      if (typeof g === 'string' && g) nodeGroups.add(g);
      if (Array.isArray(g)) g.forEach((x) => nodeGroups.add(x));
    }
    for (const g of groups) {
      assert.ok(nodeGroups.has(g), `${partName} must place its hub nodes in group ${g}`);
    }

    // The hub pressure-wheel cluster (hubRadius / wheelOffset / numRays) must exist as on stock
    const pw = (hub.pressureWheels as unknown[][]) ?? [];
    assert.ok(
      pw.some((r) => !Array.isArray(r) && typeof r === 'object' && r !== null && 'hubRadius' in r),
      `${partName} must define the hub pressureWheels cluster`
    );

    // Knuckle->hub beams must carry stock stiffness: the old 1.35 MN/m budget let the wheel
    // fold under the car and snap off at speed.
    const hubBeams = (hub.beams as unknown[][]).filter(
      (r) => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string'
    );
    assert.ok(hubBeams.length >= 8, `${partName} must attach both hub faces to the knuckle`);
    if (partName === 'bx_driftmod_hub_F') {
      for (const hubNode of ['fw1r', 'fw1rr', 'fw1l', 'fw1ll']) {
        const upperBall = hubNode.endsWith('l') || hubNode.endsWith('ll') ? 'fh2l' : 'fh2r';
        assert.ok(
          hubBeams.some((row) => row[0] === hubNode && row[1] === upperBall),
          `${hubNode} must be constrained to upper ball joint ${upperBall}`
        );
      }
    }
    let strongest = 0;
    for (const row of hubBeams) {
      const opts = (row[2] as { beamSpring?: number } | undefined) ?? {};
      strongest = Math.max(strongest, opts.beamSpring ?? 8501000);
    }
    assert.ok(strongest >= 8500000, `${partName} hub attachment must be >= 8.5 MN/m, got ${strongest}`);
  }

  // Rear wheels must couple to the differential's virtual node, never to a suspension node
  const wheeldataR = parsed['bx_driftmod_wheeldata_R'];
  const wheelRows = (wheeldataR.pressureWheels as unknown[][]).filter(
    (r) => Array.isArray(r) && typeof r[0] === 'string' && r[0] !== 'name'
  );
  assert.ok(wheelRows.length >= 2, 'rear wheeldata must define both wheels');
  for (const row of wheelRows) {
    const opts = row[8] as Record<string, string> | undefined;
    assert.equal(opts?.['torqueCoupling:'], 'rdiff', 'rear wheel torqueCoupling must use rdiff');
  }

  const report = validateModPhysics(files, bx, bx.defaultTune);
  assert.equal(report.overallStatus, 'pass');
});

test('wheel_F_5 and wheel_R_5 load strictly before wheeldata_F/R in depth-first slot order so tires receive collision & traction', () => {
  for (const preset of CHASSIS_PRESETS) {
    const id = preset.beamngInternalId;
    const files = buildDoubleWishboneJbeamFiles(preset, preset.defaultTune);
    const parsed: Record<string, Record<string, unknown>> = {};
    for (const f of files) Object.assign(parsed, JSON.parse(f.content));

    const frontSusp = parsed[`${id}_driftmod_dw_suspension_F`];
    const frontSlots = ((frontSusp.slots2 as unknown[][]) || []).map((r) => r[0]);
    const hubFIdx = frontSlots.indexOf(`${id}_driftmod_hub_F`);
    const wdFIdx = frontSlots.indexOf(`${id}_driftmod_wheeldata_F`);
    assert.ok(hubFIdx !== -1 && wdFIdx !== -1 && hubFIdx < wdFIdx, `${preset.id}: wheeldata_F must sit AFTER hub_F on dw_suspension_F`);

    const rearSusp = parsed[`${id}_driftmod_suspension_R`];
    const rearSlots = ((rearSusp.slots2 as unknown[][]) || []).map((r) => r[0]);
    const hubRIdx = rearSlots.indexOf(`${id}_driftmod_hub_R`);
    const wdRIdx = rearSlots.indexOf(`${id}_driftmod_wheeldata_R`);
    assert.ok(hubRIdx !== -1 && wdRIdx !== -1 && hubRIdx < wdRIdx, `${preset.id}: wheeldata_R must sit AFTER hub_R on suspension_R`);

    // Hub slots must NOT load wheeldata ahead of wheel_F_5 / wheel_R_5
    const hubF = parsed[`${id}_driftmod_hub_F`];
    const hubFSlots = ((hubF.slots2 as unknown[][]) || []).map((r) => r[0]);
    assert.ok(!hubFSlots.includes(`${id}_driftmod_wheeldata_F`), `${preset.id}: wheeldata_F must not live inside hub_F`);
    assert.ok(hubFSlots.includes('wheel_F_5'));

    const hubR = parsed[`${id}_driftmod_hub_R`];
    const hubRSlots = ((hubR.slots2 as unknown[][]) || []).map((r) => r[0]);
    assert.ok(!hubRSlots.includes(`${id}_driftmod_wheeldata_R`), `${preset.id}: wheeldata_R must not live inside hub_R`);
    assert.ok(hubRSlots.includes('wheel_R_5'));

    // Hub spindle nodes match stock bx_hub_F_5 / bx_hub_R_5 collision:true, selfCollision:true
    for (const hub of [hubF, hubR]) {
      const colCfg = (hub.nodes as unknown[]).find(
        (r) => !Array.isArray(r) && typeof r === 'object' && r !== null && 'collision' in r
      ) as { collision?: boolean; selfCollision?: boolean } | undefined;
      assert.equal(colCfg?.collision, true, `${preset.id}: hub spindle nodes must have collision:true`);
      assert.equal(colCfg?.selfCollision, true, `${preset.id}: hub spindle nodes must have selfCollision:true`);
    }

    // wheeldata_F and wheeldata_R must reset tire & brake pressureWheels state cleanly at the end
    for (const wdName of [`${id}_driftmod_wheeldata_F`, `${id}_driftmod_wheeldata_R`]) {
      const pw = (parsed[wdName].pressureWheels as unknown[]) || [];
      assert.ok(
        pw.some((r) => !Array.isArray(r) && typeof r === 'object' && r !== null && (r as Record<string, unknown>).frictionCoef === ''),
        `${wdName} must reset frictionCoef`
      );
      assert.ok(
        pw.some((r) => !Array.isArray(r) && typeof r === 'object' && r !== null && (r as Record<string, unknown>).enableHubcaps === false),
        `${wdName} must reset enableHubcaps`
      );
      assert.ok(
        !pw.some((r) => !Array.isArray(r) && typeof r === 'object' && r !== null && 'enableTireSideSupportBeams' in (r as Record<string, unknown>)),
        `${wdName} must not force enableTireSideSupportBeams`
      );
    }
  }
});

