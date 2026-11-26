import type { ChassisPreset, DriftTuneParams, ModFileSpec } from '../types/drift';
import { buildDoubleWishboneJbeamFiles } from './doubleWishboneJbeam';
import {
  buildSuspensionMeshScene,
  generateBeamNGMaterialsJson,
  serializeSuspensionColladaDae,
} from './suspensionMeshGenerator';

export function generateBeamNGModFiles(
  chassis: ChassisPreset,
  tune: DriftTuneParams
): ModFileSpec[] {
  const id = chassis.beamngInternalId;
  const jbeamFiles = buildDoubleWishboneJbeamFiles(chassis, tune);
  const meshParts = buildSuspensionMeshScene(chassis, tune);
  const daeXml = serializeSuspensionColladaDae(meshParts);
  const materialsJson = generateBeamNGMaterialsJson();

  const frontSpringNm = Math.round(tune.frontSpringKn * 1000);
  const rearSpringNm = Math.round(tune.rearSpringKn * 1000);

  // Startup script executed automatically by BeamNG when zip is dropped into mods/
  const modScriptLua = `-- DriftMod Startup Loader (auto-executed by BeamNG.drive from mods/*.zip)
extensions.load("driftmodScoring")
setExtensionUnloadMode("driftmodScoring", "manual")
`;

  // Vehicle-side Lua controller (`lua/vehicle/controller/driftmod.lua`) loaded by
  // DriftMod Double Wishbone Front Suspension to apply live Tuning sliders & 900deg FFB.
  const driftmodVehicleLua = `-- DriftMod Runtime Vehicle & 900deg FFB Controller for BeamNG.drive
-- Loaded by ${id}_driftmod_dw_suspension_F

local M = {}

local baseBeams = {}
local baseHydros = {}
local baseBrakes = {}
local baseWheelFfbCoef = nil
local avgWheelY = 0
local cfg = {}
local applyFramesRemaining = 0

local function clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

local function strContains(haystack, needle)
  if type(haystack) ~= "string" then return false end
  return string.find(string.lower(haystack), string.lower(needle), 1, true) ~= nil
end

local function computeAvgWheelY()
  if not wheels or not wheels.wheels or not v or not v.data or not v.data.nodes then
    return 0
  end
  local sumY, count = 0, 0
  for _, w in pairs(wheels.wheels) do
    local nid = w.node1
    local node = nid and v.data.nodes[nid]
    if node and node.pos then
      sumY = sumY + node.pos.y
      count = count + 1
    end
  end
  if count > 0 then
    return sumY / count
  end
  return 0
end

local function beamMidY(b)
  local nodes = v and v.data and v.data.nodes
  if not nodes then return 0 end
  local n1 = b.id1 and nodes[b.id1]
  local n2 = b.id2 and nodes[b.id2]
  if n1 and n2 and n1.pos and n2.pos then
    return (n1.pos.y + n2.pos.y) * 0.5
  end
  return 0
end

local function isFrontBeam(b)
  local origin = (b.partOrigin or "") .. " " .. (b.partPath or "")
  if strContains(origin, "_f") or strContains(origin, "front") then
    return true
  end
  if strContains(origin, "_r") or strContains(origin, "rear") then
    return false
  end
  return beamMidY(b) < avgWheelY
end

local function isRearWheel(w)
  if strContains(w.name, "R") and not strContains(w.name, "FR") then
    return true
  end
  if strContains(w.name, "RL") or strContains(w.name, "RR") then
    return true
  end
  local node = w.node1 and v and v.data and v.data.nodes and v.data.nodes[w.node1]
  if node and node.pos then
    return node.pos.y > avgWheelY
  end
  return false
end

local function captureBaselines()
  if not v or not v.data then return end
  avgWheelY = computeAvgWheelY()

  if v.data.beams and next(baseBeams) == nil then
    for _, b in pairs(v.data.beams) do
      if b.cid and type(b.beamSpring) == "number" then
        baseBeams[b.cid] = {
          spring = b.beamSpring,
          damp = type(b.beamDamp) == "number" and b.beamDamp or 1000,
          dampRebound = type(b.beamDampRebound) == "number" and b.beamDampRebound or (type(b.beamDamp) == "number" and b.beamDamp or 1000),
          partOrigin = (b.partOrigin or "") .. " " .. (b.partPath or ""),
          beamType = b.beamType,
          isFront = isFrontBeam(b),
        }
      end
    end
  end

  if hydros and hydros.hydros and next(baseHydros) == nil then
    for idx, h in pairs(hydros.hydros) do
      if h.inputSource == "steering_input" then
        baseHydros[idx] = {
          factor = type(h.factor) == "number" and h.factor or nil,
          inLimit = h.inLimit or 1,
          outLimit = h.outLimit or 1,
          inRate = h.inRate or 1,
          outRate = h.outRate or 1,
          steeringWheelLock = h.steeringWheelLock or 450,
          ffCoef = type(h.ffCoef) == "number" and h.ffCoef or nil,
          ffbFactor = type(h.ffbFactor) == "number" and h.ffbFactor or nil,
        }
      end
    end
  end

  if hydros and type(hydros.wheelFFBForceCoef) == "number" and baseWheelFfbCoef == nil then
    baseWheelFfbCoef = hydros.wheelFFBForceCoef
  end

  if wheels and wheels.wheels and next(baseBrakes) == nil then
    for idx, w in pairs(wheels.wheels) do
      if type(w.brakeTorque) == "number" then
        baseBrakes[idx] = {
          brakeTorque = w.brakeTorque,
          isRear = isRearWheel(w),
        }
      end
    end
  end
end

local function applyDriftModTune()
  captureBaselines()

  local springF = tonumber(cfg.springF) or ${frontSpringNm}
  local springR = tonumber(cfg.springR) or ${rearSpringNm}
  local dampBumpF = clamp(tonumber(cfg.dampBumpF) or ${tune.frontBumpDamping}, 600, 1600)
  local dampReboundF = clamp(tonumber(cfg.dampReboundF) or ${tune.frontReboundDamping}, 1000, 2200)
  local dampBumpR = clamp(tonumber(cfg.dampBumpR) or ${tune.rearBumpDamping}, 550, 1600)
  local dampReboundR = clamp(tonumber(cfg.dampReboundR) or ${tune.rearReboundDamping}, 900, 2200)

  local arbBiasR = clamp(tonumber(cfg.arbBiasR) or ${tune.rearArbBiasPct}, 20, 80)
  local frontArbSpring = clamp(tonumber(cfg.frontArbStiffness) or ${tune.frontArbStiffness}, 10000, 180000)
  local rearArbSpring = clamp(tonumber(cfg.rearArbStiffness) or ${tune.rearArbStiffness}, 10000, 180000)
  local antiSquatPct = clamp(tonumber(cfg.antiSquatPct) or ${tune.antiSquatPct}, 20, 90)
  local squatDampScale = clamp(1.0 + (antiSquatPct - 55) * 0.004, 0.85, 1.15)
  local ffbDampPct = clamp(tonumber(cfg.ffbDampingPct) or ${tune.ffbDampingPct}, 0, 60)
  local rackDampScale = clamp(0.68 + (ffbDampPct / 60) * 0.82, 0.65, 1.50)

  -- Restrict beam tuning strictly to DriftMod parts; never mutate stock body/rollcage/frame nodes
  if obj and obj.setBeamSpringDamp then
    for cid, base in pairs(baseBeams) do
      local origin = base.partOrigin
      if strContains(origin, "driftmod") then
        local isCoilover = strContains(origin, "coilover")
        local isBounded = base.beamType == BEAM_BOUNDED or base.beamType == "|BOUNDED"

        if isCoilover and not isBounded and base.spring >= 8000 and base.spring <= 1800000 then
          local mrF = 7.4
          local mrR = 4.8
          local newSpring = base.isFront and math.floor(springF * mrF) or math.floor(springR * mrR)
          if math.abs(newSpring - base.spring) > 50 then
            pcall(obj.setBeamSpringDamp, obj, cid, newSpring, 0, -1, -1)
          end
        elseif isCoilover and isBounded and base.spring == 0 and base.damp >= 50 then
          if base.isFront then
            local cBumpF = math.min(11840, math.floor(dampBumpF * 7.4))
            local cRebF = math.min(16280, math.floor(dampReboundF * 7.4))
            if math.abs(cBumpF - base.damp) > 25 or math.abs(cRebF - base.dampRebound) > 25 then
              pcall(obj.setBeamSpringDamp, obj, cid, 0, cBumpF, 0, cRebF)
            end
          else
            local cBumpR = math.min(8200, math.floor(dampBumpR * 4.8 * squatDampScale))
            local cRebR = math.min(11200, math.floor(dampReboundR * 4.8 * squatDampScale))
            if math.abs(cBumpR - base.damp) > 25 or math.abs(cRebR - base.dampRebound) > 25 then
              pcall(obj.setBeamSpringDamp, obj, cid, 0, cBumpR, 0, cRebR)
            end
          end
        elseif strContains(origin, "swaybar") and base.spring >= 2000 and base.spring <= 350000 then
          local newSpring = base.isFront and frontArbSpring or rearArbSpring
          pcall(obj.setBeamSpringDamp, obj, cid, newSpring, base.damp, newSpring, base.dampRebound)
        elseif strContains(origin, "steering") and base.damp >= 20 and base.damp <= 250 and base.spring <= 250000 then
          local newDamp = math.floor(base.damp * rackDampScale)
          pcall(obj.setBeamSpringDamp, obj, cid, base.spring, newDamp, base.spring, newDamp)
        end
      end
    end
  end

  local baseLockDeg = ${tune.steeringLockDeg}
  local lockDeg = tonumber(cfg.steerLockDeg) or baseLockDeg
  local steerSpeed = clamp(tonumber(cfg.steerSpeed) or ${tune.steeringSpeed.toFixed(2)}, 0.6, 1.8)
  local wheelDeg = clamp(tonumber(cfg.steerWheelDeg) or ${tune.steeringWheelDeg}, 540, 1080)
  local casterDeg = clamp(tonumber(cfg.casterDeg) or ${tune.frontCasterDeg.toFixed(1)}, 3.5, 11.0)
  local ffbGainPct = clamp(tonumber(cfg.ffbStrengthPct) or ${tune.ffbStrengthPct}, 60, 160)
  -- Scale relative to baked JBeam lock angle so default stays exactly 1.0
  local lockScale = clamp(lockDeg / math.max(40, baseLockDeg), 0.65, 1.30)
  local ffbScale = clamp((ffbGainPct / 100) * (0.88 + (casterDeg - 5.0) * 0.032), 0.55, 1.65)

  if hydros then
    if baseWheelFfbCoef and type(hydros.wheelFFBForceCoef) == "number" then
      hydros.wheelFFBForceCoef = baseWheelFfbCoef * ffbScale
    end
    if hydros.hydros then
      for idx, baseH in pairs(baseHydros) do
        local h = hydros.hydros[idx]
        if h then
          if baseH.factor and type(h.factor) == "number" then
            h.factor = baseH.factor * lockScale
          end
          if h.inLimit then
            local delta = (baseH.inLimit - 1) * lockScale
            h.inLimit = 1 + delta
          end
          if h.outLimit then
            local delta = (baseH.outLimit - 1) * lockScale
            h.outLimit = 1 + delta
          end
          if h.inRate then h.inRate = math.max(baseH.inRate * steerSpeed, 1.85 * steerSpeed) end
          if h.outRate then h.outRate = math.max(baseH.outRate * steerSpeed, 1.85 * steerSpeed) end
          if type(h.steeringWheelLock) == "number" then
            h.steeringWheelLock = wheelDeg * 0.5
          end
          if baseH.ffCoef and type(h.ffCoef) == "number" then
            h.ffCoef = baseH.ffCoef * ffbScale
          end
          if baseH.ffbFactor and type(h.ffbFactor) == "number" then
            h.ffbFactor = baseH.ffbFactor * ffbScale
          end
        end
      end
    end
  end

  local brakeBiasF = clamp(tonumber(cfg.brakeBiasPct) or ${tune.brakeBiasPct}, 50, 75) / 100
  local rearPsi = clamp(tonumber(cfg.rearTirePsi) or ${tune.rearTirePsi}, 12, 42)
  local frontPsi = clamp(tonumber(cfg.frontTirePsi) or ${tune.frontTirePsi}, 12, 42)
  if wheels and wheels.wheels then
    local totalFront, totalRear, fCount, rCount = 0, 0, 0, 0
    for _, baseB in pairs(baseBrakes) do
      if baseB.isRear then
        totalRear = totalRear + baseB.brakeTorque
        rCount = rCount + 1
      else
        totalFront = totalFront + baseB.brakeTorque
        fCount = fCount + 1
      end
    end
    local totalBrake = totalFront + totalRear
    if totalBrake > 0 and fCount > 0 and rCount > 0 then
      local perFront = (totalBrake * brakeBiasF) / fCount
      local perRear = (totalBrake * (1 - brakeBiasF)) / rCount
      for idx, baseB in pairs(baseBrakes) do
        local w = wheels.wheels[idx]
        if w then
          w.brakeTorque = baseB.isRear and perRear or perFront
        end
      end
    end

    if obj and obj.setGroupPressure then
      for _, w in pairs(wheels.wheels) do
        if w.pressureGroup then
          local pressure = isRearWheel(w) and rearPsi or frontPsi
          -- BeamNG obj:setGroupPressure expects absolute Pascals (gauge PSI * 6894.757 + 101325 atm)
          pcall(obj.setGroupPressure, obj, w.pressureGroup, (pressure * 6894.757) + 101325)
        end
      end
    end
  end

  local lsdPct = clamp(tonumber(cfg.lsdLockPct) or ${tune.lsdLockPct}, 0, 100)
  local finalDrive = clamp(tonumber(cfg.finalDriveRatio) or ${tune.finalDriveRatio.toFixed(2)}, 3.1, 4.9)
  local boostPsi = clamp(tonumber(cfg.turboBoostPsi) or ${tune.turboBoostPsi}, 0, 28)

  if powertrain and powertrain.getDevicesByType then
    local okDiffs, diffs = pcall(powertrain.getDevicesByType, "differential")
    if okDiffs and diffs then
      for _, d in ipairs(diffs) do
        if strContains(d.name, "rear") or strContains(d.name, "_R") or strContains(d.name, "differential_R") then
          if type(d.gearRatio) == "number" then
            d.gearRatio = finalDrive
          end
          if lsdPct >= 98 and d.setMode then
            pcall(d.setMode, d, "locked")
          elseif type(d.lsdLockCoef) == "number" then
            d.lsdLockCoef = lsdPct / 100
            if type(d.lsdRevLockCoef) == "number" then
              d.lsdRevLockCoef = (lsdPct / 100) * 0.9
            end
            if type(d.lsdPreload) == "number" then
              d.lsdPreload = 60 + lsdPct * 1.4
            end
          end
        end
      end
    end

    local okEngines, engines = pcall(powertrain.getDevicesByType, "combustionEngine")
    if okEngines and engines and boostPsi > 0 then
      for _, eng in ipairs(engines) do
        if eng.turbocharger and type(eng.turbocharger.wastegateLimit) == "number" then
          eng.turbocharger.wastegateStart = boostPsi * 6894.76 * 0.92
          eng.turbocharger.wastegateLimit = boostPsi * 6894.76
        end
      end
    end
  end
end

local function onInit(jbeamData)
  if jbeamData and next(jbeamData) ~= nil then
    cfg = jbeamData
  end
  baseBeams = {}
  baseHydros = {}
  baseBrakes = {}
  baseWheelFfbCoef = nil
  applyFramesRemaining = 5
  applyDriftModTune()
end

local function onReset(jbeamData)
  if jbeamData and next(jbeamData) ~= nil then
    cfg = jbeamData
  end
  applyFramesRemaining = 5
  applyDriftModTune()
end

local function updateGFX(dt)
  if applyFramesRemaining > 0 then
    applyFramesRemaining = applyFramesRemaining - 1
    if applyFramesRemaining == 0 then
      applyDriftModTune()
    end
  end
end

M.init = onInit
M.reset = onReset
M.updateGFX = updateGFX
return M
`;

  const pcParts: Record<string, string> = {
    ...(id === 'bx'
      ? {
          bx_body: 'bx_body_coupe',
          bx_ABS: '',
          bx_strut_bar: 'bx_strut_bar',
        }
      : {}),
    [`${id}_suspension_F`]: `${id}_driftmod_dw_suspension_F`,
    [`${id}_driftmod_subframe_F`]: `${id}_driftmod_tubular_subframe_F`,
    [`${id}_driftmod_steering_F`]: `${id}_driftmod_rack_F`,
    [`${id}_driftmod_coilover_F`]: `${id}_driftmod_coilover_F`,
    [`${id}_driftmod_swaybar_F`]: `${id}_driftmod_swaybar_F`,
    [`${id}_driftmod_hub_F`]: `${id}_driftmod_hub_F`,
    [`${id}_driftmod_brake_F`]: `${id}_driftmod_brake_F`,
    [`${id}_driftmod_wheeldata_F`]: `${id}_driftmod_wheeldata_F`,
    [`${id}_suspension_R`]: `${id}_driftmod_suspension_R`,
    [`${id}_driftmod_subframe_R`]: `${id}_driftmod_subframe_R`,
    [`${id}_driftmod_coilover_R`]: `${id}_driftmod_coilover_R`,
    [`${id}_driftmod_swaybar_R`]: `${id}_driftmod_swaybar_R`,
    [`${id}_driftmod_hub_R`]: `${id}_driftmod_hub_R`,
    [`${id}_driftmod_brake_R`]: `${id}_driftmod_brake_R`,
    [`${id}_driftmod_wheeldata_R`]: `${id}_driftmod_wheeldata_R`,
    [`${id}_differential_R`]: `${id}_driftmod_diff_R`,
  };

  const pcVars = {
    $dm_steer_lock: tune.steeringLockDeg,
    $dm_steer_speed: Number(tune.steeringSpeed.toFixed(2)),
    $dm_wheel_deg: tune.steeringWheelDeg,
    $dm_ffb_gain: tune.ffbStrengthPct,
    $dm_ffb_damp: tune.ffbDampingPct,
    $dm_spring_F: frontSpringNm,
    $dm_spring_R: rearSpringNm,
    $dm_arb_bias_R: tune.rearArbBiasPct,
    $dm_arb_spring_F: tune.frontArbStiffness,
    $dm_arb_spring_R: tune.rearArbStiffness,
    $damp_bump_F: Math.min(1600, Math.round(tune.frontBumpDamping)),
    $damp_rebound_F: Math.min(2200, Math.round(tune.frontReboundDamping)),
    $damp_bump_R: Math.min(1600, Math.round(tune.rearBumpDamping)),
    $damp_rebound_R: Math.min(2200, Math.round(tune.rearReboundDamping)),
    $rideheight_F: 0.0,
    $rideheight_R: 0.0,
    $trackoffset_F: 0.0,
    $trackoffset_R: 0.0,
    $dm_ackermann: tune.ackermannPct,
    $dm_caster_F: Number(tune.frontCasterDeg.toFixed(1)),
    $dm_camber_F: tune.frontCamberDeg,
    $dm_camber_R: tune.rearCamberDeg,
    $dm_toe_F: tune.frontToeDeg,
    $dm_toe_R: tune.rearToeDeg,
    $steer_center_F: 0,
    $dm_anti_squat: tune.antiSquatPct,
    $dm_front_psi: tune.frontTirePsi,
    $dm_cage_rigidity: Number(tune.chassisRigidity.toFixed(2)),
    $dm_rear_psi: tune.rearTirePsi,
    $dm_brake_bias: tune.brakeBiasPct,
    $braketorque_F: 2650,
    $braketorque_R: 1450,
    $dm_lsd_lock: tune.lsdLockPct,
    $dm_final_drive: Number(tune.finalDriveRatio.toFixed(2)),
    $dm_boost_psi: tune.turboBoostPsi,
  };

  const pcConfigJson = JSON.stringify(
    {
      format: 2,
      model: id,
      parts: pcParts,
      vars: pcVars,
    },
    null,
    2
  );

  const pcInfoJson = JSON.stringify(
    {
      Configuration: 'DriftMod Pro Drift',
      'Config Type': 'Custom',
      Description: `DriftMod Double Wishbone setup (${tune.steeringLockDeg}deg lock, +${tune.frontCasterDeg.toFixed(1)}deg caster, ${tune.frontCamberDeg.toFixed(1)}deg front camber, ${tune.frontTirePsi}/${tune.rearTirePsi} PSI, 900deg FFB).`,
      Drivetrain: 'RWD',
      Transmission: 'Manual',
      Value: 24500,
      'Performance Class': '7',
    },
    null,
    2
  );

  const varsReference = pcConfigJson;

  const scoringLua = `-- DriftMod Live Telemetry & Scoring Extension for BeamNG.drive
-- Auto-loaded from scripts/driftmod/modScript.lua

local M = {}

local state = {
  score = 0,
  combo = 1.0,
  runPoints = 0,
  minSlipDeg = 12,
  minSpeedKmh = 28,
  targetLockDeg = ${tune.steeringLockDeg}
}

local function onUpdate(dt)
  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  local vel = veh:getVelocity()
  local dir = veh:getDirectionVector()
  local speedMs = vel:length()
  local speedKmh = speedMs * 3.6

  if speedKmh < state.minSpeedKmh then
    if state.runPoints > 0 then
      state.score = state.score + math.floor(state.runPoints * state.combo)
      state.runPoints = 0
      state.combo = 1.0
    end
    return
  end

  local dot = (vel.x * dir.x + vel.y * dir.y) / math.max(0.001, math.sqrt(vel.x * vel.x + vel.y * vel.y) * math.sqrt(dir.x * dir.x + dir.y * dir.y))
  local slipDeg = math.deg(math.acos(math.max(-1, math.min(1, dot))))

  if slipDeg >= state.minSlipDeg and slipDeg <= (state.targetLockDeg + 15) then
    local angleFactor = slipDeg / 45.0
    local speedFactor = speedKmh / 65.0
    state.runPoints = state.runPoints + (angleFactor * speedFactor * 120 * dt)
    state.combo = math.min(5.0, state.combo + dt * 0.18)
  end
end

M.onUpdate = onUpdate
M.getState = function() return state end
return M
`;

  return [
    ...jbeamFiles,
    {
      filename: 'driftmod_suspension.dae',
      relativePath: `vehicles/${id}/driftmod/driftmod_suspension.dae`,
      language: 'xml',
      summary:
        '3D Collada (.dae) mesh geometry for Front Double Wishbones, Subframes, Drop Knuckles, Steering Rack, 2-Way Coilovers, Brakes & Rear Multi-Link.',
      content: daeXml,
    },
    {
      filename: 'main.materials.json',
      relativePath: `vehicles/${id}/driftmod/main.materials.json`,
      language: 'json',
      summary:
        'BeamNG PBR material definitions (Chromoly Orange, CNC Billet Aluminum, Gunmetal Steel, Coil Yellow, Brake Caliper Red).',
      content: materialsJson,
    },
    {
      filename: 'driftmod.lua',
      relativePath: 'lua/vehicle/controller/driftmod.lua',
      language: 'lua',
      summary:
        'BeamNG vehicle controller applying live Tuning sliders, 900° FFB SAT gain, rack damping, rear PSI, brake bias & LSD.',
      content: driftmodVehicleLua,
    },
    {
      filename: 'modScript.lua',
      relativePath: 'scripts/driftmod/modScript.lua',
      language: 'lua',
      summary:
        'BeamNG mod startup hook automatically executed when dropping the .zip into mods/; loads live drift scoring.',
      content: modScriptLua,
    },
    {
      filename: 'driftmod_pro_drift.pc',
      relativePath: `vehicles/${id}/driftmod_pro_drift.pc`,
      language: 'json',
      summary:
        'Ready-to-spawn BeamNG.drive .pc vehicle configuration with all DriftMod Double Wishbone parts, alignment, coilovers, and tire pressures pre-loaded.',
      content: pcConfigJson,
    },
    {
      filename: 'info_driftmod_pro_drift.json',
      relativePath: `vehicles/${id}/info_driftmod_pro_drift.json`,
      language: 'json',
      summary:
        'BeamNG Vehicle Selector metadata displaying "DriftMod Pro Drift" as a selectable custom configuration.',
      content: pcInfoJson,
    },
    {
      filename: `driftmod_${id}_vars.json`,
      relativePath: `vehicles/${id}/driftmod/driftmod_${id}_vars.json`,
      language: 'json',
      summary:
        'Saved DriftMod tuning variable preset reference (Double Wishbone geometry & 900° FFB wheel parameters).',
      content: varsReference,
    },
    {
      filename: 'driftmodScoring.lua',
      relativePath: 'lua/ge/extensions/driftmodScoring.lua',
      language: 'lua',
      summary:
        'In-game BeamNG game-engine Lua extension tracking vehicle velocity vs heading slip angle and combo points.',
      content: scoringLua,
    },
  ];
}

// CRC32 table for creating valid, uncompressed ZIP archives in pure TypeScript
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildModZipBlob(files: ModFileSpec[], chassisName: string): Blob {
  const encoder = new TextEncoder();
  const readmeText = [
    `# DriftMod Double Wishbone Pack (${chassisName})`,
    '',
    '1. Drop this .zip directly into your BeamNG mods folder (remove any older driftmod zip/folder first):',
    '   %localappdata%\\BeamNG.drive\\0.3x\\mods\\',
    '',
    '2. Enable the mod in BeamNG -> Repository -> Mods Manager if not auto-activated.',
    '',
    '3. Quick Spawn: Open Vehicle Selector -> your car -> pick "DriftMod Pro Drift" directly!',
    '   (Or open Vehicle Config Ctrl+W -> Save & Load -> Load "driftmod_pro_drift".)',
    '',
    '4. Manual Parts Selection (Ctrl+W -> Parts):',
    '   - Front Suspension -> Select "DriftMod Double Wishbone Front Suspension"',
    '     Sub-slots appear underneath for:',
    '       * Front Subframe (Chromoly Tubular or Gusseted Street)',
    '       * Steering Rack (Quick-Ratio Drift Rack with velocity-split damping & 900deg FFB)',
    '       * Front Coilovers (2-Way Drift Coilovers)',
    '       * Front Sway Bar (Torsionbar) & Front Drop-Knuckle 5-Lug Hubs (with 5-lug wheels)',
    '   - Rear Suspension -> Select "DriftMod Anti-Squat Multi-Link Rear Suspension"',
    '     with Rear Subframe, Rear Coilovers, Rear Sway Bar (Torsionbar), Rear 5-Lug Hubs & Rear Diff.',
    '',
    '5. Open Vehicle Config -> Tuning to adjust Front Caster, Camber, Toe, FFB Self-Steer Gain,',
    '   Rack Damping, Coilover Springs/Damping, Ride Height, Front/Rear PSI, LSD & Final Drive.',
    '',
  ].join('\n');

  const allEntries = [
    ...files.map((f) => ({ name: f.relativePath, data: encoder.encode(f.content) })),
    { name: 'README_INSTALL.txt', data: encoder.encode(readmeText) },
  ];

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of allEntries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const endRecord = new Uint8Array(22);
  const ev = new DataView(endRecord.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, allEntries.length, true);
  ev.setUint16(10, allEntries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const blobParts: BlobPart[] = [...localParts, ...centralParts, endRecord].map(
    (part) => new Uint8Array(part)
  );
  return new Blob(blobParts, { type: 'application/zip' });
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
