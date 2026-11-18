import { ChassisPreset, DriftTuneParams, ModFileSpec } from '../types/drift';

export function generateBeamNGModFiles(
  chassis: ChassisPreset,
  tune: DriftTuneParams
): ModFileSpec[] {
  const id = chassis.beamngInternalId;

  const frontSpringNm = Math.round(tune.frontSpringKn * 1000);
  const rearSpringNm = Math.round(tune.rearSpringKn * 1000);
  const frontBumpDamp = Math.round(tune.frontSpringKn * 58);
  const frontReboundDamp = Math.round(tune.frontSpringKn * 112);
  const rearBumpDamp = Math.round(tune.rearSpringKn * 52);
  const rearReboundDamp = Math.round(tune.rearSpringKn * 98);
  const wheelHalfLock = Math.round(tune.steeringWheelDeg / 2);

  const controllerPayload = {
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
    dampBumpF: frontBumpDamp,
    dampReboundF: frontReboundDamp,
    dampBumpR: rearBumpDamp,
    dampReboundR: rearReboundDamp,
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

  // Startup script executed automatically by BeamNG when zip is dropped into mods/
  const modScriptLua = `-- DriftMod Startup Loader (auto-executed by BeamNG.drive from mods/*.zip)
setExtensionUnloadMode("driftmodBuilder", "manual")
extensions.load("driftmodBuilder")

setExtensionUnloadMode("driftmodScoring", "manual")
extensions.load("driftmodScoring")
`;

  // Game-Engine extension that clones the user's exact BeamNG 0.3x stock/drift
  // front & rear suspension parts (nodes, slots, slots2, flexbodies, hubs, wheels)
  // and registers DriftMod Front & Rear Drift Suspension cleanly under Parts.
  const driftmodBuilderLua = `-- DriftMod Native Suspension Sub-Assembly Builder for BeamNG.drive
-- Clones the player's installed stock/drift *_suspension_F & *_suspension_R JBeam parts
-- so Front Suspension & Rear Suspension appear natively in Vehicle Config with 100%
-- intact nodes, wheels, hubs, coilovers, brakes, and 3D meshes across all 0.3x patches.

local M = {}

local TARGET_VEHICLES = { "${id}", "bx", "etkc", "sunburst", "sunburst2", "bastion", "fullsize" }
local BUILT_FLAG = {}

local DRIFTMOD_VARS_F = {
  { "$dm_steer_lock", "range", "deg", "DriftMod Steering & FFB", ${tune.steeringLockDeg}, 40, 72, "Max Steering Lock", "Scales steering rack hydro travel limit" },
  { "$dm_steer_speed", "range", "x", "DriftMod Steering & FFB", ${tune.steeringSpeed.toFixed(2)}, 0.60, 1.80, "Rack Speed Multiplier", "Countersteer hydro in/out rate multiplier" },
  { "$dm_wheel_deg", "range", "deg", "DriftMod Steering & FFB", ${tune.steeringWheelDeg}, 540, 1080, "FFB Wheel Rotation", "Physical steering wheel lock-to-lock (900 for DD/belt)" },
  { "$dm_ffb_gain", "range", "%", "DriftMod Steering & FFB", ${tune.ffbStrengthPct}, 60, 160, "FFB Self-Steer Gain", "Self-aligning torque strength on wheel release" },
  { "$dm_ffb_damp", "range", "%", "DriftMod Steering & FFB", ${tune.ffbDampingPct}, 0, 60, "Steering Rack Damping", "Smooths high-frequency DD wheel oscillation" },
  { "$dm_spring_F", "range", "N/m", "DriftMod Coilovers", ${frontSpringNm}, 35000, 110000, "Front Spring Rate", "Front coilover spring stiffness" },
  { "$dm_cage_rigidity", "range", "x", "DriftMod Chassis", ${tune.chassisRigidity.toFixed(2)}, 0.80, 1.50, "Chromoly Cage Rigidity", "Scales chassis torsional beam stiffness" },
  { "$dm_brake_bias", "range", "%", "DriftMod Brakes", ${tune.brakeBiasPct}, 50, 75, "Front Brake Bias", "Dual-master split for mid-drift left-foot braking" }
}

local DRIFTMOD_VARS_R = {
  { "$dm_spring_R", "range", "N/m", "DriftMod Coilovers", ${rearSpringNm}, 25000, 90000, "Rear Spring Rate", "Rear coilover spring stiffness" },
  { "$dm_arb_bias_R", "range", "%", "DriftMod Suspension", ${tune.rearArbBiasPct}, 20, 80, "Rear ARB Bias", "Front vs rear anti-roll bar roll stiffness split" },
  { "$dm_rear_psi", "range", "PSI", "DriftMod Tires", ${tune.rearTirePsi}, 12, 42, "Rear Tire Pressure", "Sets rear pressureWheels air pressure" },
  { "$dm_lsd_lock", "range", "%", "DriftMod Drivetrain", ${tune.lsdLockPct}, 0, 100, "Rear LSD / Spool Lock", "Applies clutch lockup or welded spool to rear diff" },
  { "$dm_final_drive", "range", ":1", "DriftMod Drivetrain", ${tune.finalDriveRatio.toFixed(2)}, 3.10, 4.90, "Final Drive Ratio", "Sets rear differential final drive gear ratio" },
  { "$dm_boost_psi", "range", "PSI", "DriftMod Drivetrain", ${tune.turboBoostPsi}, 0, 28, "Target Turbo Boost", "Adjusts turbo wastegate target PSI when turbo is fitted" }
}

local CONTROLLER_CFG = ${JSON.stringify(controllerPayload)}

local function deepCopy(orig)
  if type(orig) ~= "table" then return orig end
  local copy = {}
  for k, v in pairs(orig) do
    copy[deepCopy(k)] = deepCopy(v)
  end
  return copy
end

local function appendVars(part, rows)
  if type(part.variables) ~= "table" or #part.variables == 0 then
    part.variables = {
      { "name", "type", "unit", "category", "default", "min", "max", "title", "description" }
    }
  end
  local existing = {}
  for i = 2, #part.variables do
    if type(part.variables[i]) == "table" and part.variables[i][1] then
      existing[part.variables[i][1]] = true
    end
  end
  for _, row in ipairs(rows) do
    if not existing[row[1]] then
      table.insert(part.variables, deepCopy(row))
    end
  end
end

local function injectController(part)
  if type(part.controller) ~= "table" or #part.controller == 0 then
    part.controller = { { "fileName" } }
  end
  for i = 2, #part.controller do
    if type(part.controller[i]) == "table" and part.controller[i][1] == "driftmod" then
      part.controller[i][2] = deepCopy(CONTROLLER_CFG)
      return
    end
  end
  table.insert(part.controller, { "driftmod", deepCopy(CONTROLLER_CFG) })
end

local function scoreCandidate(partName, part, targetSlot)
  if type(part) ~= "table" or part.slotType ~= targetSlot then return -1 end
  if string.find(partName, "driftmod", 1, true) then return -1 end
  local lower = string.lower(partName)
  if string.find(lower, "drift", 1, true) then return 100 end
  if string.find(lower, "race", 1, true) then return 80 end
  if string.find(lower, "sport", 1, true) then return 60 end
  if partName == targetSlot then return 50 end
  return 20
end

local function buildForVehicle(vehName)
  if not FS or not FS:directoryExists("/vehicles/" .. vehName) then
    return false
  end

  local files = FS:findFiles("/vehicles/" .. vehName, "*suspension*.jbeam", -1, true, false)
  if not files or #files == 0 then return false end

  local bestFScore, bestFPart = -1, nil
  local bestRScore, bestRPart = -1, nil
  local slotF = vehName .. "_suspension_F"
  local slotR = vehName .. "_suspension_R"

  for _, fpath in ipairs(files) do
    if not string.find(fpath, "driftmod", 1, true) then
      local ok, data = pcall(jsonReadFile, fpath)
      if ok and type(data) == "table" then
        for partName, part in pairs(data) do
          local sf = scoreCandidate(partName, part, slotF)
          if sf > bestFScore then
            bestFScore = sf
            bestFPart = part
          end
          local sr = scoreCandidate(partName, part, slotR)
          if sr > bestRScore then
            bestRScore = sr
            bestRPart = part
          end
        end
      end
    end
  end

  if not bestFPart and not bestRPart then return false end

  local outTbl = {}
  if bestFPart then
    local clonedF = deepCopy(bestFPart)
    clonedF.slotType = slotF
    clonedF.information = clonedF.information or {}
    clonedF.information.authors = "DriftMod Workbench"
    clonedF.information.name = "DriftMod ${tune.steeringLockDeg}deg Front Drift Suspension (${tune.kpiDeg.toFixed(1)} KPI / ${tune.steeringWheelDeg} FFB)"
    if type(clonedF.hydros) == "table" then
      for _, row in ipairs(clonedF.hydros) do
        if type(row) == "table" and row.factor ~= nil then
          row.steeringWheelLock = ${wheelHalfLock}
        end
      end
    end
    appendVars(clonedF, DRIFTMOD_VARS_F)
    injectController(clonedF)
    outTbl[vehName .. "_driftmod_suspension_F"] = clonedF
  end

  if bestRPart then
    local clonedR = deepCopy(bestRPart)
    clonedR.slotType = slotR
    clonedR.information = clonedR.information or {}
    clonedR.information.authors = "DriftMod Workbench"
    clonedR.information.name = "DriftMod Rear Drift Suspension (${tune.rearSpringKn} kN/m / ${tune.antiSquatPct}% Anti-Squat)"
    appendVars(clonedR, DRIFTMOD_VARS_R)
    injectController(clonedR)
    outTbl[vehName .. "_driftmod_suspension_R"] = clonedR
  end

  local outPath = "/vehicles/" .. vehName .. "/driftmod/" .. vehName .. "_driftmod_suspension_generated.jbeam"
  local okWrite = pcall(jsonWriteFile, outPath, outTbl, true)
  if okWrite then
    BUILT_FLAG[vehName] = true
  end
  return okWrite
end

local function buildAll()
  local seen = {}
  for _, vehName in ipairs(TARGET_VEHICLES) do
    if not seen[vehName] then
      seen[vehName] = true
      buildForVehicle(vehName)
    end
  end
end

local function onExtensionLoaded()
  buildAll()
end

local function onVehicleSpawned(vehId)
  local veh = be and be:getObjectByID(vehId)
  if not veh or not veh.getJBeamFilename then return end
  local vehName = veh:getJBeamFilename()
  if vehName and not BUILT_FLAG[vehName] then
    if buildForVehicle(vehName) and extensions and extensions.core_vehicles and extensions.core_vehicles.reloadVehicle then
      pcall(extensions.core_vehicles.reloadVehicle, 0)
    end
  end
end

M.onExtensionLoaded = onExtensionLoaded
M.onVehicleSpawned = onVehicleSpawned
M.rebuild = buildAll
return M
`;

  // Fallback Additional Modification JBeam part (`${id}_mod`) so users can also
  // apply DriftMod on top of any third-party or custom suspension setup.
  const driftModKitJbeam = `{
  "${id}_driftmod_kit": {
    "information": {
      "authors": "DriftMod Workbench",
      "name": "DriftMod ${tune.steeringLockDeg}° / ${tune.steeringWheelDeg}° FFB Package (Additional Mod)",
      "value": 4500
    },
    "slotType": "${id}_mod",
    "variables": [
      ["name", "type", "unit", "category", "default", "min", "max", "title", "description"],
      ["$dm_steer_lock", "range", "deg", "DriftMod Steering & FFB", ${tune.steeringLockDeg}, 40, 72, "Max Steering Lock", "Scales steering rack hydro travel limit without breaking suspension geometry"],
      ["$dm_steer_speed", "range", "x", "DriftMod Steering & FFB", ${tune.steeringSpeed.toFixed(2)}, 0.60, 1.80, "Rack Speed Multiplier", "Countersteer hydro in/out rate multiplier"],
      ["$dm_wheel_deg", "range", "deg", "DriftMod Steering & FFB", ${tune.steeringWheelDeg}, 540, 1080, "FFB Wheel Rotation", "Physical steering wheel lock-to-lock (900 for DD/belt wheels)"],
      ["$dm_ffb_gain", "range", "%", "DriftMod Steering & FFB", ${tune.ffbStrengthPct}, 60, 160, "FFB Self-Steer Gain", "Self-aligning torque strength on wheel release"],
      ["$dm_ffb_damp", "range", "%", "DriftMod Steering & FFB", ${tune.ffbDampingPct}, 0, 60, "Steering Rack Damping", "Smooths high-frequency DD oscillation"],
      ["$dm_spring_F", "range", "N/m", "DriftMod Coilovers", ${frontSpringNm}, 35000, 110000, "Front Spring Rate", "Applied live to installed front coilover/strut beams"],
      ["$dm_spring_R", "range", "N/m", "DriftMod Coilovers", ${rearSpringNm}, 25000, 90000, "Rear Spring Rate", "Applied live to installed rear coilover/spring beams"],
      ["$dm_arb_bias_R", "range", "%", "DriftMod Suspension", ${tune.rearArbBiasPct}, 20, 80, "Rear ARB Bias", "Balances front vs rear anti-roll bar beam stiffness"],
      ["$dm_cage_rigidity", "range", "x", "DriftMod Chassis", ${tune.chassisRigidity.toFixed(2)}, 0.80, 1.50, "Chromoly Cage Rigidity", "Scales chassis/body torsional beam stiffness"],
      ["$dm_rear_psi", "range", "PSI", "DriftMod Tires & Brakes", ${tune.rearTirePsi}, 12, 42, "Rear Tire Pressure", "Sets rear tire air pressure on pressureWheels"],
      ["$dm_brake_bias", "range", "%", "DriftMod Tires & Brakes", ${tune.brakeBiasPct}, 50, 75, "Front Brake Bias", "Dual-master front/rear brake torque split"],
      ["$dm_lsd_lock", "range", "%", "DriftMod Drivetrain", ${tune.lsdLockPct}, 0, 100, "Rear LSD / Spool Lock", "Applies clutch lockup or welded spool to rear diff"],
      ["$dm_final_drive", "range", ":1", "DriftMod Drivetrain", ${tune.finalDriveRatio.toFixed(2)}, 3.10, 4.90, "Final Drive Ratio", "Sets rear differential / final drive gear ratio"],
      ["$dm_boost_psi", "range", "PSI", "DriftMod Drivetrain", ${tune.turboBoostPsi}, 0, 28, "Target Turbo Boost", "Adjusts turbo wastegate target PSI when turbo is fitted"]
    ],
    "controller": [
      ["fileName"],
      ["driftmod", ${JSON.stringify(controllerPayload)}]
    ]
  }
}`;

  // Vehicle-side Lua controller (`lua/vehicle/controller/driftmod.lua`) calibrated for
  // real BeamNG suspension physics and crisp 900-degree DD / belt wheel FFB self-steer.
  const driftmodVehicleLua = `-- DriftMod Runtime Vehicle & 900deg FFB Controller for BeamNG.drive
-- Loaded by DriftMod Front/Rear Drift Suspension OR Additional Modification (${id}_mod)

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
  local dampBumpF = math.floor(springF * 0.058)
  local dampReboundF = math.floor(springF * 0.112)
  local dampBumpR = math.floor(springR * 0.052)
  local dampReboundR = math.floor(springR * 0.098)

  local arbBiasR = clamp(tonumber(cfg.arbBiasR) or ${tune.rearArbBiasPct}, 20, 80)
  local frontArbScale = clamp(1.0 + (50 - arbBiasR) * 0.014, 0.45, 1.75)
  local rearArbScale = clamp(1.0 + (arbBiasR - 50) * 0.014, 0.25, 1.75)
  local cageScale = clamp(tonumber(cfg.cageRigidity) or ${tune.chassisRigidity.toFixed(2)}, 0.85, 1.35)
  local ffbDampPct = clamp(tonumber(cfg.ffbDampingPct) or ${tune.ffbDampingPct}, 0, 60)
  local rackDampScale = clamp(0.68 + (ffbDampPct / 60) * 0.82, 0.65, 1.50)

  -- 1. Apply coilover springs/dampers, ARB balance, steering damper & cage rigidity
  if obj and obj.setBeamSpringDamp then
    for cid, base in pairs(baseBeams) do
      local origin = base.partOrigin
      local isSpringOrStrut =
        strContains(origin, "coilover") or
        strContains(origin, "strut") or
        strContains(origin, "spring") or
        strContains(origin, "shock")
      local isBounded = base.beamType == BEAM_BOUNDED or base.beamType == "|BOUNDED"

      if isSpringOrStrut and isBounded then
        if base.spring >= 8000 and base.spring <= 350000 then
          if base.isFront then
            pcall(obj.setBeamSpringDamp, obj, cid, springF, dampBumpF, springF, dampReboundF)
          else
            pcall(obj.setBeamSpringDamp, obj, cid, springR, dampBumpR, springR, dampReboundR)
          end
        elseif base.spring < 1000 and (base.damp >= 400 or base.dampRebound >= 400) then
          if base.isFront then
            pcall(obj.setBeamSpringDamp, obj, cid, base.spring, dampBumpF, base.spring, dampReboundF)
          else
            pcall(obj.setBeamSpringDamp, obj, cid, base.spring, dampBumpR, base.spring, dampReboundR)
          end
        end
      elseif (strContains(origin, "swaybar") or strContains(origin, "antiroll")) and base.spring >= 2000 and base.spring <= 350000 then
        local scale = base.isFront and frontArbScale or rearArbScale
        local newSpring = math.floor(base.spring * scale)
        pcall(obj.setBeamSpringDamp, obj, cid, newSpring, base.damp, newSpring, base.dampRebound)
      elseif strContains(origin, "steering") and base.damp >= 40 and base.damp <= 6000 and base.spring <= 250000 then
        -- Smooth high-frequency DD wheel oscillation directly on steering rack damper beams
        local newDamp = math.floor(base.damp * rackDampScale)
        pcall(obj.setBeamSpringDamp, obj, cid, base.spring, newDamp, base.spring, newDamp)
      elseif (strContains(origin, "body") or strContains(origin, "rollcage") or strContains(origin, "frame")) and base.spring >= 250000 and base.spring <= 12000000 and cageScale ~= 1.0 then
        local newSpring = math.floor(base.spring * cageScale)
        pcall(obj.setBeamSpringDamp, obj, cid, newSpring, base.damp, newSpring, base.dampRebound)
      end
    end
  end

  -- 2. Calibrate steering hydro travel, 900deg wheel lock, fast DD rack rate & FFB SAT gain
  local lockDeg = tonumber(cfg.steerLockDeg) or ${tune.steeringLockDeg}
  local steerSpeed = clamp(tonumber(cfg.steerSpeed) or ${tune.steeringSpeed.toFixed(2)}, 0.6, 1.8)
  local wheelDeg = clamp(tonumber(cfg.steerWheelDeg) or ${tune.steeringWheelDeg}, 540, 1080)
  local casterDeg = clamp(tonumber(cfg.casterDeg) or ${tune.frontCasterDeg.toFixed(1)}, 3.0, 10.5)
  local ffbGainPct = clamp(tonumber(cfg.ffbStrengthPct) or ${tune.ffbStrengthPct}, 60, 160)
  local lockScale = clamp(lockDeg / 48, 0.88, 1.28)
  local ffbScale = clamp((ffbGainPct / 100) * (0.88 + (casterDeg - 5.0) * 0.032), 0.55, 1.65)

  if hydros then
    if baseWheelFfbCoef and type(hydros.wheelFFBForceCoef) == "number" then
      hydros.wheelFFBForceCoef = baseWheelFfbCoef * ffbScale
    end
    if hydros.hydros then
      for idx, baseH in pairs(baseHydros) do
        local h = hydros.hydros[idx]
        if h then
          if h.inLimit then
            local delta = (baseH.inLimit - 1) * lockScale
            h.inLimit = 1 + delta
          end
          if h.outLimit then
            local delta = (baseH.outLimit - 1) * lockScale
            h.outLimit = 1 + delta
          end
          -- Keep hydraulic rate high (>= 3.6) so 900deg DD self-steer never lags behind wheel release
          if h.inRate then h.inRate = math.max(baseH.inRate * steerSpeed, 3.6 * steerSpeed) end
          if h.outRate then h.outRate = math.max(baseH.outRate * steerSpeed, 3.6 * steerSpeed) end
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

  -- 3. Apply dual-master front/rear brake bias & rear tire PSI
  local brakeBiasF = clamp(tonumber(cfg.brakeBiasPct) or ${tune.brakeBiasPct}, 50, 75) / 100
  local rearPsi = clamp(tonumber(cfg.rearTirePsi) or ${tune.rearTirePsi}, 12, 42)
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
        if isRearWheel(w) and w.pressureGroup then
          pcall(obj.setGroupPressure, obj, w.pressureGroup, rearPsi * 6894.76)
        end
      end
    end
  end

  -- 4. Apply LSD lock rate / welded spool & final drive ratio via powertrain
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

  const varsReference = JSON.stringify(
    {
      format: 2,
      model: id,
      parts: {
        [`${id}_suspension_F`]: `${id}_driftmod_suspension_F`,
        [`${id}_suspension_R`]: `${id}_driftmod_suspension_R`,
      },
      vars: {
        $dm_steer_lock: tune.steeringLockDeg,
        $dm_steer_speed: tune.steeringSpeed,
        $dm_wheel_deg: tune.steeringWheelDeg,
        $dm_ffb_gain: tune.ffbStrengthPct,
        $dm_ffb_damp: tune.ffbDampingPct,
        $dm_spring_F: frontSpringNm,
        $dm_spring_R: rearSpringNm,
        $dm_arb_bias_R: tune.rearArbBiasPct,
        $dm_cage_rigidity: tune.chassisRigidity,
        $dm_rear_psi: tune.rearTirePsi,
        $dm_brake_bias: tune.brakeBiasPct,
        $dm_lsd_lock: tune.lsdLockPct,
        $dm_final_drive: tune.finalDriveRatio,
        $dm_boost_psi: tune.turboBoostPsi,
      },
    },
    null,
    2
  );

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
    {
      filename: 'modScript.lua',
      relativePath: 'scripts/driftmod/modScript.lua',
      language: 'lua',
      summary:
        'BeamNG mod startup hook automatically executed when dropping the .zip into mods/; loads suspension builder & drift scoring.',
      content: modScriptLua,
    },
    {
      filename: 'driftmodBuilder.lua',
      relativePath: 'lua/ge/extensions/driftmodBuilder.lua',
      language: 'lua',
      summary:
        'Clones your installed stock/drift Front & Rear Suspension JBeam parts so DriftMod appears right under Front/Rear Suspension with intact hubs, wheels, brakes & 3D meshes.',
      content: driftmodBuilderLua,
    },
    {
      filename: 'driftmod.lua',
      relativePath: 'lua/vehicle/controller/driftmod.lua',
      language: 'lua',
      summary:
        'BeamNG vehicle controller applying coilover springs/dampers, ARB balance, 900° FFB SAT gain, steering rack damping, rear PSI, brake bias & LSD.',
      content: driftmodVehicleLua,
    },
    {
      filename: `${id}_driftmod_kit.jbeam`,
      relativePath: `vehicles/${id}/driftmod/${id}_driftmod_kit.jbeam`,
      language: 'json',
      summary:
        `Additional Modification (${id}_mod) fallback JBeam if applying DriftMod on top of another aftermarket suspension.`,
      content: driftModKitJbeam,
    },
    {
      filename: `driftmod_${id}_vars.json`,
      relativePath: `vehicles/${id}/driftmod/driftmod_${id}_vars.json`,
      language: 'json',
      summary:
        'Saved DriftMod tuning variable preset reference (including 900° FFB wheel parameters).',
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
    `# DriftMod Pack (${chassisName})`,
    '',
    '1. Drop this .zip directly into your BeamNG mods folder (remove any older driftmod zip/folder first):',
    '   %localappdata%\\BeamNG.drive\\0.3x\\mods\\',
    '',
    '2. Enable the mod in BeamNG -> Repository -> Mods Manager if not auto-activated.',
    '',
    '3. Spawn your 200BX (or supported chassis), open Vehicle Config (Ctrl+W) -> Parts:',
    '   - Select "DriftMod Front Drift Suspension" under Front Suspension',
    '   - Select "DriftMod Rear Drift Suspension" under Rear Suspension',
    '   (Your wheels, hubs, brakes, coilovers, and 3D arms stay 100% intact.)',
    '',
    '4. Open Vehicle Config -> Tuning to fine-tune FFB Self-Steer Gain, Rack Damping,',
    '   900deg Wheel Lock, Springs, ARB, Rear PSI, Brake Bias, LSD & Final Drive live.',
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
