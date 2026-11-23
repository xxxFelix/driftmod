import type { ChassisPreset, DriftTuneParams } from '../types/drift';

export type Vec3 = [number, number, number];

export type MeshMaterialId =
  | 'dm_chromoly_orange'
  | 'dm_billet_alu'
  | 'dm_gunmetal_steel'
  | 'dm_coil_spring'
  | 'dm_brake_rotor'
  | 'dm_brake_caliper';

export interface MeshPart {
  id: string;
  label: string;
  axle: 'front' | 'rear';
  category: 'subframe' | 'arms' | 'knuckle' | 'steering' | 'coilover' | 'brake';
  material: MeshMaterialId;
  vertices: number[]; // flat [x, y, z, ...]
  normals: number[]; // flat [nx, ny, nz, ...]
  indices: number[]; // triangle indices (3 per tri)
}

export const MESH_MATERIALS: Record<
  MeshMaterialId,
  { name: string; colorHex: string; rgba: [number, number, number, number]; metallic: number; roughness: number }
> = {
  dm_chromoly_orange: {
    name: 'Chromoly Powdercoat Orange',
    colorHex: '#f97316',
    rgba: [0.976, 0.451, 0.086, 1],
    metallic: 0.35,
    roughness: 0.32,
  },
  dm_billet_alu: {
    name: 'CNC 7075 Billet Aluminum',
    colorHex: '#cbd5e1',
    rgba: [0.796, 0.835, 0.882, 1],
    metallic: 0.88,
    roughness: 0.24,
  },
  dm_gunmetal_steel: {
    name: 'Chromoly Gunmetal Steel',
    colorHex: '#64748b',
    rgba: [0.392, 0.455, 0.545, 1],
    metallic: 0.72,
    roughness: 0.38,
  },
  dm_coil_spring: {
    name: 'Coil Spring Hyper-Yellow',
    colorHex: '#eab308',
    rgba: [0.918, 0.702, 0.031, 1],
    metallic: 0.25,
    roughness: 0.35,
  },
  dm_brake_rotor: {
    name: 'Slotted Iron Rotor',
    colorHex: '#94a3b8',
    rgba: [0.58, 0.639, 0.722, 1],
    metallic: 0.85,
    roughness: 0.3,
  },
  dm_brake_caliper: {
    name: 'Anodized Red 6-Pot Caliper',
    colorHex: '#ef4444',
    rgba: [0.937, 0.267, 0.267, 1],
    metallic: 0.55,
    roughness: 0.28,
  },
};

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
};

function orthonormalBasis(dir: Vec3): [Vec3, Vec3, Vec3] {
  const w = norm(dir);
  const up: Vec3 = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(up, w));
  const v = norm(cross(w, u));
  return [u, v, w];
}

class MeshBuilder {
  vertices: number[] = [];
  normals: number[] = [];
  indices: number[] = [];

  addTri(a: Vec3, b: Vec3, c: Vec3, nOverride?: Vec3) {
    const baseIdx = this.vertices.length / 3;
    const n = nOverride ?? norm(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) {
      this.vertices.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
    }
    this.indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
  }

  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
    this.addTri(a, b, c);
    this.addTri(a, c, d);
  }

  addTube(p1: Vec3, p2: Vec3, radius: number, sides = 8) {
    const dir = sub(p2, p1);
    if (Math.hypot(dir[0], dir[1], dir[2]) < 1e-4) return;
    const [u, v] = orthonormalBasis(dir);
    const ring1: Vec3[] = [];
    const ring2: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      const offset = add(scale(u, Math.cos(ang) * radius), scale(v, Math.sin(ang) * radius));
      ring1.push(add(p1, offset));
      ring2.push(add(p2, offset));
    }
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides;
      this.addQuad(ring1[i], ring1[next], ring2[next], ring2[i]);
    }
    // End caps
    for (let i = 1; i < sides - 1; i++) {
      this.addTri(ring1[0], ring1[i + 1], ring1[i]);
      this.addTri(ring2[0], ring2[i], ring2[i + 1]);
    }
  }

  addBox(center: Vec3, size: Vec3) {
    const hx = size[0] * 0.5;
    const hy = size[1] * 0.5;
    const hz = size[2] * 0.5;
    const [cx, cy, cz] = center;
    const p: Vec3[] = [
      [cx - hx, cy - hy, cz - hz],
      [cx + hx, cy - hy, cz - hz],
      [cx + hx, cy + hy, cz - hz],
      [cx - hx, cy + hy, cz - hz],
      [cx - hx, cy - hy, cz + hz],
      [cx + hx, cy - hy, cz + hz],
      [cx + hx, cy + hy, cz + hz],
      [cx - hx, cy + hy, cz + hz],
    ];
    this.addQuad(p[0], p[3], p[2], p[1]); // bottom
    this.addQuad(p[4], p[5], p[6], p[7]); // top
    this.addQuad(p[0], p[1], p[5], p[4]); // front
    this.addQuad(p[2], p[3], p[7], p[6]); // back
    this.addQuad(p[0], p[4], p[7], p[3]); // right
    this.addQuad(p[1], p[2], p[6], p[5]); // left
  }

  addCoilRings(
    pBottom: Vec3,
    pTop: Vec3,
    coilRadius: number,
    wireRadius: number,
    coils = 6,
    tStart = 0.28,
    tSpan = 0.5
  ) {
    const segsPerCoil = 8;
    const totalSegs = coils * segsPerCoil;
    const axis = sub(pTop, pBottom);
    const [u, v] = orthonormalBasis(axis);
    let prevCenter: Vec3 | null = null;
    for (let i = 0; i <= totalSegs; i++) {
      const t = tStart + (i / totalSegs) * tSpan;
      const ang = (i / segsPerCoil) * Math.PI * 2;
      const center = add(
        add(pBottom, scale(axis, t)),
        add(scale(u, Math.cos(ang) * coilRadius), scale(v, Math.sin(ang) * coilRadius))
      );
      if (prevCenter) {
        this.addTube(prevCenter, center, wireRadius, 5);
      }
      prevCenter = center;
    }
  }
}

export function buildSuspensionMeshScene(
  chassis: ChassisPreset,
  tune: DriftTuneParams
): MeshPart[] {
  const yF = -chassis.wheelbaseM * 0.5;
  const yR = chassis.wheelbaseM * 0.5;

  const kpiRad = degToRad(tune.kpiDeg);
  const casterRad = degToRad(tune.frontCasterDeg);
  const camberFRad = degToRad(tune.frontCamberDeg);
  const toeFRad = degToRad(tune.frontToeDeg);
  const camberRRad = degToRad(tune.rearCamberDeg);
  const toeRRad = degToRad(tune.rearToeDeg);

  // Pro-Drift Geometry Defaults (1:1 locked to doubleWishboneJbeam.ts)
  const zLBJ = 0.215;
  const zUBJ = 0.675;
  const dzKingpin = zUBJ - zLBJ; // 0.460 m
  const xLBJ = 0.760;
  const xUBJ = xLBJ - dzKingpin * Math.tan(kpiRad);
  const yLBJ = yF - 0.15 * Math.tan(casterRad);
  const yUBJ = yLBJ + dzKingpin * Math.tan(casterRad);

  // Shorter steering arm (116mm behind axle) + Ackermann pickup shift, raised to z=0.315m clear of LCA & subframe
  const ackermannShift = (tune.ackermannPct / 100) * 0.035;
  const xTieOuter = xLBJ - ackermannShift;
  const yTieOuter = yF + 0.116;
  const zTieOuter = 0.315;

  const xHubInF = 0.705;
  const xHubOutF = 0.915;
  const spindleLenF = xHubOutF - xHubInF;
  const zHubCenterF = 0.35;
  const dzCamberF = spindleLenF * 0.5 * Math.sin(-camberFRad);
  const dyToeF = spindleLenF * 0.5 * Math.sin(toeFRad);

  const xHubInR = 0.54;
  const xHubOutR = 0.75;
  const spindleLenR = xHubOutR - xHubInR;
  const zHubCenterR = 0.325;
  const dzCamberR = spindleLenR * 0.5 * Math.sin(-camberRRad);
  const dyToeR = spindleLenR * 0.5 * Math.sin(toeRRad);

  // Match tie-rod inner pivot X & Z plane to LCA inner pivot (0.31m) to eliminate bump-steer,
  // raised 60mm clear above subframe rail (0.255m) and offset forward (yF + 0.060)
  const xRackMount = 0.31;
  const yRack = yF + 0.06;
  const zRack = zTieOuter;
  const zRearLinkFront = 0.25 + (tune.antiSquatPct / 100) * 0.12;

  const parts: MeshPart[] = [];

  const pushPart = (
    id: string,
    label: string,
    axle: 'front' | 'rear',
    category: MeshPart['category'],
    material: MeshMaterialId,
    mb: MeshBuilder
  ) => {
    parts.push({
      id,
      label,
      axle,
      category,
      material,
      vertices: mb.vertices,
      normals: mb.normals,
      indices: mb.indices,
    });
  };

  // 1. Chromoly Tubular Front Subframe + Triangulated Strut Tower Brace
  {
    const mb = new MeshBuilder();
    const fx1r: Vec3 = [-0.31, yF - 0.145, 0.255];
    const fx1l: Vec3 = [0.31, yF - 0.145, 0.255];
    const fx2r: Vec3 = [-0.31, yF + 0.175, 0.255];
    const fx2l: Vec3 = [0.31, yF + 0.175, 0.255];
    const fu1r: Vec3 = [-0.345, yF - 0.145, 0.64];
    const fu1l: Vec3 = [0.345, yF - 0.145, 0.64];
    const fu2r: Vec3 = [-0.345, yF + 0.145, 0.64];
    const fu2l: Vec3 = [0.345, yF + 0.145, 0.64];
    const frk1r: Vec3 = [-xRackMount, yRack, zRack];
    const frk1l: Vec3 = [xRackMount, yRack, zRack];
    const fx3r: Vec3 = [-0.38, yF + 0.15, 0.4];
    const fx3l: Vec3 = [0.38, yF + 0.15, 0.4];
    const fx4r: Vec3 = [-0.4, yF - 0.05, 0.4];
    const fx4l: Vec3 = [0.4, yF - 0.05, 0.4];
    const fc1r: Vec3 = [-0.36, yF + 0.008, 0.77];
    const fc1l: Vec3 = [0.36, yF + 0.008, 0.77];
    const fc0: Vec3 = [0, yF + 0.18, 0.76];

    const rMain = 0.018 * Math.min(1.25, Math.max(0.88, tune.chassisRigidity * 0.85));
    // Lower cradle & crossmember
    mb.addTube(fx1r, fx1l, rMain, 8);
    mb.addTube(fx2r, fx2l, rMain, 8);
    mb.addTube(fx1r, fx2r, rMain, 8);
    mb.addTube(fx1l, fx2l, rMain, 8);
    mb.addTube(fx1r, fx2l, rMain * 0.75, 6);
    mb.addTube(fx1l, fx2r, rMain * 0.75, 6);
    // Upper A-arm cradle & strut tower hoop
    mb.addTube(fu1r, fu2r, rMain, 8);
    mb.addTube(fu1l, fu2l, rMain, 8);
    mb.addTube(fu1r, fx1r, rMain * 0.85, 6);
    mb.addTube(fu2r, fx2r, rMain * 0.85, 6);
    mb.addTube(fu1l, fx1l, rMain * 0.85, 6);
    mb.addTube(fu2l, fx2l, rMain * 0.85, 6);
    mb.addTube(fx4r, fx4l, rMain * 0.85, 6);
    mb.addTube(fx4r, fx1r, rMain * 0.8, 6);
    mb.addTube(fx4l, fx1l, rMain * 0.8, 6);
    mb.addTube(fx4r, fu1r, rMain * 0.8, 6);
    mb.addTube(fx4l, fu1l, rMain * 0.8, 6);
    mb.addTube(fx3r, fx2r, rMain * 0.78, 6);
    mb.addTube(fx3r, fu2r, rMain * 0.78, 6);
    mb.addTube(fx3l, fx2l, rMain * 0.78, 6);
    mb.addTube(fx3l, fu2l, rMain * 0.78, 6);
    // Triangulated upper strut tower bridge & firewall V-brace (prevents camber flex)
    mb.addTube(fc1r, fu1r, rMain * 0.9, 6);
    mb.addTube(fc1r, fu2r, rMain * 0.9, 6);
    mb.addTube(fc1r, fx4r, rMain * 0.8, 6);
    mb.addTube(fc1l, fu1l, rMain * 0.9, 6);
    mb.addTube(fc1l, fu2l, rMain * 0.9, 6);
    mb.addTube(fc1l, fx4l, rMain * 0.8, 6);
    mb.addTube(fc1r, fc1l, rMain * 0.95, 8);
    mb.addTube(fc1r, fc0, rMain * 0.85, 6);
    mb.addTube(fc1l, fc0, rMain * 0.85, 6);
    mb.addTube(fc1r, fx4l, rMain * 0.72, 6);
    mb.addTube(fc1l, fx4r, rMain * 0.72, 6);
    // Forward-offset raised rack mounting cradle (clears subframe rail & LCA)
    mb.addTube(frk1r, fx1r, rMain * 0.78, 6);
    mb.addTube(frk1r, fx4r, rMain * 0.75, 6);
    mb.addTube(frk1l, fx1l, rMain * 0.78, 6);
    mb.addTube(frk1l, fx4l, rMain * 0.75, 6);
    pushPart('driftmod_subframe_F', 'Front Chromoly Subframe', 'front', 'subframe', 'dm_gunmetal_steel', mb);
  }

  // 2. Front Upper & Swept Lower Wishbones (Left & Right) + Drop Knuckles
  for (const side of [-1, 1] as const) {
    const tag = side < 0 ? 'FR' : 'FL';
    const fx1: Vec3 = [side * 0.31, yF - 0.145, 0.255];
    const fx2: Vec3 = [side * 0.31, yF + 0.175, 0.255];
    const fu1: Vec3 = [side * 0.345, yF - 0.145, 0.64];
    const fu2: Vec3 = [side * 0.345, yF + 0.145, 0.64];
    const fh1: Vec3 = [side * xLBJ, yLBJ, zLBJ];
    const fsh1: Vec3 = [side * 0.48, yF + 0.008, 0.275];
    const fh2: Vec3 = [side * xUBJ, yUBJ, zUBJ];
    const fh3: Vec3 = [side * xTieOuter, yTieOuter, zTieOuter];
    const fh4: Vec3 = [side * xLBJ, yF - 0.055, 0.445];
    const fh5: Vec3 = [side * xLBJ, yF + 0.055, 0.445];
    const fc1: Vec3 = [side * 0.36, yF + 0.008, 0.77];
    const fwIn: Vec3 = [side * xHubInF, yF - dyToeF, zHubCenterF - dzCamberF];
    const fwOut: Vec3 = [side * xHubOutF, yF + dyToeF, zHubCenterF + dzCamberF];
    const hubMid = scale(add(fwIn, fwOut), 0.5);

    // High-Clearance Pinched-Pocket Lower Wishbone A-Arm + inboard shock clevis cross-tube
    const lcaMb = new MeshBuilder();
    const lcaElbow1: Vec3 = [side * 0.40, yF - 0.010, 0.255];
    const lcaElbow2: Vec3 = [side * 0.58, yF - 0.010, 0.245];
    const lcaRearElbow: Vec3 = [side * 0.38, yF + 0.005, 0.255];
    lcaMb.addTube(fx1, lcaElbow1, 0.016, 8);
    lcaMb.addTube(lcaElbow1, lcaElbow2, 0.016, 8);
    lcaMb.addTube(lcaElbow2, fh1, 0.016, 8);
    lcaMb.addTube(fx2, lcaRearElbow, 0.016, 8);
    lcaMb.addTube(lcaRearElbow, fh1, 0.016, 8);
    lcaMb.addTube(lcaElbow1, fsh1, 0.013, 6);
    lcaMb.addTube(lcaRearElbow, fsh1, 0.013, 6);
    // Lateral and fore/aft triangulation: makes the lower A-arm read and flex as a rigid
    // triangular frame instead of two separate wishbone tubes.
    lcaMb.addTube(fx1, lcaElbow2, 0.012, 6);
    lcaMb.addTube(lcaElbow2, lcaRearElbow, 0.012, 6);
    lcaMb.addTube(lcaElbow2, fh1, 0.012, 6);
    lcaMb.addTube(lcaElbow1, lcaRearElbow, 0.011, 6);
    pushPart(`driftmod_lca_${tag}`, `Front Lower Wishbone (${tag})`, 'front', 'arms', 'dm_chromoly_orange', lcaMb);

    // Open-Window High-Angle Upper Wishbone A-Arm (~77-82% of LCA length; clears coilover & +/-70 deg tire barrel)
    const ucaMb = new MeshBuilder();
    const ucaElbowF1: Vec3 = [side * 0.405, yF - 0.075, 0.670];
    const ucaElbowF2: Vec3 = [side * 0.495, yF - 0.045, 0.685];
    const ucaElbowR: Vec3 = [side * 0.405, yF + 0.075, 0.670];
    ucaMb.addTube(fu1, ucaElbowF1, 0.014, 8);
    ucaMb.addTube(ucaElbowF1, ucaElbowF2, 0.014, 8);
    ucaMb.addTube(ucaElbowF2, fh2, 0.014, 8);
    ucaMb.addTube(fu2, ucaElbowR, 0.014, 8);
    ucaMb.addTube(ucaElbowR, fh2, 0.014, 8);
    pushPart(`driftmod_uca_${tag}`, `Front Upper Wishbone (${tag})`, 'front', 'arms', 'dm_chromoly_orange', ucaMb);

    // Billet CNC Drop-Knuckle Upright (shortened anti-toggle steering arm)
    const knMb = new MeshBuilder();
    knMb.addTube(fh1, hubMid, 0.022, 8);
    knMb.addTube(fh2, hubMid, 0.02, 8);
    knMb.addTube(fh1, fh4, 0.015, 6);
    knMb.addTube(fh2, fh4, 0.015, 6);
    knMb.addTube(fh1, fh5, 0.015, 6);
    knMb.addTube(fh2, fh5, 0.015, 6);
    knMb.addTube(fh1, fh3, 0.015, 6); // Short anti-toggle steering arm
    knMb.addTube(fh5, fh3, 0.014, 6);
    knMb.addTube(fwIn, fwOut, 0.034, 10); // Spindle & hub flange
    pushPart(`driftmod_knuckle_${tag}`, `Drop-Knuckle Upright (${tag})`, 'front', 'knuckle', 'dm_billet_alu', knMb);

    // 2-Way Front Coilover + High-Perch Helical Spring (mounted to inboard LCA clevis fsh1 -> fc1)
    const coilMb = new MeshBuilder();
    const coilMid = add(fsh1, scale(sub(fc1, fsh1), 0.64));
    coilMb.addTube(fsh1, coilMid, 0.013, 8); // Slim piston shaft clear of +/-70 deg tire barrel
    coilMb.addTube(coilMid, fc1, 0.022, 8); // Anodized upper shock body
    coilMb.addCoilRings(fsh1, fc1, 0.03, 0.006, 5, 0.64, 0.3); // High-perch helical spring
    pushPart(`driftmod_coilover_${tag}`, `2-Way Drift Coilover (${tag})`, 'front', 'coilover', 'dm_coil_spring', coilMb);

    // Slotted Front Brake Rotor (metallic steel, outboard on hub) + 6-Piston Caliper (red)
    const rotorMb = new MeshBuilder();
    const rotorIn = add(fwIn, scale(sub(fwOut, fwIn), 0.6));
    const rotorOut = add(fwIn, scale(sub(fwOut, fwIn), 0.73));
    const rotorMid = scale(add(rotorIn, rotorOut), 0.5);
    rotorMb.addTube(rotorIn, rotorOut, 0.152, 20);
    pushPart(`driftmod_rotor_${tag}`, `Front Slotted Rotor (${tag})`, 'front', 'brake', 'dm_brake_rotor', rotorMb);

    const brkMb = new MeshBuilder();
    brkMb.addBox([rotorMid[0], rotorMid[1] + 0.128, rotorMid[2] + 0.04], [0.062, 0.088, 0.118]);
    pushPart(`driftmod_brake_${tag}`, `Front 6-Pot Caliper (${tag})`, 'front', 'brake', 'dm_brake_caliper', brkMb);
  }

  // 3. Steering Rack + Tie Rods
  {
    const rackMb = new MeshBuilder();
    const fx3r: Vec3 = [-xRackMount, yRack, zRack];
    const fx3l: Vec3 = [xRackMount, yRack, zRack];
    const fh3r: Vec3 = [-xTieOuter, yTieOuter, zTieOuter];
    const fh3l: Vec3 = [xTieOuter, yTieOuter, zTieOuter];
    rackMb.addTube(fx3r, fx3l, 0.022, 10); // Billet rack housing
    rackMb.addBox([0, yRack, zRack + 0.032], [0.08, 0.056, 0.064]); // Pinion housing
    rackMb.addTube(fx3r, fh3r, 0.011, 6); // Tie rod R
    rackMb.addTube(fx3l, fh3l, 0.011, 6); // Tie rod L
    pushPart('driftmod_steering_F', 'Quick-Ratio Steering Rack & Tie Rods', 'front', 'steering', 'dm_billet_alu', rackMb);
  }

  // 4. Rear Anti-Squat Multi-Link Subframe, Arms, Coilovers & Brakes (split RR/RL for independent flexbody articulation)
  {
    const subRMb = new MeshBuilder();
    const rx1r: Vec3 = [-0.33, yR - 0.24, zRearLinkFront];
    const rx1l: Vec3 = [0.33, yR - 0.24, zRearLinkFront];
    const rx2r: Vec3 = [-0.33, yR + 0.18, 0.26];
    const rx2l: Vec3 = [0.33, yR + 0.18, 0.26];
    const ru1r: Vec3 = [-0.35, yR - 0.175, 0.47];
    const ru1l: Vec3 = [0.35, yR - 0.175, 0.47];
    const ru2r: Vec3 = [-0.35, yR + 0.175, 0.47];
    const ru2l: Vec3 = [0.35, yR + 0.175, 0.47];
    subRMb.addTube(rx1r, rx1l, 0.018, 8);
    subRMb.addTube(rx2r, rx2l, 0.018, 8);
    subRMb.addTube(rx1r, rx2r, 0.018, 8);
    subRMb.addTube(rx1l, rx2l, 0.018, 8);
    subRMb.addTube(ru1r, ru2r, 0.015, 6);
    subRMb.addTube(ru1l, ru2l, 0.015, 6);
    subRMb.addTube(ru1r, rx1r, 0.015, 6);
    subRMb.addTube(ru2r, rx2r, 0.015, 6);
    subRMb.addTube(ru1l, rx1l, 0.015, 6);
    subRMb.addTube(ru2l, rx2l, 0.015, 6);
    pushPart('driftmod_subframe_R', 'Rear Anti-Squat Subframe', 'rear', 'subframe', 'dm_gunmetal_steel', subRMb);

    for (const side of [-1, 1] as const) {
      const rTag = side < 0 ? 'RR' : 'RL';
      const armsRMb = new MeshBuilder();
      const coilRMb = new MeshBuilder();
      const knRMb = new MeshBuilder();
      const rotorRMb = new MeshBuilder();
      const brkRMb = new MeshBuilder();

      const rx1: Vec3 = [side * 0.33, yR - 0.24, zRearLinkFront];
      const rx2: Vec3 = [side * 0.33, yR + 0.18, 0.26];
      const ru1: Vec3 = [side * 0.35, yR - 0.175, 0.47];
      const ru2: Vec3 = [side * 0.35, yR + 0.175, 0.47];
      const rh1: Vec3 = [side * 0.635, yR, 0.245];
      const rsh1: Vec3 = [side * 0.47, yR + 0.005, 0.28];
      const rh2: Vec3 = [side * 0.625, yR, 0.475];
      const rh4: Vec3 = [side * 0.635, yR - 0.085, 0.345];
      const rh5: Vec3 = [side * 0.635, yR + 0.105, 0.345];
      const rc1: Vec3 = [side * 0.45, yR + 0.005, 0.745];
      const rwIn: Vec3 = [side * xHubInR, yR - dyToeR, zHubCenterR - dzCamberR];
      const rwOut: Vec3 = [side * xHubOutR, yR + dyToeR, zHubCenterR + dzCamberR];
      const hubMid = scale(add(rwIn, rwOut), 0.5);

      armsRMb.addTube(rx1, rh1, 0.015, 6);
      armsRMb.addTube(rx2, rh1, 0.015, 6);
      armsRMb.addTube(add(rx1, scale(sub(rh1, rx1), 0.51)), rsh1, 0.012, 6);
      armsRMb.addTube(add(rx2, scale(sub(rh1, rx2), 0.51)), rsh1, 0.012, 6);
      armsRMb.addTube(ru1, rh2, 0.013, 6);
      armsRMb.addTube(ru2, rh2, 0.013, 6);
      armsRMb.addTube(rx2, rh5, 0.011, 6);

      knRMb.addTube(rh1, hubMid, 0.022, 8);
      knRMb.addTube(rh2, hubMid, 0.02, 8);
      knRMb.addTube(rh4, rh5, 0.016, 6);
      knRMb.addTube(rwIn, rwOut, 0.034, 10);

      const coilMidR = add(rsh1, scale(sub(rc1, rsh1), 0.34));
      coilRMb.addTube(rsh1, coilMidR, 0.013, 8);
      coilRMb.addTube(coilMidR, rc1, 0.021, 8);
      coilRMb.addCoilRings(rsh1, rc1, 0.03, 0.006, 6);

      const rotorIn = add(rwIn, scale(sub(rwOut, rwIn), 0.6));
      const rotorOut = add(rwIn, scale(sub(rwOut, rwIn), 0.72));
      const rotorMid = scale(add(rotorIn, rotorOut), 0.5);
      rotorRMb.addTube(rotorIn, rotorOut, 0.144, 18);
      brkRMb.addBox([rotorMid[0], rotorMid[1] - 0.12, rotorMid[2] + 0.035], [0.056, 0.08, 0.105]);

      pushPart(`driftmod_arms_${rTag}`, `Rear Multi-Link Control Arms (${rTag})`, 'rear', 'arms', 'dm_chromoly_orange', armsRMb);
      pushPart(`driftmod_knuckle_${rTag}`, `Rear Upright & Spindle (${rTag})`, 'rear', 'knuckle', 'dm_billet_alu', knRMb);
      pushPart(`driftmod_coilover_${rTag}`, `Rear 2-Way Coilover (${rTag})`, 'rear', 'coilover', 'dm_coil_spring', coilRMb);
      pushPart(`driftmod_rotor_${rTag}`, `Rear Slotted Brake Rotor (${rTag})`, 'rear', 'brake', 'dm_brake_rotor', rotorRMb);
      pushPart(`driftmod_brake_${rTag}`, `Rear Dual-Caliper Brake (${rTag})`, 'rear', 'brake', 'dm_brake_caliper', brkRMb);
    }
  }

  return parts;
}

export function serializeSuspensionColladaDae(parts: MeshPart[]): string {
  const matEffectsXml = Object.entries(MESH_MATERIALS)
    .map(
      ([id, mat]) => `    <effect id="${id}-effect">
      <profile_COMMON>
        <technique sid="common">
          <phong>
            <ambient><color>0.08 0.08 0.09 1</color></ambient>
            <diffuse><color>${mat.rgba.join(' ')}</color></diffuse>
            <specular><color>0.65 0.65 0.7 1</color></specular>
            <shininess><float>${Math.round((1 - mat.roughness) * 90)}</float></shininess>
          </phong>
        </technique>
      </profile_COMMON>
    </effect>`
    )
    .join('\n');

  const materialsXml = Object.keys(MESH_MATERIALS)
    .map(
      (id) => `    <material id="${id}" name="${id}">
      <instance_effect url="#${id}-effect"/>
    </material>`
    )
    .join('\n');

  const geometriesXml = parts
    .map((p) => {
      const posStr = p.vertices.map((v) => v.toFixed(4)).join(' ');
      const normStr = p.normals.map((v) => v.toFixed(4)).join(' ');
      const triPairs: number[] = [];
      for (const idx of p.indices) {
        triPairs.push(idx, idx);
      }
      const triCount = Math.floor(p.indices.length / 3);
      return `    <geometry id="${p.id}-mesh" name="${p.id}">
      <mesh>
        <source id="${p.id}-positions">
          <float_array id="${p.id}-positions-array" count="${p.vertices.length}">${posStr}</float_array>
          <technique_common>
            <accessor source="#${p.id}-positions-array" count="${p.vertices.length / 3}" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <source id="${p.id}-normals">
          <float_array id="${p.id}-normals-array" count="${p.normals.length}">${normStr}</float_array>
          <technique_common>
            <accessor source="#${p.id}-normals-array" count="${p.normals.length / 3}" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="${p.id}-vertices">
          <input semantic="POSITION" source="#${p.id}-positions"/>
        </vertices>
        <triangles material="${p.material}" count="${triCount}">
          <input semantic="VERTEX" source="#${p.id}-vertices" offset="0"/>
          <input semantic="NORMAL" source="#${p.id}-normals" offset="1"/>
          <p>${triPairs.join(' ')}</p>
        </triangles>
      </mesh>
    </geometry>`;
    })
    .join('\n');

  const nodesXml = parts
    .map(
      (p) => `      <node id="${p.id}" name="${p.id}" type="NODE">
        <instance_geometry url="#${p.id}-mesh">
          <bind_material>
            <technique_common>
              <instance_material symbol="${p.material}" target="#${p.material}"/>
            </technique_common>
          </bind_material>
        </instance_geometry>
      </node>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><author>DriftMod Workbench</author></contributor>
    <unit name="meter" meter="1"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>
${matEffectsXml}
  </library_effects>
  <library_materials>
${materialsXml}
  </library_materials>
  <library_geometries>
${geometriesXml}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
${nodesXml}
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#Scene"/>
  </scene>
</COLLADA>
`;
}

export function generateBeamNGMaterialsJson(): string {
  const doc: Record<string, unknown> = {};
  for (const [id, mat] of Object.entries(MESH_MATERIALS)) {
    doc[id] = {
      name: id,
      mapTo: id,
      class: 'Material',
      version: 1.5,
      Stages: [
        {
          baseColorFactor: mat.rgba,
          metallicFactor: mat.metallic,
          roughnessFactor: mat.roughness,
        },
        {},
        {},
        {},
      ],
    };
  }
  return JSON.stringify(doc, null, 2);
}

// Unused helper export check
export { dot };
