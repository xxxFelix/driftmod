import type { ChassisPreset, DriftTuneParams, ModFileSpec } from '../types/drift';

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const round4 = (n: number) => Number(n.toFixed(4));

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

  // Pro-Drift Geometry Defaults (replaces hardcoded BX values)
  // Lower Ball Joint (LBJ) and Upper Ball Joint (UBJ) positions
  const zLBJ = 0.23;
  const zUBJ = 0.56;
  const dzKingpin = zUBJ - zLBJ; // 0.330 m
  const xLBJ = 0.82;
  const xUBJ = round4(xLBJ - dzKingpin * Math.tan(kpiRad));
  const yLBJ = round4(yF - 0.15 * Math.tan(casterRad));
  const yUBJ = round4(yLBJ + dzKingpin * Math.tan(casterRad));

  // Shorter steering arm (116mm behind axle) + Ackermann pickup shift, raised to z=0.315m clear of LCA & subframe
  const ackermannShift = (tune.ackermannPct / 100) * 0.035; // Increased range for more realistic Ackermann
  const xTieOuter = round4(xLBJ - ackermannShift);
  const yTieOuter = round4(yF + 0.116);
  const zTieOuter = 0.315;

  // Kingpin axis position at tie-rod height for accurate steering arm radius
  const kpFracAtTie = (zTieOuter - zLBJ) / dzKingpin;
  const xKpAtTie = xLBJ + kpFracAtTie * (xUBJ - xLBJ);
  const yKpAtTie = yLBJ + kpFracAtTie * (yUBJ - yLBJ);

  // Front hub spindle (fw1r/l inner, fw1rr/ll outer): FD widebody front drift track (kept wide
  // so the tire still clears the inboard coilover at 60-70 deg of lock)
  const xHubInF = 0.665;
  const xHubOutF = 0.875;
  const spindleLenF = xHubOutF - xHubInF; // 0.210 m matching stock bx
  const zHubCenterF = 0.35;
  const dzCamberF = spindleLenF * 0.5 * Math.sin(-camberFRad);
  const dyToeF = spindleLenF * 0.5 * Math.sin(toeFRad);

  // Rear hub spindle (rw1r/l inner, rw1rr/ll outer): +20mm drift track over stock bx (0.54/0.75)
  const xHubInR = 0.54;
  const xHubOutR = 0.75;
  const spindleLenR = xHubOutR - xHubInR; // 0.210 m matching stock bx
  const zHubCenterR = 0.32;
  const dzCamberR = spindleLenR * 0.5 * Math.sin(-camberRRad);
  const dyToeR = spindleLenR * 0.5 * Math.sin(toeRRad);

  // Match tie-rod inner pivot (0.31m, z=0.315m) to LCA pivot X for zero bump-steer,
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
  const frontBumpDamp = Math.min(1750, Math.round(tune.frontSpringKn * 16));
  const frontReboundDamp = Math.min(2600, Math.round(tune.frontSpringKn * 26));
  const rearBumpDamp = Math.min(1550, Math.round(tune.rearSpringKn * 15));
  const rearReboundDamp = Math.min(2450, Math.round(tune.rearSpringKn * 24));
  const frontArbSpring = Math.round(24000 * (1 + (50 - tune.rearArbBiasPct) * 0.015));
  const rearArbSpring = Math.round(20000 * (1 + (tune.rearArbBiasPct - 50) * 0.018));
  const subframeSpring = Math.round(1251000 * Math.min(1.2, Math.max(0.85, tune.chassisRigidity)));
  const rackDamp = Math.min(180, Math.round(35 + tune.ffbDampingPct * 2.2));
  const ffbGainScale = round4((tune.ffbStrengthPct / 100) * (0.9 + (tune.frontCasterDeg - 5) * 0.03));

  // Rear anti-squat pickup geometry (higher antiSquatPct raises front link pickup toward IC)
  const zRearLinkFront = round4(0.25 + (tune.antiSquatPct / 100) * 0.12);

  // Chassis rigidity multiplier still feeds the subframes, but the bolt-in front-to-rear frame
  // is gone: it tied the shell together with long beams to distant body nodes and the car
  // folded the moment the front suspension that carried it was fitted.
  const frameRigidity = Math.min(1.2, Math.max(0.85, tune.chassisRigidity));

  const controllerCfg = {
    steerLockDeg: '$dm_steer_lock',
    steerSpeed: '$dm_steer_speed',
    steerWheelDeg: '$dm_wheel_deg',
    ffbStrengthPct: '$dm_ffb_gain',
    ffbDampingPct: '$dm_ffb_damp',
    ackermannPct: tune.ackermannPct,
    kpiDeg: Number(tune.kpiDeg.toFixed(1)),
    casterDeg: Number(tune.frontCasterDeg.toFixed(1)),
    camberF: Number(tune.frontCamberDeg.toFixed(1)),
    camberR: Number(tune.rearCamberDeg.toFixed(1)),
    toeF: Number(tune.frontToeDeg.toFixed(2)),
    toeR: Number(tune.rearToeDeg.toFixed(2)),
    springF: '$dm_spring_F',
    springR: '$dm_spring_R',
    arbBiasR: '$dm_arb_bias_R',
    antiSquatPct: tune.antiSquatPct,
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
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$trackoffset_F', 'range', '+m', 'DriftMod Alignment', 0.0, -0.04, 0.06, 'Front Track Offset', 'Adjusts front hub offset'],
        ['$dm_camber_F', 'range', 'deg', 'DriftMod Alignment', tune.frontCamberDeg, -8.0, 0.0, 'Front Camber (Ref)', 'Baked knuckle camber angle'],
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
        ['driftmod_knuckle_FR', ['driftmod_knuckle_FR']],
        ['driftmod_knuckle_FL', ['driftmod_knuckle_FL']],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 7.5 },
        // Lower balljoints (LBJ)
        { group: ['driftmod_knuckle_FR', 'driftmod_lca_FR'] },
        ['fh1r', -xLBJ, yLBJ, zLBJ],
        { group: ['driftmod_knuckle_FL', 'driftmod_lca_FL'] },
        ['fh1l', xLBJ, yLBJ, zLBJ],
        // Inboard LCA coilover clevis mounts (keeps spring & shock clear of UCA, knuckle, spindle & +/-70deg tire barrel)
        { nodeWeight: 15.0 },
        { group: ['driftmod_lca_FR', 'driftmod_coil_FR'] },
        ['fsh1r', -0.455, round4(yF + 0.008), 0.264],
        { group: ['driftmod_lca_FL', 'driftmod_coil_FL'] },
        ['fsh1l', 0.455, round4(yF + 0.008), 0.264],
        // Upper balljoints (UBJ - computed from KPI & Caster)
        { nodeWeight: 7.5 },
        { group: ['driftmod_knuckle_FR', 'driftmod_uca_FR'] },
        ['fh2r', -xUBJ, yUBJ, zUBJ],
        { group: ['driftmod_knuckle_FL', 'driftmod_uca_FL'] },
        ['fh2l', xUBJ, yUBJ, zUBJ],
        // Tie-rod knuckle arms & raised upright ears (clear of tie-rod arc at +/-70 deg)
        { group: 'driftmod_knuckle_FR' },
        ['fh3r', -xTieOuter, yTieOuter, zTieOuter],
        ['fh4r', -xLBJ, round4(yF - 0.055), 0.425],
        ['fh5r', -xLBJ, round4(yF + 0.055), 0.425],
        { group: 'driftmod_knuckle_FL' },
        ['fh3l', xTieOuter, yTieOuter, zTieOuter],
        ['fh4l', xLBJ, round4(yF - 0.055), 0.425],
        ['fh5l', xLBJ, round4(yF + 0.055), 0.425],
        // Upper coilover tower anchor nodes + triangulated cowl brace apex
        { nodeWeight: 15.0 },
        { group: ['driftmod_subframe_F', 'driftmod_coil_FR'] },
        ['fc1r', -0.34, round4(yF + 0.008), 0.745],
        { group: ['driftmod_subframe_F', 'driftmod_coil_FL'] },
        ['fc1l', 0.34, round4(yF + 0.008), 0.745],
        { nodeWeight: 8.5, group: 'driftmod_subframe_F' },
        ['fc0', 0.0, round4(yF + 0.18), 0.74],
        { group: '' },
      ],
      beams: [
        ['id1:', 'id2:'],
        // Drop-knuckle rigid upright structure (calibrated for 2000 Hz stability)
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 1551000, beamDamp: 55, beamDeform: 145000, beamStrength: 'FLT_MAX' },
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

        // Formula Drift Double Wishbone Lower A-Arms & inboard shock clevis triangle
        { beamSpring: 1501000, beamDamp: 55, beamDeform: 135000, beamStrength: 420000, dampCutoffHz: 500 },
        ['fx1r', 'fh1r'], ['fx2r', 'fh1r'],
        ['fx1l', 'fh1l'], ['fx2l', 'fh1l'],
        ['fsh1r', 'fx1r'], ['fsh1r', 'fx2r'], ['fsh1r', 'fh1r'],
        ['fsh1l', 'fx1l'], ['fsh1l', 'fx2l'], ['fsh1l', 'fh1l'],

        // Formula Drift Double Wishbone Upper A-Arms (fu1/fu2 -> fh2, ~78-81% of LCA length)
        { beamSpring: 1501000, beamDamp: 55, beamDeform: 125000, beamStrength: 380000, dampCutoffHz: 500 },
        ['fu1r', 'fh2r'], ['fu2r', 'fh2r'],
        ['fu1l', 'fh2l'], ['fu2l', 'fh2l'],

        // Suspension travel & anti-invert bounded limiters
        { beamPrecompression: 1, beamType: '|BOUNDED', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 0, beamDamp: 0, beamDeform: 45000, beamStrength: 400000, beamLimitSpring: 251000, beamLimitDamp: 250, dampCutoffHz: 500 },
        ['fh1r', 'fu1r', { longBoundRange: 0.14, shortBoundRange: 0.14, boundZone: 0.03 }],
        ['fh1l', 'fu1l', { longBoundRange: 0.14, shortBoundRange: 0.14, boundZone: 0.03 }],

        // Triangulated strut tower cross-brace & firewall V-brace (prevents cornering camber flex)
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 1251000, beamDamp: 50, beamDeform: 155000, beamStrength: 'FLT_MAX' },
        ['fc1r', 'fu1r'], ['fc1r', 'fu2r'], ['fc1r', 'fx4r'], ['fc1r', 'fc1l'],
        ['fc1l', 'fu1l'], ['fc1l', 'fu2l'], ['fc1l', 'fx4l'],
        ['fc1r', 'fx4l'], ['fc1l', 'fx4r'],
        ['fc1r', 'fc0'], ['fc1l', 'fc0'], ['fc0', 'fx2r'], ['fc0', 'fx2l'],
        // Complete 3D tetrahedral spaceframe between towers and cradle/subframe base
        ['fc1r', 'fu1l'], ['fc1l', 'fu1r'],
        ['fc1r', 'fu2l'], ['fc1l', 'fu2r'],
        ['fc1r', 'fx1r'], ['fc1l', 'fx1l'],
        ['fc1r', 'fx2r'], ['fc1l', 'fx2l'],
        ['fc0', 'fu2r'], ['fc0', 'fu2l'],
        ['fc0', 'fu1r'], ['fc0', 'fu1l'],
        { optional: true, beamSpring: 1001000, beamDamp: 50, beamDeform: 45000, beamStrength: 350000 },
        ['fc1r', 'fs1r'], ['fc1r', 'f14rr'],
        ['fc1l', 'fs1l'], ['fc1l', 'f14ll'],
        ['fc0', 'f5r'], ['fc0', 'f5l'],
        ['fc0', 'f6r'], ['fc0', 'f6l'],
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
        [`${id}_driftmod_wheeldata_F`, [`${id}_driftmod_wheeldata_F`], [], `${id}_driftmod_wheeldata_F`, 'Front Wheel Data', { coreSlot: true }],
        [`${id}_driftmod_brake_F`, [`${id}_driftmod_brake_F`], [], `${id}_driftmod_brake_F`, 'Front Drift Brakes', { coreSlot: true }],
        ['wheel_F_5', ['wheel_F_5'], [], 'steelwheel_01a_15x7_F', 'Front Wheels (5-Lug)', { nodeOffset: { x: '$=$trackoffset_F+0.345', y: round4(yF + 0.005), z: zHubCenterF } }],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 7.5 },
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
        // Stock-strength knuckle->hub attachment. The old 1.35 MN/m budget was ~6x softer than
        // stock (8.5 MN/m) and snapped at 270 kN, which let the wheel fold under and break off.
        { beamSpring: 8501000, beamDamp: 150, beamDeform: 99500, beamStrength: 270000 },
        { breakGroup: 'wheel_FR' },
        ['fw1r', 'fh1r', { name: 'axle_FR' }],
        ['fw1r', 'fh3r', { beamSpring: 14001000, beamDamp: 50 }],
        ['fw1r', 'fh4r'],
        ['fw1r', 'fh5r', { beamSpring: 6001000, beamDamp: 50 }],
        ['fw1rr', 'fh1r'],
        ['fw1rr', 'fh3r', { beamSpring: 14001000, beamDamp: 50 }],
        ['fw1rr', 'fh4r'],
        ['fw1rr', 'fh5r', { beamSpring: 6001000, beamDamp: 50 }],
        { breakGroup: 'wheel_FL' },
        ['fw1l', 'fh1l', { name: 'axle_FL' }],
        ['fw1l', 'fh3l', { beamSpring: 14001000, beamDamp: 50 }],
        ['fw1l', 'fh4l'],
        ['fw1l', 'fh5l', { beamSpring: 6001000, beamDamp: 50 }],
        ['fw1ll', 'fh1l'],
        ['fw1ll', 'fh3l', { beamSpring: 14001000, beamDamp: 50 }],
        ['fw1ll', 'fh4l'],
        ['fw1ll', 'fh5l', { beamSpring: 6001000, beamDamp: 50 }],
        { breakGroup: '' },
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
        { selfCollision: false, collision: true, disableMeshBreaking: false, disableHubMeshBreaking: false, enableTireSideSupportBeams: true },
        { brakeTorque: '$=$braketorque_F', parkingTorque: 0, propulsed: 0 },
        { hubcapBreakGroup: 'hubcap_FR', hubcapGroup: 'hubcap_FR', axleBeams: ['axle_FR'] },
        ['FR', 'wheel_FR', 'tire_FR', 'fw1rr', 'fw1r', 9999, 'fh5r', 1, { 'torqueCoupling:': 'fh1r', 'torqueArm:': 'fh4r', 'torqueArm2:': 'fw1rr', 'steerAxisUp:': 'fh2r', 'steerAxisDown:': 'fh1r' }],
        { hubcapBreakGroup: 'hubcap_FL', hubcapGroup: 'hubcap_FL', axleBeams: ['axle_FL'] },
        ['FL', 'wheel_FL', 'tire_FL', 'fw1ll', 'fw1l', 9999, 'fh5l', -1, { 'torqueCoupling:': 'fh1l', 'torqueArm:': 'fh4l', 'torqueArm2:': 'fw1ll', 'steerAxisUp:': 'fh2l', 'steerAxisDown:': 'fh1l' }],
        { selfCollision: true, axleBeams: [], hubcapBreakGroup: '', hubcapGroup: '' },
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
        ['driftmod_rotor_FR', ['driftmod_knuckle_FR']],
        ['driftmod_rotor_FL', ['driftmod_knuckle_FL']],
        ['driftmod_brake_FR', ['driftmod_knuckle_FR']],
        ['driftmod_brake_FL', ['driftmod_knuckle_FL']],
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
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 14.5 },
        { group: ['driftmod_subframe_F', 'driftmod_lca_FR'] },
        ['fx1r', -0.31, round4(yF - 0.145), 0.255],
        ['fx2r', -0.31, round4(yF + 0.175), 0.255],
        { group: ['driftmod_subframe_F', 'driftmod_lca_FL'] },
        ['fx1l', 0.31, round4(yF - 0.145), 0.255],
        ['fx2l', 0.31, round4(yF + 0.175), 0.255],
        // Front engine mount rail nodes (aligned with stock bx_engine mount position)
        { nodeWeight: 4.5, group: 'driftmod_subframe_F' },
        ['fx6r', -0.23, round4(yF - 0.032), 0.285],
        ['fx6l', 0.23, round4(yF - 0.032), 0.285],
        { nodeWeight: 12.5 },
        { group: ['driftmod_subframe_F', 'driftmod_uca_FR', 'driftmod_coil_FR'] },
        ['fu1r', -0.345, round4(yF - 0.145), 0.515],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FR'] },
        ['fu2r', -0.345, round4(yF + 0.145), 0.515],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FL', 'driftmod_coil_FL'] },
        ['fu1l', 0.345, round4(yF - 0.145), 0.515],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FL'] },
        ['fu2l', 0.345, round4(yF + 0.145), 0.515],
        { nodeWeight: 10.5, group: 'driftmod_subframe_F' },
        ['fx3r', -xRackMount, yRack, zRack],
        ['fx3l', xRackMount, yRack, zRack],
        ['fx4r', -0.4, round4(yF - 0.05), 0.4],
        ['fx4l', 0.4, round4(yF - 0.05), 0.4],
        { group: '' },
      ],
      rails: {
        enginemountnodes: { links: ['fx6r', 'fx6l'], broken: [], looped: false, capped: true },
      },
      slidenodes: [
        ['id:', 'railName', 'attached', 'fixToRail', 'tolerance', 'spring', 'strength', 'capStrength'],
        ['fx6r', 'enginemountnodes', true, true, 0.0, 2501000, 'FLT_MAX', 'FLT_MAX'],
        ['fx6l', 'enginemountnodes', true, true, 0.0, 2501000, 'FLT_MAX', 'FLT_MAX'],
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        // Balanced strength: bends in a heavy impact instead of passing the whole load into the unibody
        { beamSpring: subframeSpring, beamDamp: 55, beamDeform: 165000, beamStrength: 900000 },
        // Lower subframe perimeter & X-bracing
        ['fx1r', 'fx1l'], ['fx2r', 'fx2l'], ['fx1r', 'fx2r'], ['fx1l', 'fx2l'],
        ['fx1r', 'fx2l'], ['fx1l', 'fx2r'],
        // Engine mount nodes braced to lower & upper subframe
        { beamSpring: 1001000, beamDamp: 50 },
        ['fx6r', 'fx6l'], ['fx6r', 'fx2r'], ['fx6r', 'fx4r'], ['fx6r', 'fx3r'], ['fx6r', 'fx1r'],
        ['fx6l', 'fx2l'], ['fx6l', 'fx4l'], ['fx6l', 'fx3l'], ['fx6l', 'fx1l'],
        ['fx6r', 'fx1l'], ['fx6l', 'fx1r'],
        // Steering rack mounts braced to lower & upper subframe
        { beamSpring: subframeSpring, beamDamp: 55 },
        ['fx3r', 'fx3l'], ['fx3r', 'fx2r'], ['fx3r', 'fx1r'],
        ['fx3l', 'fx2l'], ['fx3l', 'fx1l'],
        ['fx3r', 'fu2r'], ['fx3r', 'fu1r'], ['fx3l', 'fu2l'], ['fx3l', 'fu1l'],
        ['fx3r', 'fx1l'], ['fx3l', 'fx1r'], ['fx3r', 'fx2l'], ['fx3l', 'fx2r'],
        // Upper wishbone cradle & 3D spaceframe triangulation (stops cradle shear and folding)
        ['fu1r', 'fu2r'], ['fu1l', 'fu2l'], ['fu1r', 'fx1r'], ['fu2r', 'fx2r'],
        ['fu1r', 'fx2r'], ['fu2r', 'fx1r'], ['fu1l', 'fx1l'], ['fu2l', 'fx2l'],
        ['fu1l', 'fx2l'], ['fu2l', 'fx1l'],
        // Transverse & diagonal top cross-members
        ['fu1r', 'fu1l'], ['fu2r', 'fu2l'],
        ['fu1r', 'fu2l'], ['fu1l', 'fu2r'],
        // Front & rear vertical transverse diagonals
        ['fu1r', 'fx1l'], ['fu1l', 'fx1r'],
        ['fu2r', 'fx2l'], ['fu2l', 'fx2r'],
        // Internal 3D space cross-braces
        ['fu1r', 'fx2l'], ['fu1l', 'fx2r'],
        ['fu2r', 'fx1l'], ['fu2l', 'fx1r'],
        // Outer ear triangulation
        ['fx4r', 'fx4l'], ['fx4r', 'fx1r'], ['fx4r', 'fu1r'], ['fx4r', 'fx3r'],
        ['fx4l', 'fx1l'], ['fx4l', 'fu1l'], ['fx4l', 'fx3l'],
        ['fx4r', 'fu2r'], ['fx4l', 'fu2l'],
        ['fx4r', 'fx2r'], ['fx4l', 'fx2l'],
        // Chassis unibody tie-in beams (fully triangulated X-bracing to prevent unibody folding)
        { optional: true, beamSpring: 1101000, beamDamp: 55, beamDeform: 45000, beamStrength: 350000 },
        // Lower front core support & rails
        ['fx1r', 'f10rr'], ['fx1r', 'f11rr'], ['fx1r', 'f12rr'], ['fx1r', 'f13rr'],
        ['fx1l', 'f10ll'], ['fx1l', 'f11ll'], ['fx1l', 'f12ll'], ['fx1l', 'f13ll'],
        ['fx1r', 'f11'], ['fx1l', 'f11'],
        ['fx1r', 'f11ll'], ['fx1l', 'f11rr'],
        ['fx1r', 'f13ll'], ['fx1l', 'f13rr'],
        // Lower rear torque box & floor
        ['fx2r', 'f1r'], ['fx2r', 'f11rr'],
        ['fx2l', 'f1l'], ['fx2l', 'f11ll'],
        // Outer ear tie-ins
        ['fx4r', 'f10rr'], ['fx4r', 'f12rr'], ['fx4r', 'f1r'], ['fx4r', 'f5r'],
        ['fx4l', 'f10ll'], ['fx4l', 'f12ll'], ['fx4l', 'f1l'], ['fx4l', 'f5l'],
        ['fx4r', 'f12ll'], ['fx4l', 'f12rr'],
        // Subframe mid / rack tie-ins
        ['fx3r', 'f10rr'], ['fx3r', 'f12rr'], ['fx3r', 'f1r'], ['fx3r', 'f5r'],
        ['fx3l', 'f10ll'], ['fx3l', 'f12ll'], ['fx3l', 'f1l'], ['fx3l', 'f5l'],
        ['fx3r', 'f5l'], ['fx3l', 'f5r'],
        ['fx3r', 'f1l'], ['fx3l', 'f1r'],
        // Anti-collapse & compression limiter support beams (stops firewall & frame collapse)
        { beamPrecompression: 1.0, beamType: '|SUPPORT', beamLongBound: 2.0 },
        { beamSpring: 1101000, beamDamp: 55, beamDeform: 45000, beamStrength: 350000 },
        ['fx2r', 'f12rr'], ['fx2l', 'f12ll'],
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
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 14.5 },
        { group: ['driftmod_subframe_F', 'driftmod_lca_FR'] },
        ['fx1r', -0.31, round4(yF - 0.145), 0.255],
        ['fx2r', -0.31, round4(yF + 0.175), 0.255],
        { group: ['driftmod_subframe_F', 'driftmod_lca_FL'] },
        ['fx1l', 0.31, round4(yF - 0.145), 0.255],
        ['fx2l', 0.31, round4(yF + 0.175), 0.255],
        { nodeWeight: 4.5, group: 'driftmod_subframe_F' },
        ['fx6r', -0.23, round4(yF - 0.032), 0.285],
        ['fx6l', 0.23, round4(yF - 0.032), 0.285],
        { nodeWeight: 12.5 },
        { group: ['driftmod_subframe_F', 'driftmod_uca_FR', 'driftmod_coil_FR'] },
        ['fu1r', -0.345, round4(yF - 0.145), 0.515],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FR'] },
        ['fu2r', -0.345, round4(yF + 0.145), 0.515],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FL', 'driftmod_coil_FL'] },
        ['fu1l', 0.345, round4(yF - 0.145), 0.515],
        { group: ['driftmod_subframe_F', 'driftmod_uca_FL'] },
        ['fu2l', 0.345, round4(yF + 0.145), 0.515],
        { nodeWeight: 10.5, group: 'driftmod_subframe_F' },
        ['fx3r', -xRackMount, yRack, zRack],
        ['fx3l', xRackMount, yRack, zRack],
        ['fx4r', -0.4, round4(yF - 0.05), 0.4],
        ['fx4l', 0.4, round4(yF - 0.05), 0.4],
        { group: '' },
      ],
      rails: {
        enginemountnodes: { links: ['fx6r', 'fx6l'], broken: [], looped: false, capped: true },
      },
      slidenodes: [
        ['id:', 'railName', 'attached', 'fixToRail', 'tolerance', 'spring', 'strength', 'capStrength'],
        ['fx6r', 'enginemountnodes', true, true, 0.0, 2501000, 'FLT_MAX', 'FLT_MAX'],
        ['fx6l', 'enginemountnodes', true, true, 0.0, 2501000, 'FLT_MAX', 'FLT_MAX'],
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: Math.round(subframeSpring * 0.9), beamDamp: 55, beamDeform: 140000, beamStrength: 820000 },
        ['fx1r', 'fx1l'], ['fx2r', 'fx2l'], ['fx1r', 'fx2r'], ['fx1l', 'fx2l'],
        ['fx1r', 'fx2l'], ['fx1l', 'fx2r'],
        { beamSpring: 1001000, beamDamp: 50 },
        ['fx6r', 'fx6l'], ['fx6r', 'fx2r'], ['fx6r', 'fx4r'], ['fx6r', 'fx3r'], ['fx6r', 'fx1r'],
        ['fx6l', 'fx2l'], ['fx6l', 'fx4l'], ['fx6l', 'fx3l'], ['fx6l', 'fx1l'],
        ['fx6r', 'fx1l'], ['fx6l', 'fx1r'],
        { beamSpring: Math.round(subframeSpring * 0.9), beamDamp: 55 },
        ['fx3r', 'fx3l'], ['fx3r', 'fx2r'], ['fx3r', 'fx1r'],
        ['fx3l', 'fx2l'], ['fx3l', 'fx1l'],
        ['fx3r', 'fu2r'], ['fx3r', 'fu1r'], ['fx3l', 'fu2l'], ['fx3l', 'fu1l'],
        ['fx3r', 'fx1l'], ['fx3l', 'fx1r'], ['fx3r', 'fx2l'], ['fx3l', 'fx2r'],
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
        { optional: true, beamSpring: 1101000, beamDamp: 55, beamDeform: 45000, beamStrength: 350000 },
        ['fx1r', 'f10rr'], ['fx1r', 'f11rr'], ['fx1r', 'f12rr'], ['fx1r', 'f13rr'],
        ['fx1l', 'f10ll'], ['fx1l', 'f11ll'], ['fx1l', 'f12ll'], ['fx1l', 'f13ll'],
        ['fx1r', 'f11'], ['fx1l', 'f11'],
        ['fx1r', 'f11ll'], ['fx1l', 'f11rr'],
        ['fx1r', 'f13ll'], ['fx1l', 'f13rr'],
        ['fx2r', 'f1r'], ['fx2r', 'f11rr'],
        ['fx2l', 'f1l'], ['fx2l', 'f11ll'],
        ['fx4r', 'f10rr'], ['fx4r', 'f12rr'], ['fx4r', 'f1r'], ['fx4r', 'f5r'],
        ['fx4l', 'f10ll'], ['fx4l', 'f12ll'], ['fx4l', 'f1l'], ['fx4l', 'f5l'],
        ['fx4r', 'f12ll'], ['fx4l', 'f12rr'],
        ['fx3r', 'f10rr'], ['fx3r', 'f12rr'], ['fx3r', 'f1r'], ['fx3r', 'f5r'],
        ['fx3l', 'f10ll'], ['fx3l', 'f12ll'], ['fx3l', 'f1l'], ['fx3l', 'f5l'],
        ['fx3r', 'f5l'], ['fx3l', 'f5r'],
        ['fx3r', 'f1l'], ['fx3l', 'f1r'],
        { beamPrecompression: 1.0, beamType: '|SUPPORT', beamLongBound: 2.0 },
        { beamSpring: 1101000, beamDamp: 55, beamDeform: 45000, beamStrength: 350000 },
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
        ['$toe_FR', 'range', '', 'DriftMod Alignment', 1.0, 0.985, 1.015, 'Front Tie-Rod Trim', 'Fine static toe trim'],
      ],
      beams: [
        ['id1:', 'id2:'],
        // Steering rack damper beams (smooths DD chatter & full-lock shimmy with dampCutoffHz)
        { beamSpring: 0, beamDamp: rackDamp, beamDeform: 'FLT_MAX', beamStrength: 'FLT_MAX', dampCutoffHz: 500 },
        ['fx3r', 'fh3r'],
        ['fx3l', 'fh3l'],
        ['fh5r', 'fx2r'],
        ['fh5l', 'fx2l'],
      ],
      hydros: [
        ['id1:', 'id2:'],
        {
          beamPrecompression: '$toe_FR',
          beamType: '|NORMAL',
          beamLongBound: 1.0,
          beamShortBound: 1.0,
          beamSpring: 2201000,
          beamDamp: 55,
          beamDeform: 120000,
          beamStrength: 280000,
          factor: -hydroRatio,
          steeringWheelLock: wheelHalfLock,
          inRate: round4(3.8 * tune.steeringSpeed),
          outRate: round4(3.8 * tune.steeringSpeed),
          inputSource: 'steering_input',
          ffCoef: ffbGainScale,
        },
        ['fx3r', 'fh3r', { factor: -hydroRatio, inLimit: hydroInLimit, outLimit: hydroOutLimit }],
        ['fx3l', 'fh3l', { factor: hydroRatio, inLimit: hydroInLimit, outLimit: hydroOutLimit }],
      ],
      input: {
        FFBcoef: `$=$ffbstrength*${round4(9 * ffbGainScale)}`,
      },
    },
  };

  // 4. Selectable Front Coilovers & Adjustable Front Sway Bar
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
        ['driftmod_coilover_FR', ['driftmod_coil_FR']],
        ['driftmod_coilover_FL', ['driftmod_coil_FL']],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$dm_spring_F', 'range', 'N/m', 'DriftMod Coilovers', frontSpringNm, 35000, 110000, 'Front Spring Rate', 'Front coilover wheel spring rate'],
        ['$damp_bump_F', 'range', 'N/m/s', 'DriftMod Coilovers', frontBumpDamp, 600, 1800, 'Front Bump Damping', 'Low-speed compression wheel damping'],
        ['$damp_rebound_F', 'range', 'N/m/s', 'DriftMod Coilovers', frontReboundDamp, 1000, 2600, 'Front Rebound Damping', 'Extension rebound wheel damping'],
        ['$rideheight_F', 'range', '', 'DriftMod Coilovers', 1.04, 0.9, 1.14, 'Front Ride Height', 'Coilover perch precompression'],
      ],
      beams: [
        ['id1:', 'id2:'],
        // Stock BX strut layering: spring beam + separate damper beam + hard bump stop.
        // The single bounded beam this replaces tripled damping at high shaft speed and put a
        // 251 kN/m stop at the end of 50 mm of stroke, which is what made the car bounce.
        { beamPrecompression: '$rideheight_F', beamType: '|BOUNDED', beamLongBound: 1, beamShortBound: 1 },
        { beamDeform: 12000, beamStrength: 160000 },
        { beamSpring: '$=$dm_spring_F*7.61', beamDamp: 0 },
        { beamLimitSpring: 34000, beamLimitDamp: 1000 },
        ['fsh1r', 'fc1r', { longBoundRange: 0.07, shortBoundRange: 0.06, boundZone: 0.03, dampCutoffHz: 500 }],
        ['fsh1l', 'fc1l', { longBoundRange: 0.07, shortBoundRange: 0.06, boundZone: 0.03, dampCutoffHz: 500 }],
        // Damper: softer at high shaft speed (stock ratio ~0.7x), not 3.8x stiffer
        { beamSpring: 0, beamDamp: '$=$damp_bump_F*7.61' },
        { beamLimitSpring: 0, beamLimitDamp: 0 },
        ['fsh1r', 'fc1r', { beamDampFast: '$=$damp_bump_F*5.3', beamDampRebound: '$=$damp_rebound_F*7.61', beamDampReboundFast: '$=$damp_rebound_F*5.0', beamDampVelocitySplit: 0.06, dampCutoffHz: 500 }],
        ['fsh1l', 'fc1l', { beamDampFast: '$=$damp_bump_F*5.3', beamDampRebound: '$=$damp_rebound_F*7.61', beamDampReboundFast: '$=$damp_rebound_F*5.0', beamDampVelocitySplit: 0.06, dampCutoffHz: 500 }],
        { beamSpring: 0, beamDamp: 0 },
        { beamLimitSpring: 251000, beamLimitDamp: 500 },
        ['fsh1r', 'fc1r', { longBoundRange: 0.055, shortBoundRange: 0.048, boundZone: 0.025, dampCutoffHz: 500 }],
        ['fsh1l', 'fc1l', { longBoundRange: 0.055, shortBoundRange: 0.048, boundZone: 0.025, dampCutoffHz: 500 }],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
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
        ['driftmod_coilover_FR', ['driftmod_coil_FR']],
        ['driftmod_coilover_FL', ['driftmod_coil_FL']],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$dm_spring_F', 'range', 'N/m', 'DriftMod Coilovers', 96000, 50000, 125000, 'Front Spring Rate', 'FD Pro front coilover wheel rate'],
        ['$damp_bump_F', 'range', 'N/m/s', 'DriftMod Coilovers', 1550, 750, 1800, 'Front Bump Damping', 'High-load compression wheel damping'],
        ['$damp_rebound_F', 'range', 'N/m/s', 'DriftMod Coilovers', 2500, 1200, 2600, 'Front Rebound Damping', 'Extension rebound wheel damping'],
        ['$rideheight_F', 'range', '', 'DriftMod Coilovers', 1.03, 0.9, 1.14, 'Front Ride Height', 'Coilover perch precompression'],
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamPrecompression: '$rideheight_F', beamType: '|BOUNDED', beamLongBound: 1, beamShortBound: 1 },
        { beamDeform: 12000, beamStrength: 160000 },
        { beamSpring: '$=$dm_spring_F*7.61', beamDamp: 0 },
        { beamLimitSpring: 34000, beamLimitDamp: 1000 },
        ['fsh1r', 'fc1r', { longBoundRange: 0.065, shortBoundRange: 0.055, boundZone: 0.03, dampCutoffHz: 500 }],
        ['fsh1l', 'fc1l', { longBoundRange: 0.065, shortBoundRange: 0.055, boundZone: 0.03, dampCutoffHz: 500 }],
        { beamSpring: 0, beamDamp: '$=$damp_bump_F*7.61' },
        { beamLimitSpring: 0, beamLimitDamp: 0 },
        ['fsh1r', 'fc1r', { beamDampFast: '$=$damp_bump_F*5.3', beamDampRebound: '$=$damp_rebound_F*7.61', beamDampReboundFast: '$=$damp_rebound_F*5.0', beamDampVelocitySplit: 0.06, dampCutoffHz: 500 }],
        ['fsh1l', 'fc1l', { beamDampFast: '$=$damp_bump_F*5.3', beamDampRebound: '$=$damp_rebound_F*7.61', beamDampReboundFast: '$=$damp_rebound_F*5.0', beamDampVelocitySplit: 0.06, dampCutoffHz: 500 }],
        { beamSpring: 0, beamDamp: 0 },
        { beamLimitSpring: 251000, beamLimitDamp: 500 },
        ['fsh1r', 'fc1r', { longBoundRange: 0.05, shortBoundRange: 0.044, boundZone: 0.025, dampCutoffHz: 500 }],
        ['fsh1l', 'fc1l', { longBoundRange: 0.05, shortBoundRange: 0.044, boundZone: 0.025, dampCutoffHz: 500 }],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
      ],
    },
    [`${id}_driftmod_swaybar_F`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod Adjustable Front ARB (${100 - tune.rearArbBiasPct}% Front Bias)`,
        value: 520,
      },
      slotType: `${id}_driftmod_swaybar_F`,
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { group: 'driftmod_arb_F', selfCollision: false, collision: false, nodeWeight: 2.5 },
        ['arbf1r', -0.46, yF, 0.28],
        ['arbf1l', 0.46, yF, 0.28],
        { group: '' },
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamSpring: 451000, beamDamp: 35, beamDeform: 90000, beamStrength: 'FLT_MAX' },
        ['arbf1r', 'fx1r'], ['arbf1r', 'fx2r'],
        ['arbf1l', 'fx1l'], ['arbf1l', 'fx2l'],
        { beamSpring: frontArbSpring, beamDamp: 35 },
        ['arbf1r', 'fh1r'], ['arbf1l', 'fh1l'],
        ['arbf1r', 'arbf1l'],
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
        [`${id}_differential_R`, [`${id}_differential_R`], [], `${id}_driftmod_diff_R`, 'Rear Differential'],
      ],
      variables: [
        ['name', 'type', 'unit', 'category', 'default', 'min', 'max', 'title', 'description'],
        ['$trackoffset_R', 'range', '+m', 'DriftMod Alignment', 0.0, -0.04, 0.06, 'Rear Track Offset', 'Adjusts rear hub offset'],
        ['$dm_rear_psi', 'range', 'PSI', 'DriftMod Tires', tune.rearTirePsi, 12, 42, 'Rear Tire Pressure', 'Target rear tire air pressure'],
        ['$dm_lsd_lock', 'range', '%', 'DriftMod Drivetrain', tune.lsdLockPct, 0, 100, 'Rear LSD / Spool Lock', 'Clutch lockup / welded spool'],
        ['$dm_final_drive', 'range', ':1', 'DriftMod Drivetrain', Number(tune.finalDriveRatio.toFixed(2)), 3.1, 4.9, 'Final Drive Ratio', 'Rear differential gear ratio'],
        ['$dm_boost_psi', 'range', 'PSI', 'DriftMod Drivetrain', tune.turboBoostPsi, 0, 28, 'Target Turbo Boost', 'Turbo wastegate target PSI'],
      ],
      flexbodies: [
        ['mesh', '[group]:', 'nonFlexMaterials'],
        ['driftmod_arms_RR', ['driftmod_subframe_R', 'driftmod_knuckle_RR']],
        ['driftmod_arms_RL', ['driftmod_subframe_R', 'driftmod_knuckle_RL']],
        ['driftmod_knuckle_RR', ['driftmod_knuckle_RR']],
        ['driftmod_knuckle_RL', ['driftmod_knuckle_RL']],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 7.5 },
        { group: 'driftmod_knuckle_RR' },
        ['rh1r', -0.635, yR, 0.245],
        { group: 'driftmod_knuckle_RL' },
        ['rh1l', 0.635, yR, 0.245],
        // Inboard rear lower arm shock clevis (keeps rear coilover clear of UCA, knuckle & spindle)
        { nodeWeight: 10.0 },
        { group: ['driftmod_knuckle_RR', 'driftmod_coil_RR'] },
        ['rsh1r', -0.485, round4(yR + 0.005), 0.255],
        { group: ['driftmod_knuckle_RL', 'driftmod_coil_RL'] },
        ['rsh1l', 0.485, round4(yR + 0.005), 0.255],
        { nodeWeight: 7.5 },
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
        { beamSpring: 1551000, beamDamp: 55, beamDeform: 145000, beamStrength: 'FLT_MAX' },
        ['rh1r', 'rh2r'], ['rh1l', 'rh2l'],
        ['rh1r', 'rh4r'], ['rh1l', 'rh4l'],
        ['rh2r', 'rh4r'], ['rh2l', 'rh4l'],
        ['rh1r', 'rh5r'], ['rh1l', 'rh5l'],
        ['rh2r', 'rh5r'], ['rh2l', 'rh5l'],
        ['rh4r', 'rh5r'], ['rh4l', 'rh5l'],
        // Rear multi-link lower & anti-squat trailing arms + inboard shock clevis
        { beamSpring: 1501000, beamDamp: 55, beamDeform: 135000, beamStrength: 420000, dampCutoffHz: 500 },
        ['rx1r', 'rh1r'], ['rx2r', 'rh1r'], ['rx1r', 'rh4r'],
        ['rx1l', 'rh1l'], ['rx2l', 'rh1l'], ['rx1l', 'rh4l'],
        ['rsh1r', 'rx1r'], ['rsh1r', 'rx2r'], ['rsh1r', 'rh1r'],
        ['rsh1l', 'rx1l'], ['rsh1l', 'rx2l'], ['rsh1l', 'rh1l'],
        // Rear upper camber & toe control links
        ['ru1r', 'rh2r'], ['ru2r', 'rh2r'], ['rx2r', 'rh5r'],
        ['ru1l', 'rh2l'], ['ru2l', 'rh2l'], ['rx2l', 'rh5l'],
        // Suspension travel & anti-invert bounded limiters
        { beamPrecompression: 1, beamType: '|BOUNDED', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 0, beamDamp: 0, beamDeform: 45000, beamStrength: 400000, beamLimitSpring: 251000, beamLimitDamp: 250, dampCutoffHz: 500 },
        ['rh1r', 'ru1r', { longBoundRange: 0.14, shortBoundRange: 0.14, boundZone: 0.03 }],
        ['rh1l', 'ru1l', { longBoundRange: 0.14, shortBoundRange: 0.14, boundZone: 0.03 }],
        // Rear shock tower bracing (all unibody tie-in nodes verified present in coupe & hatch)
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
        { beamSpring: 1251000, beamDamp: 50, beamDeform: 140000, beamStrength: 'FLT_MAX' },
        ['rc1r', 'ru1r'], ['rc1r', 'ru2r'], ['rc1r', 'rc1l'],
        ['rc1l', 'ru1l'], ['rc1l', 'ru2l'],
        { optional: true, beamSpring: 651000, beamDamp: 35 },
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
        { group: 'driftmod_subframe_R', selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 10.5 },
        ['rx1r', -0.33, round4(yR - 0.24), zRearLinkFront],
        ['rx1l', 0.33, round4(yR - 0.24), zRearLinkFront],
        ['rx2r', -0.33, round4(yR + 0.18), 0.26],
        ['rx2l', 0.33, round4(yR + 0.18), 0.26],
        { nodeWeight: 8.5 },
        ['ru1r', -0.35, round4(yR - 0.175), 0.47],
        ['ru1l', 0.35, round4(yR - 0.175), 0.47],
        ['ru2r', -0.35, round4(yR + 0.175), 0.47],
        ['ru2l', 0.35, round4(yR + 0.175), 0.47],
        // Stock differential mount pickups, kept at stock bx coordinates so both the DriftMod
        // diff and the stock open/welded diffs have their link targets present in the tree.
        // Kept out of the subframe mesh group so they cannot distort the flexbody.
        { group: '', nodeWeight: 4.5 },
        ['rx3r', -0.4546, 1.0876, 0.4563],
        ['rx3l', 0.4546, 1.0876, 0.4563],
        ['rx4r', -0.3368, 1.3403, 0.4603],
        ['rx4l', 0.3368, 1.3403, 0.4603],
        ['rx5r', -0.2068, 1.3925, 0.3334],
        ['rx5l', 0.2068, 1.3925, 0.3334],
        ['rx8', 0.0, 1.1, 0.54],
        { group: '' },
      ],
      beams: [
        ['id1:', 'id2:'],
        // Balanced strength: bends in a heavy impact instead of passing the whole load into the unibody
        { beamSpring: subframeSpring, beamDamp: 55, beamDeform: 165000, beamStrength: 900000 },
        ['rx1r', 'rx1l'], ['rx2r', 'rx2l'], ['rx1r', 'rx2r'], ['rx1l', 'rx2l'],
        ['rx1r', 'rx2l'], ['rx1l', 'rx2r'],
        ['ru1r', 'ru2r'], ['ru1l', 'ru2l'], ['ru1r', 'ru1l'], ['ru2r', 'ru2l'],
        ['ru1r', 'rx1r'], ['ru2r', 'rx2r'], ['ru1r', 'rx2r'], ['ru2r', 'rx1r'],
        ['ru1l', 'rx1l'], ['ru2l', 'rx2l'], ['ru1l', 'rx2l'], ['ru2l', 'rx1l'],
        // Differential mounts (carries diff reaction torque into the subframe)
        { beamSpring: Math.round(1001000 * frameRigidity), beamDamp: 45, beamDeform: 145000, beamStrength: 900000 },
        ['rx3r', 'rx3l'], ['rx5r', 'rx5l'],
        ['rx3r', 'rx1r'], ['rx3r', 'rx2r'], ['rx3r', 'ru1r'],
        ['rx3l', 'rx1l'], ['rx3l', 'rx2l'], ['rx3l', 'ru1l'],
        ['rx4r', 'rx2r'], ['rx4r', 'ru2r'], ['rx4l', 'rx2l'], ['rx4l', 'ru2l'],
        ['rx5r', 'rx2r'], ['rx5r', 'ru2r'], ['rx5l', 'rx2l'], ['rx5l', 'ru2l'],
        ['rx8', 'rx1r'], ['rx8', 'rx1l'], ['rx8', 'rx4r'], ['rx8', 'rx4l'],
        { optional: true, beamSpring: 651000, beamDamp: 35 },
        ['rx1r', 'f4r'], ['rx1r', 'f4rr'], ['rx1r', 'f9r'],
        ['rx1l', 'f4l'], ['rx1l', 'f4ll'], ['rx1l', 'f9l'],
        ['rx2r', 'r2'], ['rx2r', 'r2rr'], ['rx2r', 'r5rr'],
        ['rx2l', 'r2'], ['rx2l', 'r2ll'], ['rx2l', 'r5ll'],
        ['ru1r', 'f9r'], ['ru1r', 'r1rr'], ['ru2r', 'r5rr'], ['ru2r', 'r1rr'],
        ['ru1l', 'f9l'], ['ru1l', 'r1ll'], ['ru2l', 'r5ll'], ['ru2l', 'r1ll'],
        { optional: false },
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
        ['$damp_bump_R', 'range', 'N/m/s', 'DriftMod Coilovers', rearBumpDamp, 550, 1600, 'Rear Bump Damping', 'Rear compression wheel damping'],
        ['$damp_rebound_R', 'range', 'N/m/s', 'DriftMod Coilovers', rearReboundDamp, 900, 2500, 'Rear Rebound Damping', 'Rear extension rebound wheel damping'],
        ['$rideheight_R', 'range', '', 'DriftMod Coilovers', 1.04, 0.9, 1.12, 'Rear Ride Height', 'Rear coilover perch precompression'],
      ],
      beams: [
        ['id1:', 'id2:'],
        // Stock BX strut layering: spring beam + damper beam + hard bump stop
        { beamPrecompression: '$rideheight_R', beamType: '|BOUNDED', beamLongBound: 1, beamShortBound: 1 },
        { beamDeform: 12000, beamStrength: 160000 },
        { beamSpring: '$=$dm_spring_R*3.87', beamDamp: 0 },
        { beamLimitSpring: 34000, beamLimitDamp: 1000 },
        ['rsh1r', 'rc1r', { longBoundRange: 0.075, shortBoundRange: 0.065, boundZone: 0.03, dampCutoffHz: 500 }],
        ['rsh1l', 'rc1l', { longBoundRange: 0.075, shortBoundRange: 0.065, boundZone: 0.03, dampCutoffHz: 500 }],
        { beamSpring: 0, beamDamp: '$=$damp_bump_R*3.87' },
        { beamLimitSpring: 0, beamLimitDamp: 0 },
        ['rsh1r', 'rc1r', { beamDampFast: '$=$damp_bump_R*2.7', beamDampRebound: '$=$damp_rebound_R*3.87', beamDampReboundFast: '$=$damp_rebound_R*2.55', beamDampVelocitySplit: 0.06, dampCutoffHz: 500 }],
        ['rsh1l', 'rc1l', { beamDampFast: '$=$damp_bump_R*2.7', beamDampRebound: '$=$damp_rebound_R*3.87', beamDampReboundFast: '$=$damp_rebound_R*2.55', beamDampVelocitySplit: 0.06, dampCutoffHz: 500 }],
        { beamSpring: 0, beamDamp: 0 },
        { beamLimitSpring: 251000, beamLimitDamp: 500 },
        ['rsh1r', 'rc1r', { longBoundRange: 0.06, shortBoundRange: 0.05, boundZone: 0.025, dampCutoffHz: 500 }],
        ['rsh1l', 'rc1l', { longBoundRange: 0.06, shortBoundRange: 0.05, boundZone: 0.025, dampCutoffHz: 500 }],
        { beamPrecompression: 1, beamType: '|NORMAL', beamLongBound: 1.0, beamShortBound: 1.0 },
      ],
    },
    [`${id}_driftmod_swaybar_R`]: {
      information: {
        authors: 'DriftMod Workbench',
        name: `DriftMod Adjustable Rear ARB (${tune.rearArbBiasPct}% Rear Bias)`,
        value: 460,
      },
      slotType: `${id}_driftmod_swaybar_R`,
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { group: 'driftmod_arb_R', selfCollision: false, collision: false, nodeWeight: 2.5 },
        ['arbr1r', -0.46, yR, 0.28],
        ['arbr1l', 0.46, yR, 0.28],
        { group: '' },
      ],
      beams: [
        ['id1:', 'id2:'],
        { beamSpring: 451000, beamDamp: 35, beamDeform: 90000, beamStrength: 'FLT_MAX' },
        ['arbr1r', 'rx1r'], ['arbr1r', 'rx2r'],
        ['arbr1l', 'rx1l'], ['arbr1l', 'rx2l'],
        { beamSpring: rearArbSpring, beamDamp: 35 },
        ['arbr1r', 'rh1r'], ['arbr1l', 'rh1l'],
        ['arbr1r', 'arbr1l'],
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
        [`${id}_driftmod_wheeldata_R`, [`${id}_driftmod_wheeldata_R`], [], `${id}_driftmod_wheeldata_R`, 'Rear Wheel Data', { coreSlot: true }],
        [`${id}_driftmod_brake_R`, [`${id}_driftmod_brake_R`], [], `${id}_driftmod_brake_R`, 'Rear Drift Brakes & Hydro', { coreSlot: true }],
        ['wheel_R_5', ['wheel_R_5'], [], 'steelwheel_01a_15x7_R', 'Rear Wheels (5-Lug)', { nodeOffset: { x: '$=$trackoffset_R+0.240', y: yR, z: zHubCenterR } }],
      ],
      nodes: [
        ['id', 'posX', 'posY', 'posZ'],
        { selfCollision: false, collision: false, nodeMaterial: '|NM_METAL', frictionCoef: 0.5, nodeWeight: 7.5 },
        // Stock wheelhub_* groups: the rim mesh and hub cluster bind to these names.
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
        // Stock-strength knuckle->hub attachment (was 1.35 MN/m and broke at 275 kN, so the rear
        // wheel folded under the arm above ~30 km/h).
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
        { selfCollision: false, collision: true, disableMeshBreaking: false, disableHubMeshBreaking: false, enableTireSideSupportBeams: true },
        { brakeTorque: '$=$braketorque_R', parkingTorque: 2800 },
        { hubcapBreakGroup: 'hubcap_RR', hubcapGroup: 'hubcap_RR', axleBeams: ['axle_RR'] },
        // torqueCoupling must be the differential's virtual node "rdiff" (as in the stock bx).
        // Coupling it to a suspension node fed the diff reaction torque into the rear subframe,
        // which made the car creep and rotate on its own at a standstill in neutral.
        ['RR', 'wheel_RR', 'tire_RR', 'rw1rr', 'rw1r', 9999, 'rh5r', 1, { 'torqueCoupling:': 'rdiff', 'torqueArm:': 'rx2r', 'torqueArm2:': 'ru2r' }],
        { hubcapBreakGroup: 'hubcap_RL', hubcapGroup: 'hubcap_RL', axleBeams: ['axle_RL'] },
        ['RL', 'wheel_RL', 'tire_RL', 'rw1ll', 'rw1l', 9999, 'rh5l', -1, { 'torqueCoupling:': 'rdiff', 'torqueArm:': 'rx2l', 'torqueArm2:': 'ru2l' }],
        { selfCollision: true, axleBeams: [], hubcapBreakGroup: '', hubcapGroup: '' },
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
        ['driftmod_rotor_RR', ['driftmod_knuckle_RR']],
        ['driftmod_rotor_RL', ['driftmod_knuckle_RL']],
        ['driftmod_brake_RR', ['driftmod_knuckle_RR']],
        ['driftmod_brake_RL', ['driftmod_knuckle_RL']],
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
