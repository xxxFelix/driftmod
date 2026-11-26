import type { ChassisPreset, DriftTuneParams, ModFileSpec } from '../types/drift';

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const round4 = (n: number) => Number(n.toFixed(4));

type Vec3 = [number, number, number];
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rotateAboutAxis3 = (p: Vec3, origin: Vec3, axis: Vec3, angleRad: number): Vec3 => {
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
};
const precompExpr = (varName: string, baseVal: number, coef: number, extraExpr = ''): string => {
  const c = Number(coef.toFixed(6));
  const delta =
    baseVal === 0
      ? varName
      : baseVal > 0
        ? `(${varName}-${round4(baseVal)})`
        : `(${varName}+${round4(-baseVal)})`;
  return `$=1.0+${delta}*${c}${extraExpr}`;
};

export function buildDoubleWishboneJbeamFiles(
  chassis: ChassisPreset,
  tune: DriftTuneParams
): ModFileSpec[] {
  const id = chassis.beamngInternalId;

  // Derived chassis-scaled suspension geometry (meters, BeamNG coordinates: +X left, -Y front, +Z up)
  const yF = round4(-chassis.wheelbaseM * 0.5); // -1.2500 on bx
  const yR = round4(chassis.wheelbaseM * 0.5);  // +1.2500 on bx

  // Kingpin Inclination (KPI) + Caster -> exact 3D upper & lower balljoint coordinates
  const kpiRad = degToRad(tune.kpiDeg);
  const casterRad = degToRad(tune.frontCasterDeg);
  const camberFRad = degToRad(tune.frontCamberDeg);
  const toeFRad = degToRad(tune.frontToeDeg);
  const camberRRad = degToRad(tune.rearCamberDeg);
  const toeRRad = degToRad(tune.rearToeDeg);

  // Pro-Drift Geometry Defaults (cleared across +/-70 deg lock & -85..+90mm travel)
  // High-gooseneck upright clears 235/40R17 tire crown across all 5 wheelbases
  const zLBJ = 0.215;
  const zUBJ = 0.675;
  const dzKingpin = zUBJ - zLBJ; // 0.460 m
  const xLBJ = 0.760;
  const xUBJ = round4(xLBJ - dzKingpin * Math.tan(kpiRad));
  const yLBJ = round4(yF - 0.15 * Math.tan(casterRad));
  const yUBJ = round4(yLBJ + dzKingpin * Math.tan(casterRad));

  // Shorter steering arm (116mm behind axle) + Ackermann pickup shift, raised to z=0.315m clear of LCA & subframe
  const ackermannShift = (tune.ackermannPct / 100) * 0.035;
  const xTieOuter = round4(xLBJ - ackermannShift);
  const yTieOuter = round4(yF + 0.116);
  const zTieOuter = 0.315;

  // Kingpin axis position at tie-rod height for accurate steering arm radius
  const kpFracAtTie = (zTieOuter - zLBJ) / dzKingpin;
  const xKpAtTie = xLBJ + kpFracAtTie * (xUBJ - xLBJ);
  const yKpAtTie = yLBJ + kpFracAtTie * (yUBJ - yLBJ);

  // Front hub spindle (fw1r/l inner, fw1rr/ll outer): FD widebody front drift track
  // Positive toe = toe-IN (outer spindle shifts -Y forward, inner +Y rearward); negative toe = toe-OUT
  const xHubInF = 0.705;
  const xHubOutF = 0.915;
  const spindleLenF = xHubOutF - xHubInF; // 0.210 m matching stock bx
  const zHubCenterF = 0.35;
  const dzCamberF = spindleLenF * 0.5 * Math.sin(-camberFRad);
  const dyToeF = spindleLenF * 0.5 * Math.sin(-toeFRad);

  // Rear hub spindle (rw1r/l inner, rw1rr/ll outer): matched to stock bx hub width & ride height
  const xHubInR = 0.54;
  const xHubOutR = 0.75;
  const spindleLenR = xHubOutR - xHubInR; // 0.210 m matching stock bx
  const zHubCenterR = 0.325;
  const dzCamberR = spindleLenR * 0.5 * Math.sin(-camberRRad);
  const dyToeR = spindleLenR * 0.5 * Math.sin(-toeRRad);

  // Match tie-rod inner pivot (frk1r/l at 0.31m, z=0.315m) to LCA pivot X for zero bump-steer,
  // raised 60mm above subframe rail (0.255m) and offset forward (yF + 0.060) for anti-toggle clearance
  const xRackMount = 0.31;
  const yRack = round4(yF + 0.06);
  const zRack = zTieOuter;
  const tieRodLen = Math.hypot(xTieOuter - xRackMount, yTieOuter - yRack, zTieOuter - zRack);
  const lockRad = degToRad(Math.min(72, Math.max(40, tune.steeringLockDeg)));
  const outerLockRad = lockRad * (1 - (tune.ackermannPct / 100) * 0.24);
  const armDx = xTieOuter - xKpAtTie;
  const armDy = yTieOuter - yKpAtTie;
  const innerTieX = xKpAtTie + armDx * Math.cos(lockRad) - armDy * Math.sin(lockRad);
  const innerTieY = yKpAtTie + armDx * Math.sin(lockRad) + armDy * Math.cos(lockRad);
  const innerTieLen = Math.hypot(innerTieX - xRackMount, innerTieY - yRack, zTieOuter - zRack);
  const outerTieX = xKpAtTie + armDx * Math.cos(-outerLockRad) - armDy * Math.sin(-outerLockRad);
  const outerTieY = yKpAtTie + armDx * Math.sin(-outerLockRad) + armDy * Math.cos(-outerLockRad);
  const outerTieLen = Math.hypot(outerTieX - xRackMount, outerTieY - yRack, zTieOuter - zRack);

  const innerCompressRatio = Math.max(0.18, (tieRodLen - innerTieLen) / tieRodLen);
  const outerExtendRatio = Math.max(0.16, (outerTieLen - tieRodLen) / tieRodLen);
  const hydroRatio = round4(Math.min(0.46, innerCompressRatio));
  const hydroInLimit = round4(1 - hydroRatio);
  const hydroOutLimit = round4(1 + Math.min(0.42, outerExtendRatio));
  const wheelHalfLock = Math.round(tune.steeringWheelDeg / 2);

  // Spring, damper, ARB, anti-squat & chassis rigidity values (calibrated for BeamNG 2000 Hz solver stability)
  const frontSpringNm = Math.round(tune.frontSpringKn * 1000);
  const rearSpringNm = Math.round(tune.rearSpringKn * 1000);
  const frontBumpDamp = Math.min(1600, Math.round(tune.frontBumpDamping));
  const frontReboundDamp = Math.min(2200, Math.round(tune.frontReboundDamping));
  const rearBumpDamp = Math.min(1600, Math.round(tune.rearBumpDamping));
  const rearReboundDamp = Math.min(2200, Math.round(tune.rearReboundDamping));
  const frameRigidity = Math.min(1.25, Math.max(0.85, tune.chassisRigidity));
  const subframeSpring = Math.round(660000 * frameRigidity);
  const rackDamp = Math.min(140, Math.round(28 + tune.ffbDampingPct * 1.8));
  const ffbGainScale = round4((tune.ffbStrengthPct / 100) * (0.9 + (tune.frontCasterDeg - 5) * 0.03));

  // Rear anti-squat pickup geometry (higher antiSquatPct raises front link pickup toward IC)
  const zRearLinkFront = round4(0.25 + (tune.antiSquatPct / 100) * 0.12);

  // Exact 3D positions & finite-difference alignment/lock-stop coefficients
  const fx1rPos: Vec3 = [-0.31, round4(yF - 0.145), 0.255];
  const fx2rPos: Vec3 = [-0.31, round4(yF + 0.175), 0.255];
  const fu1rPos: Vec3 = [-0.345, round4(yF - 0.145), 0.64];
  const fu2rPos: Vec3 = [-0.345, round4(yF + 0.145), 0.64];
  const frk1rPos: Vec3 = [-xRackMount, yRack, zRack];
  const fsh1rPos: Vec3 = [-0.48, round4(yF + 0.008), 0.275];
  const flr1rPos: Vec3 = [-0.48, round4(yF + 0.008), 0.115];
  const fh1rPos: Vec3 = [-xLBJ, yLBJ, zLBJ];
  const fh2rPos: Vec3 = [-xUBJ, yUBJ, zUBJ];
  const fh3rPos: Vec3 = [-xTieOuter, yTieOuter, zTieOuter];
  const fh4rPos: Vec3 = [-xLBJ, round4(yF - 0.055), 0.445];
  const fh5rPos: Vec3 = [-xLBJ, round4(yF + 0.055), 0.445];
  const fw1rPos: Vec3 = [-xHubInF, round4(yF - dyToeF), round4(zHubCenterF - dzCamberF)];
  const fw1rrPos: Vec3 = [-xHubOutF, round4(yF + dyToeF), round4(zHubCenterF + dzCamberF)];

  // Front camber slope per +1 deg (rotating fw1rr around fw1r about +Y)
  const fw1rrCam1 = rotateAboutAxis3(fw1rrPos, fw1rPos, [0, 1, 0], -degToRad(1));
  const camberSlopeF = (knucklePos: Vec3) =>
    dist3(fw1rrCam1, knucklePos) / dist3(fw1rrPos, knucklePos) - 1;
  const camberSlopeF_fh1 = camberSlopeF(fh1rPos);
  const camberSlopeF_fh2 = camberSlopeF(fh2rPos);
  const camberSlopeF_fh3 = camberSlopeF(fh3rPos);
  const camberSlopeF_fh4 = camberSlopeF(fh4rPos);
  const camberSlopeF_fh5 = camberSlopeF(fh5rPos);

  // Front caster slope per +1 deg (tilting LBJ forward -Y and UBJ aft +Y equally around spindle Z)
  const dTanCaster = Math.tan(degToRad(tune.frontCasterDeg + 1)) - Math.tan(casterRad);
  const fh1rCas1: Vec3 = [fh1rPos[0], fh1rPos[1] - 0.5 * dzKingpin * dTanCaster, fh1rPos[2]];
  const fh2rCas1: Vec3 = [fh2rPos[0], fh2rPos[1] + 0.5 * dzKingpin * dTanCaster, fh2rPos[2]];
  const casterSlopeLca = (anchor: Vec3) => dist3(anchor, fh1rCas1) / dist3(anchor, fh1rPos) - 1;
  const casterSlopeUca = (anchor: Vec3) => dist3(anchor, fh2rCas1) / dist3(anchor, fh2rPos) - 1;

  // Front toe slope per +1 deg toe-IN (rotating fh3r CCW around kingpin axis at Z=zTieOuter)
  const kpTieR: Vec3 = [-xKpAtTie, yKpAtTie, zTieOuter];
  const fh3rToe1 = rotateAboutAxis3(fh3rPos, kpTieR, [0, 0, 1], degToRad(1));
  const toeSlopeF = dist3(frk1rPos, fh3rToe1) / dist3(frk1rPos, fh3rPos) - 1;

  // Physical lock-stop |SUPPORT & full-lock anti-shake damper bounds on fh3*-fx1* & fh5*-fx2*
  const kpAxisR: Vec3 = [fh2rPos[0] - fh1rPos[0], fh2rPos[1] - fh1rPos[1], fh2rPos[2] - fh1rPos[2]];
  const minSteerDist = (p: Vec3, anchor: Vec3, rad: number) =>
    Math.min(
      dist3(rotateAboutAxis3(p, fh1rPos, kpAxisR, rad), anchor),
      dist3(rotateAboutAxis3(p, fh1rPos, kpAxisR, -rad), anchor)
    );
  const dTieFx1_0 = dist3(fh3rPos, fx1rPos);
  const dEarFx2_0 = dist3(fh5rPos, fx2rPos);
  const stopPrecompTie = round4(
    Math.max(0.5, Math.min(0.95, minSteerDist(fh3rPos, fx1rPos, lockRad + degToRad(3)) / dTieFx1_0))
  );
  const stopPrecompEar = round4(
    Math.max(0.5, Math.min(0.95, minSteerDist(fh5rPos, fx2rPos, lockRad + degToRad(3)) / dEarFx2_0))
  );
  const shortTieRange = round4(
    Math.max(0.025, dTieFx1_0 - minSteerDist(fh3rPos, fx1rPos, Math.max(0.3, lockRad - degToRad(4))))
  );
  const shortEarRange = round4(
    Math.max(0.025, dEarFx2_0 - minSteerDist(fh5rPos, fx2rPos, Math.max(0.3, lockRad - degToRad(4))))
  );

  // Rear camber slope per +1 deg (rotating rh2 around rh1 about +Y) & rear toe slope per +1 deg toe-IN
  const rx2rPos: Vec3 = [-0.33, round4(yR + 0.18), 0.26];
  const ru1rPos: Vec3 = [-0.35, round4(yR - 0.175), 0.47];
  const ru2rPos: Vec3 = [-0.35, round4(yR + 0.175), 0.47];
  const rh1rPos: Vec3 = [-0.635, yR, 0.245];
  const rh2rPos: Vec3 = [-0.625, yR, 0.475];
  const rh5rPos: Vec3 = [-0.635, round4(yR + 0.105), 0.345];
  const rh2rCam1 = rotateAboutAxis3(rh2rPos, rh1rPos, [0, 1, 0], -degToRad(1));
  const camberSlopeR_ru1 = dist3(ru1rPos, rh2rCam1) / dist3(ru1rPos, rh2rPos) - 1;
  const camberSlopeR_ru2 = dist3(ru2rPos, rh2rCam1) / dist3(ru2rPos, rh2rPos) - 1;
  const rh5rToe1 = rotateAboutAxis3(rh5rPos, rh1rPos, [0, 0, 1], degToRad(1));
  const toeSlopeR = dist3(rx2rPos, rh5rToe1) / dist3(rx2rPos, rh5rPos) - 1;

  const controllerCfg = {
    steerLockDeg: '$dm_steer_lock',
    steerSpeed: '$dm_steer_speed',
    steerWheelDeg: '$dm_wheel_deg',
    ffbStrengthPct: '$dm_ffb_gain',
    ffbDampingPct: '$dm_ffb_damp',
    frontTirePsi: '$dm_front_psi',
    dampBumpF: '$damp_bump_F',
    dampReboundF: '$damp_rebound_F',
    dampBumpR: '$damp_bump_R',
    dampReboundR: '$damp_rebound_R',
    frontArbStiffness: '$dm_arb_spring_F',
    rearArbStiffness: '$dm_arb_spring_R',
    ackermannPct: '$dm_ackermann',
    kpiDeg: Number(tune.kpiDeg.toFixed(1)),
    casterDeg: '$dm_caster_F',
    camberF: '$dm_camber_F',
    camberR: '$dm_camber_R',
    toeF: '$dm_toe_F',
    toeR: '$dm_toe_R',
    springF: '$dm_spring_F',
    springR: '$dm_spring_R',
    arbBiasR: '$dm_arb_bias_R',
    antiSquatPct: '$dm_anti_squat',
    frontWeightPct: Number(tune.frontWeightPct.toFixed(1)),
    cageRigidity: '$dm_cage_rigidity',
    rearTireWidthMm: tune.rearTireWidthMm,
    rearTirePsi: '$dm_rear_psi',
    rearTireGrip: Number(tune.rearTireGrip.toFixed(2)),
    brakeBiasPct: '$dm_brake_bias',
    lsdLockPct: '$dm_lsd_lock',
    finalDriveRatio: '$dm_final_drive',
    turboBoostPsi: '$dm_boost_psi',
  };

  // 1. Front Double Wishbone Suspension + Drop Knuckles + Hubs + Wheeldata + Brakes
  const suspensionFJbeam = {
    [`${id}_driftmod_dw_suspension_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod Double Wishbone Front Suspension (${tune.steeringLockDeg}deg / ${tune.kpiDeg.toFixed(1)} KPI)`,
        value: 6200,
      },
      slotType: `${id}_suspension_F`,
      slots2: [
        ['name', 'allowTypes', 'denyTypes', 'default', 'description'],
        [`${id}_driftmod_subframe_F`, [`${id}_driftmod_subframe_F`], [], `${id}_driftmod_tubular_subframe_F`, 'Front Subframe', { coreSlot: true }],
        [`${id}_driftmod_steering_F`, [`${id}_driftmod_steering_F`], [], `${id}_driftmod_rack_F`, 'Steering Rack', { coreSlot: true }],
        [`${id}_driftmod_coilover_F`, [`${id}_driftmod_coilover_F`], [], `${id}_driftmod_coilover_F`, 'Front Coilovers', { coreSlot: true }],
        [`${id}_driftmod_swaybar_F`, [`${id}_driftmod_swaybar_F`], [], `${id}_driftmod_swaybar_F`, 'Front Sway Bar'],
        [`${id}_driftmod_hub_F`, [`${id}_driftmod_hub_F`], [], `${id}_driftmod_hub_F`, 'Front Drop-Knuckle Hubs', { coreSlot: true }],
        [`${id}_driftmod_wheeldata_F`, [`${id}_driftmod_wheeldata_F`], [], `${id}_driftmod_wheeldata_F`, 'Front Spindles', { coreSlot: true }],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$trackoffset_F', 'range', '+m', 'DriftMod Alignment', 0.0, -0.04, 0.06, 'Front Track Offset', 'Adjusts front hub offset'],
        ['$dm_caster_F', 'range', 'deg', 'DriftMod Alignment', Number(tune.frontCasterDeg.toFixed(1)), 3.5, 11.0, 'Front Caster', 'Front kingpin caster angle (self-aligning trail)'],
        ['$dm_camber_F', 'range', 'deg', 'DriftMod Alignment', tune.frontCamberDeg, -16.0, 0.0, 'Front Camber', 'Front static camber angle'],
        ['$dm_toe_F', 'range', 'deg', 'DriftMod Alignment', tune.frontToeDeg, -0.60, 0.30, 'Front Toe', 'Front static toe angle'],
        ['$dm_ackermann', 'range', '%', 'DriftMod Steering & FFB', tune.ackermannPct, -15, 100, 'Ackermann Geometry', 'Front steering toe difference'],
        ['$dm_front_psi', 'range', 'PSI', 'DriftMod Tires', tune.frontTirePsi, 12, 42, 'Front Tire Pressure', 'Target front tire air pressure'],
        ['$dm_cage_rigidity', 'range', 'x', 'DriftMod Chassis', Number(tune.chassisRigidity.toFixed(2)), 0.8, 1.5, 'Chromoly Rigidity', 'Front chassis/cage stiffness multiplier'],
        ['$dm_brake_bias', 'range', '%', 'DriftMod Brakes', tune.brakeBiasPct, 50, 75, 'Front Brake Bias', 'Dual-master front/rear brake split'],
      ],
      controller: [['fileName'], ['driftmod', controllerCfg]],
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_lca_FR', ['driftmod_lca_FR']],
        ['driftmod_lca_FL', ['driftmod_lca_FL']],
        ['driftmod_uca_FR', ['driftmod_uca_FR']],
        ['driftmod_uca_FL', ['driftmod_uca_FL']],
        ['driftmod_knuckle_FR', ['driftmod_knuckle_FR', 'wheelhub_FR']],
        ['driftmod_knuckle_FL', ['driftmod_knuckle_FL', 'wheelhub_FL']],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 5.5 },
        // Lower balljoints (LBJ)
        { group: ['driftmod_knuckle_FR', 'driftmod_lca_FR'] },
        ['fh1r', -xLBJ, yLBJ, zLBJ],
        { group: ['driftmod_knuckle_FL', 'driftmod_lca_FL'] },
        ['fh1l', xLBJ, yLBJ, zLBJ],
        // Inboard LCA coilover clevis mounts + non-coplanar 3D lower gusset nodes
        { nodeWeight: 13.5 },
        { group: ['driftmod_lca_FR', 'driftmod_coil_FR'] },
        ['fsh1r', -0.48, round4(yF + 0.008), 0.275],
        { group: ['driftmod_lca_FL', 'driftmod_coil_FL'] },
        ['fsh1l', 0.48, round4(yF + 0.008), 0.275],
        { nodeWeight: 8.5, group: '' },
        ['flr1r', -0.48, round4(yF + 0.008), 0.115],
        ['flr1l', 0.48, round4(yF + 0.008), 0.115],
        // Upper balljoints (UBJ - computed from KPI & Caster)
        { nodeWeight: 5.5 },
        { group: ['driftmod_knuckle_FR', 'driftmod_uca_FR'] },
        ['fh2r', -xUBJ, yUBJ, zUBJ],
        { group: ['driftmod_knuckle_FL', 'driftmod_uca_FL'] },
        ['fh2l', xUBJ, yUBJ, zUBJ],
        // Tie-rod knuckle arms & raised upright ears (clear of tie-rod arc at +/-70 deg)
        { group: 'driftmod_knuckle_FR' },
        ['fh3r', -xTieOuter, yTieOuter, zTieOuter],
        ['fh4r', -xLBJ, round4(yF - 0.055), 0.445],
        ['fh5r', -xLBJ, round4(yF + 0.055), 0.445],
        { group: 'driftmod_knuckle_FL' },
        ['fh3l', xTieOuter, yTieOuter, zTieOuter],
        ['fh4l', xLBJ, round4(yF - 0.055), 0.445],
        ['fh5l', xLBJ, round4(yF + 0.055), 0.445],
        // Upper coilover tower anchor nodes + triangulated cowl brace apex
        { nodeWeight: 14.0 },
        { group: ['driftmod_subframe_F', 'driftmod_coil_FR'] },
        ['fc1r', -0.36, round4(yF + 0.008), 0.77],
        { group: ['driftmod_subframe_F', 'driftmod_coil_FL'] },
        ['fc1l', 0.36, round4(yF + 0.008), 0.77],
        { nodeWeight: 8.5, group: 'driftmod_subframe_F' },
        ['fc0', 0.0, round4(yF + 0.18), 0.76],
        { group: '' },
      ],
      beams: [
        ['id1:', 'id2:'],
        // Drop-knuckle rigid upright structure (calibrated for 2000 Hz stability)
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 4200000, beamDamp: 180, beamDeform: 260000, beamStrength: 'FLT_MAX' },
        ['fh1r', 'fh2r'], ['fh1l', 'fh2l'],
        ['fh1r', 'fh3r'], ['fh1l', 'fh3l'],
        ['fh2r', 'fh3r'], ['fh2l', 'fh3l'],
        ['fh1r', 'fh4r'], ['fh1l', 'fh4l'],
        ['fh2r', 'fh4r'], ['fh2l', 'fh4l'],
        ['fh3r', 'fh4r'], ['fh3l', 'fh4l'],
        ['fh1r', 'fh5r'], ['fh1l', 'fh5l'],
        ['fh2r', 'fh5r'], ['fh2l', 'fh5l'],
        ['fh3r', 'fh5r'], ['fh3l', 'fh5l'],
        ['fh4r', 'fh5r'], ['fh4l', 'fh5l'],
        // Inner spindle pivot fh4->fw1 stays fixed at 1.0; outer spindle fw1rr/ll rotates smoothly for live camber
        { beamSpring: 12001000, beamDamp: 180, beamDeform: 280000, beamStrength: 1200000, dampCutoffHz: 500 },
        { breakGroup: 'wheel_FR', beamPrecompression: 1 },
        ['fw1r', 'fh4r'],
        ['fw1rr', 'fh4r', { beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh4), beamPrecompressionTime: 0.5 }],
        { breakGroup: 'wheel_FL', beamPrecompression: 1 },
        ['fw1l', 'fh4l'],
        ['fw1ll', 'fh4l', { beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh4), beamPrecompressionTime: 0.5 }],
        { breakGroup: '', beamPrecompression: 1 },

        // Formula Drift Double Wishbone Lower A-Arms & 3D bipyramid coilover clevis box (live caster on LBJ)
        { beamSpring: 2100000, beamDamp: 140, beamDeform: 220000, beamStrength: 900000, dampCutoffHz: 500 },
        ['fx1r', 'fh1r', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeLca(fx1rPos)), beamPrecompressionTime: 0.5 }],
        ['fx2r', 'fh1r', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeLca(fx2rPos)), beamPrecompressionTime: 0.5 }],
        ['fx1l', 'fh1l', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeLca(fx1rPos)), beamPrecompressionTime: 0.5 }],
        ['fx2l', 'fh1l', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeLca(fx2rPos)), beamPrecompressionTime: 0.5 }],
        // Close both lower-wishbone triangles with zero duplicate node pairs
        ['fx1r', 'fx2r'], ['fx1l', 'fx2l'],
        { beamSpring: 1400000, beamDamp: 140, beamDeform: 260000, beamStrength: 1100000, dampCutoffHz: 500 },
        ['fsh1r', 'fx1r'], ['fsh1r', 'fx2r'], ['fsh1r', 'flr1r'],
        ['fsh1r', 'fh1r', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeLca(fsh1rPos)), beamPrecompressionTime: 0.5 }],
        ['fx1r', 'flr1r'], ['fx2r', 'flr1r'],
        ['flr1r', 'fh1r', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeLca(flr1rPos)), beamPrecompressionTime: 0.5 }],
        ['fsh1l', 'fx1l'], ['fsh1l', 'fx2l'], ['fsh1l', 'flr1l'],
        ['fsh1l', 'fh1l', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeLca(fsh1rPos)), beamPrecompressionTime: 0.5 }],
        ['fx1l', 'flr1l'], ['fx2l', 'flr1l'],
        ['flr1l', 'fh1l', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeLca(flr1rPos)), beamPrecompressionTime: 0.5 }],

        // Formula Drift Double Wishbone Upper A-Arms (fu1/fu2 -> fh2, ~77-82% of LCA length, live caster on UBJ)
        { beamSpring: 2600000, beamDamp: 140, beamDeform: 220000, beamStrength: 900000, dampCutoffHz: 500 },
        ['fu1r', 'fh2r', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeUca(fu1rPos)), beamPrecompressionTime: 0.5 }],
        ['fu2r', 'fh2r', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeUca(fu2rPos)), beamPrecompressionTime: 0.5 }],
        ['fu1l', 'fh2l', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeUca(fu1rPos)), beamPrecompressionTime: 0.5 }],
        ['fu2l', 'fh2l', { beamPrecompression: precompExpr('$dm_caster_F', tune.frontCasterDeg, casterSlopeUca(fu2rPos)), beamPrecompressionTime: 0.5 }],

        // Suspension anti-invert & physical steering lock-stop limiters
        { beamPrecompression: 1, beamType: '|BOUNDED', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 0, beamDamp: 0, beamDeform: 45000, beamStrength: 400000, beamLimitSpring: 251000, beamLimitDamp: 250, dampCutoffHz: 500 },
        ['fh1r', 'fu1r', { longBoundRange: 0.14, shortBoundRange: 0.14, boundZone: 0.03 }],
        ['fh1l', 'fu1l', { longBoundRange: 0.14, shortBoundRange: 0.14, boundZone: 0.03 }],
        { beamType: '|SUPPORT', beamLongBound: 2.0, beamShortBound: 1.0 },
        { beamSpring: 951000, beamDamp: 120, beamDeform: 85000, beamStrength: 450000, dampCutoffHz: 500 },
        ['fh3r', 'fx1r', { beamPrecompression: stopPrecompTie }],
        ['fh3l', 'fx1l', { beamPrecompression: stopPrecompTie }],
        ['fh5r', 'fx2r', { beamPrecompression: stopPrecompEar }],
        ['fh5l', 'fx2l', { beamPrecompression: stopPrecompEar }],

        // Triangulated strut tower cross-brace & firewall V-brace (prevents cornering camber flex)
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 1051000, beamDamp: 90, beamDeform: 240000, beamStrength: 'FLT_MAX' },
        ['fc1r', 'fu1r'], ['fc1r', 'fu2r'], ['fc1r', 'fx4r'], ['fc1r', 'fc1l'],
        ['fc1l', 'fu1l'], ['fc1l', 'fu2l'], ['fc1l', 'fx4l'],
        ['fc1r', 'fx4l'], ['fc1l', 'fx4r'],
        ['fc1r', 'fc0'], ['fc1l', 'fc0'], ['fc0', 'fx2r'], ['fc0', 'fx2l'],
        ['fc1r', 'fu1l'], ['fc1l', 'fu1r'],
        ['fc1r', 'fu2l'], ['fc1l', 'fu2r'],
        ['fc1r', 'fx1r'], ['fc1l', 'fx1l'],
        ['fc1r', 'fx2r'], ['fc1l', 'fx2l'],
        ['fc0', 'fu2r'], ['fc0', 'fu2l'],
        ['fc0', 'fu1r'], ['fc0', 'fu1l'],
        // Stock BX heavy strut tower tie-in only (6.75kg fs1r/l); never tie into 1.5kg f14rr/f5r
        { optional: true, beamSpring: 651000, beamDamp: 45, beamDeform: 45000, beamStrength: 350000 },
        ['fc1r', 'fs1r'],
        ['fc1l', 'fs1l'],
        ['fs1r', 'fs1l'],
        { beamType: '|NORMAL', optional: false },
      ],
    },
    [`${id}_driftmod_hub_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: 'DriftMod 5-Lug Drop-Knuckle Front Hubs',
        value: 850,
      },
      slotType: `${id}_driftmod_hub_F`,
      slots2: [
        ['name', 'allowTypes', 'denyTypes', 'default', 'description'],
        [`${id}_driftmod_brake_F`, [`${id}_driftmod_brake_F`], [], `${id}_driftmod_brake_F`, 'Front Drift Brakes', { coreSlot: true }],
        ['wheel_F_5', ['wheel_F_5'], [], 'steelwheel_01a_15x7_F', 'Front Wheels (5-Lug)', { nodeOffset: { x: '$=$trackoffset_F+0.385', y: round4(yF + 0.005), z: zHubCenterF } }],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: true, collision: true, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 7.5 },
        // Hub nodes must live in the stock wheelhub_* groups: the wheel rim mesh, the hub
        // pressureWheels cluster and the brake-hub flexbody all bind to those group names, so
        // any other group name renders a bare tire with no rim.
        { group: 'wheelhub_FR' },
        ['fw1r', -xHubInF, round4(yF - dyToeF), round4(zHubCenterF - dzCamberF)],
        ['fw1rr', -xHubOutF, round4(yF + dyToeF), round4(zHubCenterF + dzCamberF)],
        { group: 'wheelhub_FL' },
        ['fw1l', xHubInF, round4(yF - dyToeF), round4(zHubCenterF - dzCamberF)],
        ['fw1ll', xHubOutF, round4(yF + dyToeF), round4(zHubCenterF + dzCamberF)],
        { group: '' },
      ],
      // Hub cluster generated around the spindle exactly as the stock bx_hub_F_5 does. Without
      // this block the hub has no beam cluster, the wheel is held by two stiff beams only and
      // the corner folds under the car's own weight.
      pressureWheels: [
        ['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'],
        { disableMeshBreaking: false, disableHubMeshBreaking: false, enableHubcaps: false, hasTire: false },
        { hubRadius: 0.08 },
        { wheelOffset: -0.05 },
        { hubWidth: 0.05 },
        { numRays: 8 },
        { hubTreadBeamSpring: 501000, hubTreadBeamDamp: 5 },
        { hubPeripheryBeamSpring: 501000, hubPeripheryBeamDamp: 5 },
        { hubSideBeamSpring: 801000, hubSideBeamDamp: 5 },
        { hubNodeWeight: 0.4 },
        { hubNodeMaterial: '|NM_METAL' },
        { hubFrictionCoef: 0.2 },
        { hubBeamDeform: 45500, hubBeamStrength: 87500 },
      ],
      torsionbars: [
        ['id1:', 'id2:', 'id3:', 'id4:'],
        { spring: 50000, damp: 1, deform: 25000, strength: 100000 },
        // Rigidify the upright, as the stock front suspension does
        ['fw1rr', 'fh4r', 'fh1r', 'fh3r'],
        ['fw1ll', 'fh4l', 'fh1l', 'fh3l'],
      ],
      beams: [
        ['id1:', 'id2:'],
        // Single-authority knuckle->hub attachment (fw1*-fh4* lives in dw_suspension_F with no duplicates)
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 12001000, beamDamp: 180, beamDeform: 180000, beamStrength: 520000, dampCutoffHz: 500 },
        { breakGroup: 'wheel_FR' },
        ['fw1r', 'fh1r', { name: 'axle_FR' }],
        ['fw1r', 'fh3r', { beamSpring: 15001000, beamDamp: 110 }],
        ['fw1r', 'fh5r', { beamSpring: 6001000, beamDamp: 50 }],
        ['fw1r', 'fh2r', { beamSpring: 11001000, beamDamp: 75 }],
        ['fw1rr', 'fh1r', { beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh1), beamPrecompressionTime: 0.5 }],
        ['fw1rr', 'fh3r', { beamSpring: 15001000, beamDamp: 110, beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh3), beamPrecompressionTime: 0.5 }],
        ['fw1rr', 'fh5r', { beamSpring: 6001000, beamDamp: 50, beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh5), beamPrecompressionTime: 0.5 }],
        ['fw1rr', 'fh2r', { beamSpring: 11001000, beamDamp: 75, beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh2), beamPrecompressionTime: 0.5 }],
        { breakGroup: 'wheel_FL' },
        ['fw1l', 'fh1l', { name: 'axle_FL' }],
        ['fw1l', 'fh3l', { beamSpring: 15001000, beamDamp: 110 }],
        ['fw1l', 'fh5l', { beamSpring: 6001000, beamDamp: 50 }],
        ['fw1l', 'fh2l', { beamSpring: 11001000, beamDamp: 75 }],
        ['fw1ll', 'fh1l', { beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh1), beamPrecompressionTime: 0.5 }],
        ['fw1ll', 'fh3l', { beamSpring: 15001000, beamDamp: 110, beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh3), beamPrecompressionTime: 0.5 }],
        ['fw1ll', 'fh5l', { beamSpring: 6001000, beamDamp: 50, beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh5), beamPrecompressionTime: 0.5 }],
        ['fw1ll', 'fh2l', { beamSpring: 11001000, beamDamp: 75, beamPrecompression: precompExpr('$dm_camber_F', tune.frontCamberDeg, camberSlopeF_fh2), beamPrecompressionTime: 0.5 }],
        { breakGroup: '', beamPrecompression: 1 },
      ],
    },
    [`${id}_driftmod_wheeldata_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: 'DriftMod Front Spindle Wheel Interface',
        value: 150,
      },
      slotType: `${id}_driftmod_wheeldata_F`,
      pressureWheels: [
        ['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'],
        { selfCollision: false, collision: true, disableMeshBreaking: false, disableHubMeshBreaking: false },
        { brakeTorque: '$=$braketorque_F', parkingTorque: 0, propulsed: 0 },
        { hubcapBreakGroup: 'hubcap_FR', hubcapGroup: 'hubcap_FR', axleBeams: ['axle_FR'] },
        ['FR', 'wheel_FR', 'tire_FR', 'fw1rr', 'fw1r', 9999, 'fh5r', 1, { 'torqueCoupling:': 'fh1r', 'torqueArm:': 'fh4r', 'torqueArm2:': 'fw1rr', 'steerAxisUp:': 'fh2r', 'steerAxisDown:': 'fh1r' }],
        { hubcapBreakGroup: 'hubcap_FL', hubcapGroup: 'hubcap_FL', axleBeams: ['axle_FL'] },
        ['FL', 'wheel_FL', 'tire_FL', 'fw1ll', 'fw1l', 9999, 'fh5l', -1, { 'torqueCoupling:': 'fh1l', 'torqueArm:': 'fh4l', 'torqueArm2:': 'fw1ll', 'steerAxisUp:': 'fh2l', 'steerAxisDown:': 'fh1l' }],
        { selfCollision: true, axleBeams: [], disableMeshBreaking: false, disableTriangleBreaking: false, hubcapBreakGroup: '', hubcapGroup: '' },
        { enableHubcaps: false, enableTireLbeams: false, enableTireSideReinfBeams: false, enableTireReinfBeams: false, enableTreadReinfBeams: false, enableTirePeripheryReinfBeams: false },
        { loadSensitivitySlope: '', noLoadCoef: '', fullLoadCoef: '', frictionCoef: '', slidingFrictionCoef: '', softnessCoef: 0.5, treadCoef: 1.0 },
        { brakeTorque: 0, parkingTorque: 0, propulsed: 0, enableBrakeThermals: false, brakeDiameter: false, brakeMass: false, brakeType: false, rotorMaterial: false, brakeVentingCoef: false },
      ],
      powertrain: [
        ['type', 'name', 'inputName', 'inputIndex'],
        ['shaft', 'wheelaxleFL', 'differential_F', 1, { connectedWheel: 'FL', breakTriggerBeam: 'axle_FL', uiName: 'Front Left Axle', friction: 0.94, dynamicFriction: 0.002 }],
        ['shaft', 'wheelaxleFR', 'differential_F', 2, { connectedWheel: 'FR', breakTriggerBeam: 'axle_FR', uiName: 'Front Right Axle', friction: 0.94, dynamicFriction: 0.002 }],
      ],
    },
    [`${id}_driftmod_brake_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: 'DriftMod 6-Piston Front Drift Calipers',
        value: 950,
      },
      slotType: `${id}_driftmod_brake_F`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_rotor_FR', ['driftmod_knuckle_FR', 'wheelhub_FR']],
        ['driftmod_rotor_FL', ['driftmod_knuckle_FL', 'wheelhub_FL']],
        ['driftmod_brake_FR', ['driftmod_knuckle_FR', 'wheelhub_FR']],
        ['driftmod_brake_FL', ['driftmod_knuckle_FL', 'wheelhub_FL']],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$braketorque_F', 'range', 'Nm', 'DriftMod Brakes', 2650, 1200, 4200, 'Front Brake Torque', '6-piston front caliper peak clamping torque'],
      ],
    },
  };

  // 2. Selectable Front Subframes (Tubular Chromoly & Reinforced Street)
  const subframeFJbeam = {
    [`${id}_driftmod_tubular_subframe_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod Chromoly Tubular Front Subframe (${tune.chassisRigidity.toFixed(2)}x Rigidity)`,
        value: 2400,
      },
      slotType: `${id}_driftmod_subframe_F`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_subframe_F', ['driftmod_subframe_F']],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 12.0 },
        { group: ['driftmod_subframe_F', 'driftmod_lca_FR'] },
        ['fx1r', -0.31, round4(yF - 0.145), 0.255],
        ['fx2r', -0.31, round4(yF + 0.175), 0.255],
        { group: ['driftmod_subframe_F', 'driftmod_lca_FL'] },
        ['fx1l', 0.31, round4(yF - 0.145), 0.255],
        ['fx2l', 0.31, round4(yF + 0.175), 0.255],
        // Front engine mount nodes aligned statically with stock bx_engine mounts (no self-slidenode snap)
        { nodeWeight: 4.5, group: 'driftmod_subframe_F' },
        ['fx6r', -0.23, round4(yF - 0.032), 0.285],
        ['fx6l', 0.23, round4(yF - 0.032), 0.285],
        { nodeWeight: 8.5 },
        { group: ['driftmod_subframe_F', 'driftmod_uca_FR', 'driftmod_coil_FR'] },
        ['fu1r', -0.345, round4(yF - 0.145), 0.64],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FR'] },
        ['fu2r', -0.345, round4(yF + 0.145), 0.64],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FL', 'driftmod_coil_FL'] },
        ['fu1l', 0.345, round4(yF - 0.145), 0.64],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FL'] },
        ['fu2l', 0.345, round4(yF + 0.145), 0.64],
        // Dedicated steering rack inner pivots (matched to LCA X=0.31 & tie-rod Z=0.315)
        { nodeWeight: 9.5, group: 'driftmod_subframe_F' },
        ['frk1r', -xRackMount, yRack, zRack],
        ['frk1l', xRackMount, yRack, zRack],
        { nodeWeight: 7.5, group: 'driftmod_subframe_F' },
        // Stock firewall/chassis subframe mount ears (fx3r/l at [-/+0.38, yF+0.15, 0.40], fx4r/l at [-/+0.40, yF-0.05, 0.40])
        ['fx3r', -0.38, round4(yF + 0.15), 0.4],
        ['fx3l', 0.38, round4(yF + 0.15), 0.4],
        ['fx4r', -0.4, round4(yF - 0.05), 0.4],
        ['fx4l', 0.4, round4(yF - 0.05), 0.4],
        { group: '' },
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: subframeSpring, beamDamp: 45, beamDeform: 165000, beamStrength: 900000 },
        // Lower subframe perimeter & X-bracing (fx1*-fx2* longitudinal rails owned by dw_suspension_F)
        ['fx1r', 'fx1l'], ['fx2r', 'fx2l'],
        ['fx1r', 'fx2l'], ['fx1l', 'fx2r'],
        // Engine mount nodes braced solidly to lower & upper subframe
        { beamSpring: 751000, beamDamp: 45 },
        ['fx6r', 'fx6l'], ['fx6r', 'fx2r'], ['fx6r', 'fx4r'], ['fx6r', 'frk1r'], ['fx6r', 'fx1r'],
        ['fx6l', 'fx2l'], ['fx6l', 'fx4l'], ['fx6l', 'frk1l'], ['fx6l', 'fx1l'],
        ['fx6r', 'fx1l'], ['fx6l', 'fx1r'],
        // Dedicated steering rack cradle braced to lower, firewall & upper subframe
        { beamSpring: subframeSpring, beamDamp: 45 },
        ['frk1r', 'frk1l'], ['frk1r', 'fx1r'], ['frk1r', 'fx2r'], ['frk1r', 'fx3r'], ['frk1r', 'fx4r'],
        ['frk1l', 'fx1l'], ['frk1l', 'fx2l'], ['frk1l', 'fx3l'], ['frk1l', 'fx4l'],
        ['frk1r', 'fu1r'], ['frk1r', 'fu2r'], ['frk1l', 'fu1l'], ['frk1l', 'fu2l'],
        ['frk1r', 'fx1l'], ['frk1l', 'fx1r'], ['frk1r', 'fx2l'], ['frk1l', 'fx2r'],
        // Firewall mounts braced to subframe
        ['fx3r', 'fx3l'], ['fx3r', 'fx2r'], ['fx3r', 'fx1r'], ['fx3r', 'fu2r'], ['fx3r', 'fu1r'],
        ['fx3l', 'fx2l'], ['fx3l', 'fx1l'], ['fx3l', 'fu2l'], ['fx3l', 'fu1l'],
        ['fx3r', 'fx2l'], ['fx3l', 'fx2r'],
        // Upper wishbone cradle & 3D spaceframe triangulation (stops cradle shear and folding)
        ['fu1r', 'fu2r'], ['fu1l', 'fu2l'], ['fu1r', 'fx1r'], ['fu2r', 'fx2r'],
        ['fu1r', 'fx2r'], ['fu2r', 'fx1r'], ['fu1l', 'fx1l'], ['fu2l', 'fx2l'],
        ['fu1l', 'fx2l'], ['fu2l', 'fx1l'],
        ['fu1r', 'fu1l'], ['fu2r', 'fu2l'],
        ['fu1r', 'fu2l'], ['fu1l', 'fu2r'],
        ['fu1r', 'fx1l'], ['fu1l', 'fx1r'],
        ['fu2r', 'fx2l'], ['fu2l', 'fx2r'],
        ['fu1r', 'fx2l'], ['fu1l', 'fx2r'],
        ['fu2r', 'fx1l'], ['fu2l', 'fx1r'],
        // Outer ear triangulation
        ['fx4r', 'fx4l'], ['fx4r', 'fx1r'], ['fx4r', 'fu1r'], ['fx4r', 'fx3r'],
        ['fx4l', 'fx1l'], ['fx4l', 'fu1l'], ['fx4l', 'fx3l'],
        ['fx4r', 'fu2r'], ['fx4l', 'fu2l'],
        ['fx4r', 'fx2r'], ['fx4l', 'fx2l'],
        // Stock BX subframemount_FR / FL breakGroup tie-ins (951 kN/m keeps unibody Σk/m comfortably in pass zone)
        { optional: true, beamSpring: 951000, beamDamp: 65, beamDeform: 90000, beamStrength: 750000 },
        { breakGroup: 'subframemount_FR' },
        ['fx1r', 'f10rr'], ['fx1r', 'f11rr'], ['fx1r', 'f12rr'], ['fx1r', 'f13rr'], ['fx1r', 'f11'],
        ['fx2r', 'f1r'], ['fx2r', 'f11rr'],
        ['fx3r', 'f1r'], ['fx3r', 'f5r'], ['fx3r', 'f10rr'], ['fx3r', 'f12rr'],
        ['fx4r', 'f10rr'], ['fx4r', 'f12rr'], ['fx4r', 'f1r'], ['fx4r', 'f5r'],
        { breakGroup: 'subframemount_FL' },
        ['fx1l', 'f10ll'], ['fx1l', 'f11ll'], ['fx1l', 'f12ll'], ['fx1l', 'f13ll'], ['fx1l', 'f11'],
        ['fx2l', 'f1l'], ['fx2l', 'f11ll'],
        ['fx3l', 'f1l'], ['fx3l', 'f5l'], ['fx3l', 'f10ll'], ['fx3l', 'f12ll'],
        ['fx4l', 'f10ll'], ['fx4l', 'f12ll'], ['fx4l', 'f1l'], ['fx4l', 'f5l'],
        { breakGroup: '' },
        // Anti-collapse support limiters against floor/firewall
        { beamPrecompression: 1.0, beamType: '|SUPPORT', beamLongBound: 2.0 },
        { beamSpring: 651000, beamDamp: 60, beamDeform: 65000, beamStrength: 450000 },
        ['fx2r', 'f6r'], ['fx2l', 'f6l'],
        ['fx3r', 'f6r'], ['fx3l', 'f6l'],
        { beamType: '|NORMAL', optional: false },
      ],
    },
    [`${id}_driftmod_street_subframe_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: 'DriftMod Gusseted OEM-Style Double Wishbone Subframe',
        value: 1450,
      },
      slotType: `${id}_driftmod_subframe_F`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_subframe_F', ['driftmod_subframe_F']],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 12.5 },
        { group: ['driftmod_subframe_F', 'driftmod_lca_FR'] },
        ['fx1r', -0.31, round4(yF - 0.145), 0.255],
        ['fx2r', -0.31, round4(yF + 0.175), 0.255],
        { group: ['driftmod_subframe_F', 'driftmod_lca_FL'] },
        ['fx1l', 0.31, round4(yF - 0.145), 0.255],
        ['fx2l', 0.31, round4(yF + 0.175), 0.255],
        { nodeWeight: 4.5, group: 'driftmod_subframe_F' },
        ['fx6r', -0.23, round4(yF - 0.032), 0.285],
        ['fx6l', 0.23, round4(yF - 0.032), 0.285],
        { nodeWeight: 8.5 },
        { group: ['driftmod_subframe_F', 'driftmod_uca_FR', 'driftmod_coil_FR'] },
        ['fu1r', -0.345, round4(yF - 0.145), 0.64],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FR'] },
        ['fu2r', -0.345, round4(yF + 0.145), 0.64],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FL', 'driftmod_coil_FL'] },
        ['fu1l', 0.345, round4(yF - 0.145), 0.64],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FL'] },
        ['fu2l', 0.345, round4(yF + 0.145), 0.64],
        { nodeWeight: 9.5, group: 'driftmod_subframe_F' },
        ['frk1r', -xRackMount, yRack, zRack],
        ['frk1l', xRackMount, yRack, zRack],
        { nodeWeight: 7.5, group: 'driftmod_subframe_F' },
        ['fx3r', -0.38, round4(yF + 0.15), 0.4],
        ['fx3l', 0.38, round4(yF + 0.15), 0.4],
        ['fx4r', -0.4, round4(yF - 0.05), 0.4],
        ['fx4l', 0.4, round4(yF - 0.05), 0.4],
        { group: '' },
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: Math.round(subframeSpring * 0.9), beamDamp: 45, beamDeform: 140000, beamStrength: 820000 },
        ['fx1r', 'fx1l'], ['fx2r', 'fx2l'],
        ['fx1r', 'fx2l'], ['fx1l', 'fx2r'],
        { beamSpring: 751000, beamDamp: 45 },
        ['fx6r', 'fx6l'], ['fx6r', 'fx2r'], ['fx6r', 'fx4r'], ['fx6r', 'frk1r'], ['fx6r', 'fx1r'],
        ['fx6l', 'fx2l'], ['fx6l', 'fx4l'], ['fx6l', 'frk1l'], ['fx6l', 'fx1l'],
        ['fx6r', 'fx1l'], ['fx6l', 'fx1r'],
        { beamSpring: Math.round(subframeSpring * 0.9), beamDamp: 45 },
        ['frk1r', 'frk1l'], ['frk1r', 'fx1r'], ['frk1r', 'fx2r'], ['frk1r', 'fx3r'], ['frk1r', 'fx4r'],
        ['frk1l', 'fx1l'], ['frk1l', 'fx2l'], ['frk1l', 'fx3l'], ['frk1l', 'fx4l'],
        ['frk1r', 'fu1r'], ['frk1r', 'fu2r'], ['frk1l', 'fu1l'], ['frk1l', 'fu2l'],
        ['frk1r', 'fx1l'], ['frk1l', 'fx1r'], ['frk1r', 'fx2l'], ['frk1l', 'fx2r'],
        ['fx3r', 'fx3l'], ['fx3r', 'fx2r'], ['fx3r', 'fx1r'], ['fx3r', 'fu2r'], ['fx3r', 'fu1r'],
        ['fx3l', 'fx2l'], ['fx3l', 'fx1l'], ['fx3l', 'fu2l'], ['fx3l', 'fu1l'],
        ['fx3r', 'fx2l'], ['fx3l', 'fx2r'],
        ['fu1r', 'fu2r'], ['fu1l', 'fu2l'], ['fu1r', 'fx1r'], ['fu2r', 'fx2r'],
        ['fu1r', 'fx2r'], ['fu2r', 'fx1r'], ['fu1l', 'fx1l'], ['fu2l', 'fx2l'],
        ['fu1l', 'fx2l'], ['fu2l', 'fx1l'],
        ['fu1r', 'fu1l'], ['fu2r', 'fu2l'],
        ['fu1r', 'fu2l'], ['fu1l', 'fu2r'],
        ['fu1r', 'fx1l'], ['fu1l', 'fx1r'],
        ['fu2r', 'fx2l'], ['fu2l', 'fx2r'],
        ['fu1r', 'fx2l'], ['fu1l', 'fx2r'],
        ['fu2r', 'fx1l'], ['fu2l', 'fx1r'],
        ['fx4r', 'fx4l'], ['fx4r', 'fx1r'], ['fx4r', 'fu1r'], ['fx4r', 'fx3r'],
        ['fx4l', 'fx1l'], ['fx4l', 'fu1l'], ['fx4l', 'fx3l'],
        ['fx4r', 'fu2r'], ['fx4l', 'fu2l'],
        ['fx4r', 'fx2r'], ['fx4l', 'fx2l'],
        { optional: true, beamSpring: 951000, beamDamp: 65, beamDeform: 90000, beamStrength: 750000 },
        { breakGroup: 'subframemount_FR' },
        ['fx1r', 'f10rr'], ['fx1r', 'f11rr'], ['fx1r', 'f12rr'], ['fx1r', 'f13rr'], ['fx1r', 'f11'],
        ['fx2r', 'f1r'], ['fx2r', 'f11rr'],
        ['fx3r', 'f1r'], ['fx3r', 'f5r'], ['fx3r', 'f10rr'], ['fx3r', 'f12rr'],
        ['fx4r', 'f10rr'], ['fx4r', 'f12rr'], ['fx4r', 'f1r'], ['fx4r', 'f5r'],
        { breakGroup: 'subframemount_FL' },
        ['fx1l', 'f10ll'], ['fx1l', 'f11ll'], ['fx1l', 'f12ll'], ['fx1l', 'f13ll'], ['fx1l', 'f11'],
        ['fx2l', 'f1l'], ['fx2l', 'f11ll'],
        ['fx3l', 'f1l'], ['fx3l', 'f5l'], ['fx3l', 'f10ll'], ['fx3l', 'f12ll'],
        ['fx4l', 'f10ll'], ['fx4l', 'f12ll'], ['fx4l', 'f1l'], ['fx4l', 'f5l'],
        { breakGroup: '' },
        { beamPrecompression: 1.0, beamType: '|SUPPORT', beamLongBound: 2.0 },
        { beamSpring: 651000, beamDamp: 60, beamDeform: 65000, beamStrength: 450000 },
        ['fx2r', 'f12rr'], ['fx2l', 'f12ll'],
        ['fx2r', 'f6r'], ['fx2l', 'f6l'],
        ['fx3r', 'f6r'], ['fx3l', 'f6l'],
        { beamType: '|NORMAL', optional: false },
      ],
    },
  };

  // 3. Selectable Steering Rack + 900° FFB Calibration + Ackermann Tie Rods
  const steeringFJbeam = {
    [`${id}_driftmod_rack_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod ${tune.steeringLockDeg}deg Quick-Ratio Drift Rack (${tune.ackermannPct}% Ack / ${tune.steeringWheelDeg} FFB)`,
        value: 1650,
      },
      slotType: `${id}_driftmod_steering_F`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_steering_F', ['driftmod_subframe_F']],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$dm_steer_lock', 'range', 'deg', 'DriftMod Steering & FFB', tune.steeringLockDeg, 40, 72, 'Max Steering Lock', 'Physical knuckle lock target'],
        ['$dm_steer_speed', 'range', 'x', 'DriftMod Steering & FFB', Number(tune.steeringSpeed.toFixed(2)), 0.6, 1.8, 'Rack Speed Multiplier', 'Countersteer hydro in/out rate multiplier'],
        ['$dm_wheel_deg', 'range', 'deg', 'DriftMod Steering & FFB', tune.steeringWheelDeg, 540, 1080, 'FFB Wheel Rotation', 'Physical wheel lock-to-lock (900 for DD/belt wheels)'],
        ['$dm_ffb_gain', 'range', '%', 'DriftMod Steering & FFB', tune.ffbStrengthPct, 60, 160, 'FFB Self-Steer Gain', 'Self-aligning torque strength on wheel release'],
        ['$dm_ffb_damp', 'range', '%', 'DriftMod Steering & FFB', tune.ffbDampingPct, 0, 60, 'Steering Rack Damping', 'Smooths high-frequency DD wheel oscillation'],
        ['$dm_ackermann', 'range', '%', 'DriftMod Steering & FFB', tune.ackermannPct, -15, 100, 'Ackermann Geometry', 'Live Ackermann / anti-Ackermann steering trim'],
        ['$steer_center_F', 'range', '', 'DriftMod Alignment', 0, -0.004, 0.004, 'Steering L/R Trim', 'Fine-tunes steering wheel centerpoint'],
      ],
      beams: [
        ['id1:', 'id2:'],
        // Velocity-split steering dampers (crisp caster self-steer at low speed, chatter suppression at high speed)
        { beamPrecompression: 1.0, beamType: '|BOUNDED', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamLimitSpring: 0, beamLimitDamp: 0, beamSpring: 0, beamDamp: rackDamp, beamDeform: 'FLT_MAX', beamStrength: 'FLT_MAX' },
        ['frk1r', 'fh3r', { beamDampVelocitySplit: 0.16, beamDampFast: 1250, dampCutoffHz: 500 }],
        ['frk1l', 'fh3l', { beamDampVelocitySplit: 0.16, beamDampFast: 1250, dampCutoffHz: 500 }],
        ['fh5r', 'fx2r', { beamDampVelocitySplit: 0.16, beamDampFast: 1250, dampCutoffHz: 500 }],
        ['fh5l', 'fx2l', { beamDampVelocitySplit: 0.16, beamDampFast: 1250, dampCutoffHz: 500 }],
        // Full-lock anti-shake dampers (prevents wheel hop/wobble near full drift angle without binding return)
        { beamDeform: 25000, beamStrength: 90000, beamLimitSpring: 0, beamSpring: 0, beamDamp: 0, beamDampRebound: 0 },
        ['fh3r', 'fx1r', { longBoundRange: 1, shortBoundRange: shortTieRange, boundZone: 0.035, beamLimitDamp: 3200, beamLimitDampRebound: 800, dampCutoffHz: 250 }],
        ['fh3l', 'fx1l', { longBoundRange: 1, shortBoundRange: shortTieRange, boundZone: 0.035, beamLimitDamp: 3200, beamLimitDampRebound: 800, dampCutoffHz: 250 }],
        ['fh5r', 'fx2r', { longBoundRange: 1, shortBoundRange: shortEarRange, boundZone: 0.035, beamLimitDamp: 3200, beamLimitDampRebound: 800, dampCutoffHz: 250 }],
        ['fh5l', 'fx2l', { longBoundRange: 1, shortBoundRange: shortEarRange, boundZone: 0.035, beamLimitDamp: 3200, beamLimitDampRebound: 800, dampCutoffHz: 250 }],
        { beamPrecompression: 1.0, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
      ],
      hydros: [
        ['id1:', 'id2:'],
        {
          beamType: '|NORMAL',
          beamLongBound: 1.0,
          beamShortBound: 1.0,
          beamSpring: 9501000,
          beamDamp: 55,
          beamDeform: 240000,
          beamStrength: 900000,
          factor: -hydroRatio,
          steeringWheelLock: wheelHalfLock,
          inRate: round4(1.85 * tune.steeringSpeed),
          outRate: round4(1.85 * tune.steeringSpeed),
          inputSource: 'steering_input',
          ffCoef: ffbGainScale,
        },
        ['frk1r', 'fh3r', { factor: -hydroRatio, inLimit: hydroInLimit, outLimit: hydroOutLimit, beamPrecompression: precompExpr('$dm_toe_F', tune.frontToeDeg, toeSlopeF, '+$steer_center_F'), beamPrecompressionTime: 0.5 }],
        ['frk1l', 'fh3l', { factor: hydroRatio, inLimit: hydroInLimit, outLimit: hydroOutLimit, beamPrecompression: precompExpr('$dm_toe_F', tune.frontToeDeg, toeSlopeF, '-$steer_center_F'), beamPrecompressionTime: 0.5 }],
      ],
      input: {
        FFBcoef: `$=$ffbstrength*${round4(9 * ffbGainScale)}`,
      },
    },
  };

  // 4. Selectable Front Coilovers & Torsionbar Front Sway Bar
  const coiloverFJbeam = {
    [`${id}_driftmod_coilover_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod 2-Way Front Drift Coilovers (${tune.frontSpringKn} kN/m)`,
        value: 1400,
      },
      slotType: `${id}_driftmod_coilover_F`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_coilover_FR', ['driftmod_coil_FR', 'driftmod_subframe_F']],
        ['driftmod_coilover_FL', ['driftmod_coil_FL', 'driftmod_subframe_F']],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$dm_spring_F', 'range', 'N/m', 'DriftMod Coilovers', frontSpringNm, 35000, 110000, 'Front Spring Rate', 'Front coilover wheel spring rate'],
        ['$damp_bump_F', 'range', 'N/m/s', 'DriftMod Coilovers', Math.min(1600, frontBumpDamp), 600, 1600, 'Front Bump Damping', 'Low-speed compression wheel damping'],
        ['$damp_rebound_F', 'range', 'N/m/s', 'DriftMod Coilovers', Math.min(2200, frontReboundDamp), 1000, 2200, 'Front Rebound Damping', 'Extension rebound wheel damping'],
        ['$rideheight_F', 'range', '+m', 'DriftMod Coilovers', 0.0, -0.025, 0.035, 'Front Ride Height', 'Coilover perch spring precompression height (+m)'],
      ],
      beams: [
        ['id1:', 'id2:'],
        // Layer 1: |NORMAL coil spring calibrated for geometric MR_F=0.367 (7.4x wheel rate) & zero static sag
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: '$=$dm_spring_F*7.4', beamDamp: 0, beamDeform: 165000, beamStrength: 480000, precompressionRange: '$=$rideheight_F + 0.014' },
        ['fsh1r', 'fc1r'],
        ['fsh1l', 'fc1l'],
        // Layer 2: |BOUNDED 2-way shock damper (separate from main spring)
        { beamPrecompression: 1, beamType: '|BOUNDED', beamLongBound: 1, beamShortBound: 1 },
        { beamDeform: 165000, beamStrength: 480000 },
        { beamSpring: 0, beamDamp: '$=$damp_bump_F*7.4' },
        { beamLimitSpring: 0, beamLimitDamp: 0 },
        ['fsh1r', 'fc1r', { beamDampFast: '$=$damp_bump_F*5.0', beamDampRebound: '$=$damp_rebound_F*7.4', beamDampReboundFast: '$=$damp_rebound_F*4.9', beamDampVelocitySplit: 0.08, dampCutoffHz: 400 }],
        ['fsh1l', 'fc1l', { beamDampFast: '$=$damp_bump_F*5.0', beamDampRebound: '$=$damp_rebound_F*7.4', beamDampReboundFast: '$=$damp_rebound_F*4.9', beamDampVelocitySplit: 0.08, dampCutoffHz: 400 }],
        // Layer 3: |BOUNDED progressive bump stop (prevents bottoming without harsh premature slam)
        { beamSpring: 0, beamDamp: 0 },
        { beamLimitSpring: 351000, beamLimitDamp: 3200 },
        ['fsh1r', 'fc1r', { longBoundRange: 0.038, shortBoundRange: 0.034, boundZone: 0.014, dampCutoffHz: 500 }],
        ['fsh1l', 'fc1l', { longBoundRange: 0.038, shortBoundRange: 0.034, boundZone: 0.014, dampCutoffHz: 500 }],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0, precompressionRange: 0 },
      ],
    },
    [`${id}_driftmod_coilover_F_pro`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: 'DriftMod FD Pro Stiff Front Coilovers (96 kN/m)',
        value: 1950,
      },
      slotType: `${id}_driftmod_coilover_F`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_coilover_FR', ['driftmod_coil_FR', 'driftmod_subframe_F']],
        ['driftmod_coilover_FL', ['driftmod_coil_FL', 'driftmod_subframe_F']],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$dm_spring_F', 'range', 'N/m', 'DriftMod Coilovers', 96000, 50000, 125000, 'Front Spring Rate', 'FD Pro front coilover wheel rate'],
        ['$damp_bump_F', 'range', 'N/m/s', 'DriftMod Coilovers', 1550, 750, 1600, 'Front Bump Damping', 'High-load compression wheel damping'],
        ['$damp_rebound_F', 'range', 'N/m/s', 'DriftMod Coilovers', 2150, 1200, 2200, 'Front Rebound Damping', 'Extension rebound wheel damping'],
        ['$rideheight_F', 'range', '+m', 'DriftMod Coilovers', 0.0, -0.025, 0.035, 'Front Ride Height', 'Coilover perch spring precompression height (+m)'],
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: '$=$dm_spring_F*7.4', beamDamp: 0, beamDeform: 165000, beamStrength: 480000, precompressionRange: '$=$rideheight_F + 0.012' },
        ['fsh1r', 'fc1r'],
        ['fsh1l', 'fc1l'],
        { beamPrecompression: 1, beamType: '|BOUNDED', beamLongBound: 1, beamShortBound: 1 },
        { beamDeform: 165000, beamStrength: 480000 },
        { beamSpring: 0, beamDamp: '$=$damp_bump_F*7.4' },
        { beamLimitSpring: 0, beamLimitDamp: 0 },
        ['fsh1r', 'fc1r', { beamDampFast: '$=$damp_bump_F*5.0', beamDampRebound: '$=$damp_rebound_F*7.4', beamDampReboundFast: '$=$damp_rebound_F*4.9', beamDampVelocitySplit: 0.08, dampCutoffHz: 400 }],
        ['fsh1l', 'fc1l', { beamDampFast: '$=$damp_bump_F*5.0', beamDampRebound: '$=$damp_rebound_F*7.4', beamDampReboundFast: '$=$damp_rebound_F*4.9', beamDampVelocitySplit: 0.08, dampCutoffHz: 400 }],
        { beamSpring: 0, beamDamp: 0 },
        { beamLimitSpring: 351000, beamLimitDamp: 3200 },
        ['fsh1r', 'fc1r', { longBoundRange: 0.036, shortBoundRange: 0.032, boundZone: 0.014, dampCutoffHz: 500 }],
        ['fsh1l', 'fc1l', { longBoundRange: 0.036, shortBoundRange: 0.032, boundZone: 0.014, dampCutoffHz: 500 }],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0, precompressionRange: 0 },
      ],
    },
    [`${id}_driftmod_swaybar_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod Adjustable Front ARB (${100 - tune.rearArbBiasPct}% Front Bias)`,
        value: 520,
      },
      slotType: `${id}_driftmod_swaybar_F`,
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$dm_arb_spring_F', 'range', 'N/m', 'DriftMod Coilovers', tune.frontArbStiffness, 10000, 180000, 'Front Anti-Roll Bar', 'Front roll stiffness'],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { group: 'driftmod_arb_F', selfCollision: false, collision: false, nodeWeight: 3.5 },
        ['arbf1r', -0.48, round4(yF + 0.008), 0.39],
        ['arbf1l', 0.48, round4(yF + 0.008), 0.39],
        { group: '' },
      ],
      torsionbars: [
        ['id1:', 'id2:', 'id3:', 'id4:'],
        { spring: '$=$dm_arb_spring_F * 0.08', damp: 4, deform: 25000, strength: 500000 },
        ['arbf1r', 'fx2r', 'fx2l', 'arbf1l'],
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 951000, beamDamp: 45, beamDeform: 90000, beamStrength: 'FLT_MAX' },
        // Torsionbar drop-arm V-hinge to subframe + vertical endlinks to LCA coilover clevis
        ['arbf1r', 'fx2r'], ['arbf1r', 'fx2l'],
        ['arbf1l', 'fx2l'], ['arbf1l', 'fx2r'],
        ['arbf1r', 'fsh1r'], ['arbf1l', 'fsh1l'],
      ],
    },
  };

  // 5. Rear Anti-Squat Suspension + Subframe + Coilovers + ARB + Hubs + Rear Diff Hook
  const suspensionRJbeam = {
    [`${id}_driftmod_suspension_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod Anti-Squat Multi-Link Rear Suspension (${tune.antiSquatPct}% Anti-Squat)`,
        value: 4800,
      },
      slotType: `${id}_suspension_R`,
      slots2: [
        ['name', 'allowTypes', 'denyTypes', 'default', 'description'],
        [`${id}_driftmod_subframe_R`, [`${id}_driftmod_subframe_R`], [], `${id}_driftmod_subframe_R`, 'Rear Subframe', { coreSlot: true }],
        [`${id}_driftmod_coilover_R`, [`${id}_driftmod_coilover_R`], [], `${id}_driftmod_coilover_R`, 'Rear Coilovers', { coreSlot: true }],
        [`${id}_driftmod_swaybar_R`, [`${id}_driftmod_swaybar_R`], [], `${id}_driftmod_swaybar_R`, 'Rear Sway Bar'],
        [`${id}_driftmod_hub_R`, [`${id}_driftmod_hub_R`], [], `${id}_driftmod_hub_R`, 'Rear 5-Lug Hubs', { coreSlot: true }],
        [`${id}_driftmod_wheeldata_R`, [`${id}_driftmod_wheeldata_R`], [], `${id}_driftmod_wheeldata_R`, 'Rear Spindles', { coreSlot: true }],
        [`${id}_differential_R`, [`${id}_differential_R`], [], `${id}_driftmod_diff_R`, 'Rear Differential'],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$trackoffset_R', 'range', '+m', 'DriftMod Alignment', 0.0, -0.04, 0.06, 'Rear Track Offset', 'Adjusts rear hub offset'],
        ['$dm_camber_R', 'range', 'deg', 'DriftMod Alignment', tune.rearCamberDeg, -6.0, 0.5, 'Rear Camber', 'Rear static camber angle'],
        ['$dm_toe_R', 'range', 'deg', 'DriftMod Alignment', tune.rearToeDeg, -0.20, 0.80, 'Rear Toe', 'Rear static toe angle'],
        ['$dm_anti_squat', 'range', '%', 'DriftMod Suspension', tune.antiSquatPct, 20, 90, 'Rear Anti-Squat', 'Rear suspension anti-squat geometry'],
        ['$dm_rear_psi', 'range', 'PSI', 'DriftMod Tires', tune.rearTirePsi, 12, 42, 'Rear Tire Pressure', 'Target rear tire air pressure'],
        ['$dm_lsd_lock', 'range', '%', 'DriftMod Drivetrain', tune.lsdLockPct, 0, 100, 'Rear LSD / Spool Lock', 'Clutch lockup / welded spool'],
        ['$dm_final_drive', 'range', ':1', 'DriftMod Drivetrain', Number(tune.finalDriveRatio.toFixed(2)), 3.1, 4.9, 'Final Drive Ratio', 'Rear differential gear ratio'],
        ['$dm_boost_psi', 'range', 'PSI', 'DriftMod Drivetrain', tune.turboBoostPsi, 0, 28, 'Target Turbo Boost', 'Turbo wastegate target PSI'],
      ],
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_arms_RR', ['driftmod_subframe_R', 'driftmod_knuckle_RR']],
        ['driftmod_arms_RL', ['driftmod_subframe_R', 'driftmod_knuckle_RL']],
        ['driftmod_knuckle_RR', ['driftmod_knuckle_RR', 'wheelhub_RR']],
        ['driftmod_knuckle_RL', ['driftmod_knuckle_RL', 'wheelhub_RL']],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 5.5 },
        { group: 'driftmod_knuckle_RR' },
        ['rh1r', -0.635, yR, 0.245],
        { group: 'driftmod_knuckle_RL' },
        ['rh1l', 0.635, yR, 0.245],
        // Inboard rear lower arm shock clevis + non-coplanar 3D lower gusset nodes
        { nodeWeight: 10.0 },
        { group: ['driftmod_knuckle_RR', 'driftmod_coil_RR'] },
        ['rsh1r', -0.47, round4(yR + 0.005), 0.28],
        { group: ['driftmod_knuckle_RL', 'driftmod_coil_RL'] },
        ['rsh1l', 0.47, round4(yR + 0.005), 0.28],
        { nodeWeight: 8.5, group: '' },
        ['rlr1r', -0.47, round4(yR + 0.005), 0.12],
        ['rlr1l', 0.47, round4(yR + 0.005), 0.12],
        { nodeWeight: 5.5 },
        { group: 'driftmod_knuckle_RR' },
        ['rh2r', -0.625, yR, 0.475],
        ['rh4r', -0.635, round4(yR - 0.085), 0.345],
        ['rh5r', -0.635, round4(yR + 0.105), 0.345],
        { group: 'driftmod_knuckle_RL' },
        ['rh2l', 0.625, yR, 0.475],
        ['rh4l', 0.635, round4(yR - 0.085), 0.345],
        ['rh5l', 0.635, round4(yR + 0.105), 0.345],
        { nodeWeight: 10.5 },
        { group: ['driftmod_subframe_R', 'driftmod_coil_RR'] },
        ['rc1r', -0.45, round4(yR + 0.005), 0.745],
        { group: ['driftmod_subframe_R', 'driftmod_coil_RL'] },
        ['rc1l', 0.45, round4(yR + 0.005), 0.745],
        { group: '' },
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 4200000, beamDamp: 180, beamDeform: 260000, beamStrength: 'FLT_MAX' },
        ['rh1r', 'rh2r'], ['rh1l', 'rh2l'],
        ['rh1r', 'rh4r'], ['rh1l', 'rh4l'],
        ['rh2r', 'rh4r'], ['rh2l', 'rh4l'],
        ['rh1r', 'rh5r'], ['rh1l', 'rh5l'],
        ['rh2r', 'rh5r'], ['rh2l', 'rh5l'],
        ['rh4r', 'rh5r'], ['rh4l', 'rh5l'],
        // Rear multi-link lower arms + 3D bipyramid shock clevis box (rx1*-rh4* is damping-only so toe link is unconstrained)
        { beamSpring: 2600000, beamDamp: 140, beamDeform: 220000, beamStrength: 900000, dampCutoffHz: 500 },
        ['rx1r', 'rh1r'], ['rx2r', 'rh1r'],
        ['rx1l', 'rh1l'], ['rx2l', 'rh1l'],
        { beamSpring: 0, beamDamp: 450, beamDeform: 10500, beamStrength: 27500, dampCutoffHz: 500 },
        ['rx1r', 'rh4r'], ['rx1l', 'rh4l'],
        { beamSpring: 1400000, beamDamp: 140, beamDeform: 260000, beamStrength: 1100000, dampCutoffHz: 500 },
        ['rsh1r', 'rx1r'], ['rsh1r', 'rx2r'], ['rsh1r', 'rh1r'], ['rsh1r', 'rlr1r'],
        ['rlr1r', 'rx1r'], ['rlr1r', 'rx2r'], ['rlr1r', 'rh1r'],
        ['rsh1l', 'rx1l'], ['rsh1l', 'rx2l'], ['rsh1l', 'rh1l'], ['rsh1l', 'rlr1l'],
        ['rlr1l', 'rx1l'], ['rlr1l', 'rx2l'], ['rlr1l', 'rh1l'],
        // Rear upper camber & trailing toe control links (live $dm_camber_R & $dm_toe_R)
        { beamSpring: 2600000, beamDamp: 140, beamDeform: 220000, beamStrength: 900000, dampCutoffHz: 500 },
        ['ru1r', 'rh2r', { beamPrecompression: precompExpr('$dm_camber_R', tune.rearCamberDeg, camberSlopeR_ru1), beamPrecompressionTime: 0.5 }],
        ['ru2r', 'rh2r', { beamPrecompression: precompExpr('$dm_camber_R', tune.rearCamberDeg, camberSlopeR_ru2), beamPrecompressionTime: 0.5 }],
        ['rx2r', 'rh5r', { beamPrecompression: precompExpr('$dm_toe_R', tune.rearToeDeg, toeSlopeR), beamPrecompressionTime: 0.5 }],
        ['ru1l', 'rh2l', { beamPrecompression: precompExpr('$dm_camber_R', tune.rearCamberDeg, camberSlopeR_ru1), beamPrecompressionTime: 0.5 }],
        ['ru2l', 'rh2l', { beamPrecompression: precompExpr('$dm_camber_R', tune.rearCamberDeg, camberSlopeR_ru2), beamPrecompressionTime: 0.5 }],
        ['rx2l', 'rh5l', { beamPrecompression: precompExpr('$dm_toe_R', tune.rearToeDeg, toeSlopeR), beamPrecompressionTime: 0.5 }],
        // Suspension travel & anti-invert bounded limiters
        { beamPrecompression: 1, beamType: '|BOUNDED', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 0, beamDamp: 0, beamDeform: 45000, beamStrength: 400000, beamLimitSpring: 251000, beamLimitDamp: 250, dampCutoffHz: 500 },
        ['rh1r', 'ru1r', { longBoundRange: 0.14, shortBoundRange: 0.14, boundZone: 0.03 }],
        ['rh1l', 'ru1l', { longBoundRange: 0.14, shortBoundRange: 0.14, boundZone: 0.03 }],
        // Rear shock tower bracing (all unibody tie-in nodes verified present in coupe & hatch)
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 1200000, beamDamp: 90, beamDeform: 240000, beamStrength: 'FLT_MAX' },
        ['rc1r', 'ru1r'], ['rc1r', 'ru2r'], ['rc1r', 'rc1l'],
        ['rc1l', 'ru1l'], ['rc1l', 'ru2l'],
        { optional: true, beamSpring: 651000, beamDamp: 35, beamDeform: 45000, beamStrength: 350000 },
        ['rc1r', 'r1rr'], ['rc1r', 'r1'], ['rc1r', 'r5rr'],
        ['rc1l', 'r1ll'], ['rc1l', 'r1'], ['rc1l', 'r5ll'],
        { optional: false },
      ],
    },
    [`${id}_driftmod_subframe_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod Solid-Bushing Rear Subframe (${tune.antiSquatPct}% Anti-Squat)`,
        value: 1950,
      },
      slotType: `${id}_driftmod_subframe_R`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_subframe_R', ['driftmod_subframe_R']],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 10.5 },
        // Include stock bx_subframe_R / bx_lowermounts_R / bx_uppermounts_R groups so stock open/welded/LSD diffs bind cleanly
        { group: ['driftmod_subframe_R', 'bx_subframe_R', 'bx_lowermounts_R'] },
        ['rx1r', -0.33, round4(yR - 0.24), zRearLinkFront],
        ['rx1l', 0.33, round4(yR - 0.24), zRearLinkFront],
        { nodeWeight: 10.5, group: ['driftmod_subframe_R', 'bx_lowermounts_R'] },
        ['rx2r', -0.33, round4(yR + 0.18), 0.26],
        ['rx2l', 0.33, round4(yR + 0.18), 0.26],
        { nodeWeight: 8.5, group: 'driftmod_subframe_R' },
        ['ru1r', -0.35, round4(yR - 0.175), 0.47],
        ['ru1l', 0.35, round4(yR - 0.175), 0.47],
        ['ru2r', -0.35, round4(yR + 0.175), 0.47],
        ['ru2l', 0.35, round4(yR + 0.175), 0.47],
        // Stock BX differential & subframe mount nodes (kept out of driftmod_subframe_R flexbody mesh group)
        { nodeWeight: 4.5, group: ['bx_subframe_R', 'bx_uppermounts_R'] },
        ['rx3r', -0.4546, round4(yR - 0.1624), 0.4563],
        ['rx3l', 0.4546, round4(yR - 0.1624), 0.4563],
        { group: 'bx_uppermounts_R' },
        ['rx4r', -0.3368, round4(yR + 0.0903), 0.4603],
        ['rx4l', 0.3368, round4(yR + 0.0903), 0.4603],
        ['rx5r', -0.2068, round4(yR + 0.1425), 0.3334],
        ['rx5l', 0.2068, round4(yR + 0.1425), 0.3334],
        { nodeWeight: 6.5, group: 'bx_subframe_R' },
        ['rx6r', -0.59, round4(yR - 0.47), 0.21],
        ['rx6l', 0.59, round4(yR - 0.47), 0.21],
        ['rx7r', -0.34, round4(yR + 0.18), 0.48],
        ['rx7l', 0.34, round4(yR + 0.18), 0.48],
        { group: '' },
        ['rx8', 0.0, round4(yR - 0.15), 0.54],
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamSpring: subframeSpring, beamDamp: 45, beamDeform: 165000, beamStrength: 900000 },
        ['rx1r', 'rx1l'], ['rx2r', 'rx2l'], ['rx1r', 'rx2r'], ['rx1l', 'rx2l'],
        ['rx1r', 'rx2l'], ['rx1l', 'rx2r'],
        ['ru1r', 'ru2r'], ['ru1l', 'ru2l'], ['ru1r', 'ru1l'], ['ru2r', 'ru2l'],
        ['ru1r', 'rx1r'], ['ru2r', 'rx2r'], ['ru1r', 'rx2r'], ['ru2r', 'rx1r'],
        ['ru1l', 'rx1l'], ['ru2l', 'rx2l'], ['ru1l', 'rx2l'], ['ru2l', 'rx1l'],
        // Differential & stock subframe ear triangulation
        { beamSpring: Math.round(751000 * frameRigidity), beamDamp: 45, beamDeform: 145000, beamStrength: 900000 },
        ['rx3r', 'rx3l'], ['rx5r', 'rx5l'],
        ['rx3r', 'rx1r'], ['rx3r', 'rx2r'], ['rx3r', 'ru1r'],
        ['rx3l', 'rx1l'], ['rx3l', 'rx2l'], ['rx3l', 'ru1l'],
        ['rx4r', 'rx2r'], ['rx4r', 'ru2r'], ['rx4l', 'rx2l'], ['rx4l', 'ru2l'],
        ['rx5r', 'rx2r'], ['rx5r', 'ru2r'], ['rx5l', 'rx2l'], ['rx5l', 'ru2l'],
        ['rx6r', 'rx1r'], ['rx6r', 'rx3r'], ['rx6r', 'ru1r'],
        ['rx6l', 'rx1l'], ['rx6l', 'rx3l'], ['rx6l', 'ru1l'],
        ['rx7r', 'rx2r'], ['rx7r', 'ru2r'], ['rx7r', 'rx4r'], ['rx7r', 'rx5r'],
        ['rx7l', 'rx2l'], ['rx7l', 'ru2l'], ['rx7l', 'rx4l'], ['rx7l', 'rx5l'],
        ['rx7r', 'rx7l'],
        ['rx8', 'rx1r'], ['rx8', 'rx1l'], ['rx8', 'rx4r'], ['rx8', 'rx4l'],
        // Clean stock BX subframemount_RR1/RL1/RR2/RL2 unibody tie-ins (excludes rx2->r2rr/r2ll)
        { optional: true, beamSpring: 751000, beamDamp: 45, beamDeform: 45000, beamStrength: 350000 },
        { breakGroup: 'subframemount_RR1' },
        ['rx1r', 'f4r'], ['rx1r', 'f4rr'], ['rx1r', 'f9r'],
        ['rx6r', 'f4rr'], ['rx6r', 'f4r'], ['rx6r', 'f3rr'], ['rx6r', 'f3r'], ['rx6r', 'f8r'], ['rx6r', 'f9r'],
        ['ru1r', 'f9r'], ['ru1r', 'r1rr'],
        { breakGroup: 'subframemount_RL1' },
        ['rx1l', 'f4l'], ['rx1l', 'f4ll'], ['rx1l', 'f9l'],
        ['rx6l', 'f4ll'], ['rx6l', 'f4l'], ['rx6l', 'f3ll'], ['rx6l', 'f3l'], ['rx6l', 'f8l'], ['rx6l', 'f9l'],
        ['ru1l', 'f9l'], ['ru1l', 'r1ll'],
        { breakGroup: 'subframemount_RR2' },
        ['rx2r', 'r2'], ['rx2r', 'r5rr'], ['rx2r', 'f9r'],
        ['rx7r', 'r5rr'], ['rx7r', 'r2'], ['rx7r', 'r5'], ['rx7r', 'f9r'], ['rx7r', 'r1rr'], ['rx7r', 'r1'],
        ['ru2r', 'r5rr'], ['ru2r', 'r1rr'],
        { breakGroup: 'subframemount_RL2' },
        ['rx2l', 'r2'], ['rx2l', 'r5ll'], ['rx2l', 'f9l'],
        ['rx7l', 'r5ll'], ['rx7l', 'r2'], ['rx7l', 'r5'], ['rx7l', 'f9l'], ['rx7l', 'r1ll'], ['rx7l', 'r1'],
        ['ru2l', 'r5ll'], ['ru2l', 'r1ll'],
        { breakGroup: '', optional: false },
      ],
    },
    [`${id}_driftmod_coilover_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod 2-Way Rear Drift Coilovers (${tune.rearSpringKn} kN/m)`,
        value: 1350,
      },
      slotType: `${id}_driftmod_coilover_R`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_coilover_RR', ['driftmod_coil_RR', 'driftmod_subframe_R']],
        ['driftmod_coilover_RL', ['driftmod_coil_RL', 'driftmod_subframe_R']],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$dm_spring_R', 'range', 'N/m', 'DriftMod Coilovers', rearSpringNm, 25000, 90000, 'Rear Spring Rate', 'Rear coilover wheel rate'],
        ['$damp_bump_R', 'range', 'N/m/s', 'DriftMod Coilovers', Math.min(1600, rearBumpDamp), 550, 1600, 'Rear Bump Damping', 'Rear compression wheel damping'],
        ['$damp_rebound_R', 'range', 'N/m/s', 'DriftMod Coilovers', Math.min(2200, rearReboundDamp), 900, 2200, 'Rear Rebound Damping', 'Rear extension rebound wheel damping'],
        ['$rideheight_R', 'range', '+m', 'DriftMod Coilovers', 0.0, -0.025, 0.035, 'Rear Ride Height', 'Rear coilover perch spring precompression height (+m)'],
      ],
      beams: [
        ['id1:', 'id2:'],
        // Layer 1: |NORMAL rear coil spring calibrated for geometric MR_R=0.459 (4.8x wheel rate)
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: '$=$dm_spring_R*4.8', beamDamp: 0, beamDeform: 165000, beamStrength: 480000, precompressionRange: '$=$rideheight_R + 0.024' },
        ['rsh1r', 'rc1r'],
        ['rsh1l', 'rc1l'],
        // Layer 2: |BOUNDED 2-way damper
        { beamPrecompression: 1, beamType: '|BOUNDED', beamLongBound: 1, beamShortBound: 1 },
        { beamDeform: 165000, beamStrength: 480000 },
        { beamSpring: 0, beamDamp: '$=$damp_bump_R*4.8' },
        { beamLimitSpring: 0, beamLimitDamp: 0 },
        ['rsh1r', 'rc1r', { beamDampFast: '$=$damp_bump_R*3.3', beamDampRebound: '$=$damp_rebound_R*4.8', beamDampReboundFast: '$=$damp_rebound_R*3.2', beamDampVelocitySplit: 0.08, dampCutoffHz: 400 }],
        ['rsh1l', 'rc1l', { beamDampFast: '$=$damp_bump_R*3.3', beamDampRebound: '$=$damp_rebound_R*4.8', beamDampReboundFast: '$=$damp_rebound_R*3.2', beamDampVelocitySplit: 0.08, dampCutoffHz: 400 }],
        // Layer 3: |BOUNDED bump stop
        { beamSpring: 0, beamDamp: 0 },
        { beamLimitSpring: 321000, beamLimitDamp: 3200 },
        ['rsh1r', 'rc1r', { longBoundRange: 0.046, shortBoundRange: 0.042, boundZone: 0.016, dampCutoffHz: 500 }],
        ['rsh1l', 'rc1l', { longBoundRange: 0.046, shortBoundRange: 0.042, boundZone: 0.016, dampCutoffHz: 500 }],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0, precompressionRange: 0 },
      ],
    },
    [`${id}_driftmod_swaybar_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod Adjustable Rear ARB (${tune.rearArbBiasPct}% Rear Bias)`,
        value: 460,
      },
      slotType: `${id}_driftmod_swaybar_R`,
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$dm_arb_spring_R', 'range', 'N/m', 'DriftMod Coilovers', tune.rearArbStiffness, 10000, 180000, 'Rear Anti-Roll Bar', 'Rear roll stiffness'],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { group: 'driftmod_arb_R', selfCollision: false, collision: false, nodeWeight: 3.5 },
        ['arbr1r', -0.47, round4(yR + 0.005), 0.39],
        ['arbr1l', 0.47, round4(yR + 0.005), 0.39],
        { group: '' },
      ],
      torsionbars: [
        ['id1:', 'id2:', 'id3:', 'id4:'],
        { spring: '$=$dm_arb_spring_R * 0.06', damp: 4, deform: 25000, strength: 500000 },
        ['arbr1r', 'rx2r', 'rx2l', 'arbr1l'],
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 951000, beamDamp: 45, beamDeform: 90000, beamStrength: 'FLT_MAX' },
        ['arbr1r', 'rx2r'], ['arbr1r', 'rx2l'],
        ['arbr1l', 'rx2l'], ['arbr1l', 'rx2r'],
        ['arbr1r', 'rsh1r'], ['arbr1l', 'rsh1l'],
      ],
    },
    [`${id}_driftmod_hub_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: 'DriftMod 5-Lug Rear Hubs',
        value: 750,
      },
      slotType: `${id}_driftmod_hub_R`,
      slots2: [
        ['name', 'allowTypes', 'denyTypes', 'default', 'description'],
        [`${id}_driftmod_brake_R`, [`${id}_driftmod_brake_R`], [], `${id}_driftmod_brake_R`, 'Rear Drift Brakes & Hydro', { coreSlot: true }],
        ['wheel_R_5', ['wheel_R_5'], [], 'steelwheel_01a_15x7_R', 'Rear Wheels (5-Lug)', { nodeOffset: { x: '$=$trackoffset_R+0.220', y: yR, z: zHubCenterR } }],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: true, collision: true, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 7.5 },
        { group: 'wheelhub_RR' },
        ['rw1r', -xHubInR, round4(yR - dyToeR), round4(zHubCenterR - dzCamberR)],
        ['rw1rr', -xHubOutR, round4(yR + dyToeR), round4(zHubCenterR + dzCamberR)],
        { group: 'wheelhub_RL' },
        ['rw1l', xHubInR, round4(yR - dyToeR), round4(zHubCenterR - dzCamberR)],
        ['rw1ll', xHubOutR, round4(yR + dyToeR), round4(zHubCenterR + dzCamberR)],
        { group: '' },
      ],
      pressureWheels: [
        ['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'],
        { disableMeshBreaking: false, disableHubMeshBreaking: false, enableHubcaps: false, hasTire: false },
        { hubRadius: 0.08 },
        { wheelOffset: -0.05 },
        { hubWidth: 0.05 },
        { numRays: 8 },
        { hubTreadBeamSpring: 501000, hubTreadBeamDamp: 5 },
        { hubPeripheryBeamSpring: 501000, hubPeripheryBeamDamp: 5 },
        { hubSideBeamSpring: 801000, hubSideBeamDamp: 5 },
        { hubNodeWeight: 0.4 },
        { hubNodeMaterial: '|NM_METAL' },
        { hubFrictionCoef: 0.2 },
        { hubBeamDeform: 45500, hubBeamStrength: 87500 },
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamSpring: 8501000, beamDamp: 100, beamDeform: 75000, beamStrength: 275000 },
        { breakGroup: 'wheel_RR' },
        ['rw1r', 'rh1r', { name: 'axle_RR', beamSpring: 6501000 }],
        ['rw1r', 'rh2r', { beamSpring: 4501000 }],
        ['rw1r', 'rh4r'],
        ['rw1r', 'rh5r'],
        ['rw1rr', 'rh1r'],
        ['rw1rr', 'rh2r', { beamSpring: 4501000 }],
        ['rw1rr', 'rh4r'],
        ['rw1rr', 'rh5r'],
        { breakGroup: 'wheel_RL' },
        ['rw1l', 'rh1l', { name: 'axle_RL', beamSpring: 6501000 }],
        ['rw1l', 'rh2l', { beamSpring: 4501000 }],
        ['rw1l', 'rh4l'],
        ['rw1l', 'rh5l'],
        ['rw1ll', 'rh1l'],
        ['rw1ll', 'rh2l', { beamSpring: 4501000 }],
        ['rw1ll', 'rh4l'],
        ['rw1ll', 'rh5l'],
        { breakGroup: '' },
      ],
    },
    [`${id}_driftmod_wheeldata_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: 'DriftMod Rear Axle Wheel Interface',
        value: 150,
      },
      slotType: `${id}_driftmod_wheeldata_R`,
      pressureWheels: [
        ['name', 'hubGroup', 'group', 'node1:', 'node2:', 'nodeS', 'nodeArm:', 'wheelDir'],
        { selfCollision: false, collision: true, disableMeshBreaking: false, disableHubMeshBreaking: false },
        { brakeTorque: '$=$braketorque_R', parkingTorque: 2800 },
        { hubcapBreakGroup: 'hubcap_RR', hubcapGroup: 'hubcap_RR', axleBeams: ['axle_RR'] },
        ['RR', 'wheel_RR', 'tire_RR', 'rw1rr', 'rw1r', 9999, 'rh5r', 1, { 'torqueCoupling:': 'rdiff', 'torqueArm:': 'rx2r', 'torqueArm2:': 'ru2r' }],
        { hubcapBreakGroup: 'hubcap_RL', hubcapGroup: 'hubcap_RL', axleBeams: ['axle_RL'] },
        ['RL', 'wheel_RL', 'tire_RL', 'rw1ll', 'rw1l', 9999, 'rh5l', -1, { 'torqueCoupling:': 'rdiff', 'torqueArm:': 'rx2l', 'torqueArm2:': 'ru2l' }],
        { selfCollision: true, axleBeams: [], disableMeshBreaking: false, disableTriangleBreaking: false, hubcapBreakGroup: '', hubcapGroup: '' },
        { enableHubcaps: false, enableTireLbeams: false, enableTireSideReinfBeams: false, enableTireReinfBeams: false, enableTreadReinfBeams: false, enableTirePeripheryReinfBeams: false },
        { loadSensitivitySlope: '', noLoadCoef: '', fullLoadCoef: '', frictionCoef: '', slidingFrictionCoef: '', softnessCoef: 0.5, treadCoef: 1.0 },
        { brakeTorque: 0, parkingTorque: 0, enableBrakeThermals: false, brakeDiameter: false, brakeMass: false, brakeType: false, rotorMaterial: false, brakeVentingCoef: false },
      ],
      powertrain: [
        ['type', 'name', 'inputName', 'inputIndex'],
        ['shaft', 'spindleRL', 'wheelaxleRL', 1, { connectedWheel: 'RL', breakTriggerBeam: 'axle_RL', uiName: 'Rear Left Axle', friction: 0.94, dynamicFriction: 0.002 }],
        ['shaft', 'spindleRR', 'wheelaxleRR', 1, { connectedWheel: 'RR', breakTriggerBeam: 'axle_RR', uiName: 'Rear Right Axle', friction: 0.94, dynamicFriction: 0.002 }],
      ],
    },
    [`${id}_driftmod_brake_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: 'DriftMod Dual-Caliper Hydro Rear Brakes',
        value: 820,
      },
      slotType: `${id}_driftmod_brake_R`,
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_rotor_RR', ['driftmod_knuckle_RR', 'wheelhub_RR']],
        ['driftmod_rotor_RL', ['driftmod_knuckle_RL', 'wheelhub_RL']],
        ['driftmod_brake_RR', ['driftmod_knuckle_RR', 'wheelhub_RR']],
        ['driftmod_brake_RL', ['driftmod_knuckle_RL', 'wheelhub_RL']],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$braketorque_R', 'range', 'Nm', 'DriftMod Brakes', 1450, 600, 2600, 'Rear Brake Torque', 'Rear caliper torque + hydro handbrake'],
      ],
    },
    [`${id}_driftmod_diff_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod ${tune.lsdLockPct >= 98 ? 'Welded Spool' : '2-Way Clutch LSD'} (${tune.finalDriveRatio.toFixed(2)}:1)`,
        value: 1250,
      },
      slotType: `${id}_differential_R`,
      powertrain: [
        ['type', 'name', 'inputName', 'inputIndex'],
        // Gearbox -> driveshaft -> differential_R -> wheelaxleRL/RR -> spindleRL/RR.
        // The driveshaft device lives here (as in the stock bx differential part); without it
        // the gearbox output is left unconsumed and BeamNG drops the whole rear drivetrain.
        [
          'shaft',
          'driveshaft',
          'gearbox',
          1,
          { friction: 0.5, uiName: 'Driveshaft' },
        ],
        [
          'differential',
          'differential_R',
          'driveshaft',
          1,
          {
            diffType: tune.lsdLockPct >= 98 ? 'locked' : 'lsd',
            gearRatio: '$dm_final_drive',
            lsdPreload: Math.round(60 + tune.lsdLockPct * 1.4),
            lsdLockCoef: round4(tune.lsdLockPct / 100),
            lsdRevLockCoef: round4((tune.lsdLockPct / 100) * 0.9),
            defaultVirtualInertia: 0.25,
            friction: 8,
            uiName: 'Rear Differential',
          },
        ],
        [
          'shaft',
          'wheelaxleRL',
          'differential_R',
          1,
          { friction: 2, uiName: 'Rear Left Halfshaft' },
        ],
        [
          'shaft',
          'wheelaxleRR',
          'differential_R',
          2,
          { friction: 2, uiName: 'Rear Right Halfshaft' },
        ],
      ],
    },
  };

  return [
    {
      filename: `${id}_driftmod_suspension_F.jbeam`,
      relativePath: `vehicles/${id}/driftmod/${id}_driftmod_suspension_F.jbeam`,
      language: 'json',
      summary: `Real Double Wishbone front suspension (${tune.kpiDeg.toFixed(1)}° KPI, +${tune.frontCasterDeg.toFixed(1)}° Caster, ${tune.frontCamberDeg.toFixed(1)}° Camber) with selectable Subframe, Steering Rack, Coilovers, Sway Bar & 5-Lug Hubs.`,
      content: JSON.stringify(suspensionFJbeam, null, 2),
    },
    {
      filename: `${id}_driftmod_subframe_F.jbeam`,
      relativePath: `vehicles/${id}/driftmod/${id}_driftmod_subframe_F.jbeam`,
      language: 'json',
      summary: `Selectable Chromoly Tubular & Street Double Wishbone Front Subframes with ${tune.chassisRigidity.toFixed(2)}x chassis rigidity.`,
      content: JSON.stringify(subframeFJbeam, null, 2),
    },
    {
      filename: `${id}_driftmod_steering_F.jbeam`,
      relativePath: `vehicles/${id}/driftmod/${id}_driftmod_steering_F.jbeam`,
      language: 'json',
      summary: `Selectable ${tune.steeringLockDeg}° Quick-Ratio Drift Steering Rack with ${tune.ackermannPct}% Ackermann tie-rod geometry & ${tune.steeringWheelDeg}° DD/belt FFB.`,
      content: JSON.stringify(steeringFJbeam, null, 2),
    },
    {
      filename: `${id}_driftmod_coilover_F.jbeam`,
      relativePath: `vehicles/${id}/driftmod/${id}_driftmod_coilover_F.jbeam`,
      language: 'json',
      summary: `Selectable ${tune.frontSpringKn} kN/m 2-Way Front Drift Coilovers and Adjustable Front Sway Bar.`,
      content: JSON.stringify(coiloverFJbeam, null, 2),
    },
    {
      filename: `${id}_driftmod_suspension_R.jbeam`,
      relativePath: `vehicles/${id}/driftmod/${id}_driftmod_suspension_R.jbeam`,
      language: 'json',
      summary: `Rear Anti-Squat Multi-Link Suspension (${tune.antiSquatPct}% anti-squat) with Rear Subframe, ${tune.rearSpringKn} kN/m Coilovers, ARB, Hubs & Differential slot.`,
      content: JSON.stringify(suspensionRJbeam, null, 2),
    },
  ];
}
