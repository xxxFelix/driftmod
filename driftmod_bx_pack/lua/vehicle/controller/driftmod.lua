-- DriftMod Runtime Vehicle & 900deg FFB Controller for BeamNG.drive
-- Loaded by bx_driftmod_dw_suspension_F

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

  local springF = tonumber(cfg.springF) or 78000
  local springR = tonumber(cfg.springR) or 48000
  local dampBumpF = math.min(1800, math.floor(springF * 0.016))
  local dampReboundF = math.min(2800, math.floor(springF * 0.026))
  local dampBumpR = math.min(1600, math.floor(springR * 0.015))
  local dampReboundR = math.min(2500, math.floor(springR * 0.024))

  local arbBiasR = clamp(tonumber(cfg.arbBiasR) or 34, 20, 80)
  local frontArbScale = clamp(1.0 + (50 - arbBiasR) * 0.014, 0.45, 1.75)
  local rearArbScale = clamp(1.0 + (arbBiasR - 50) * 0.014, 0.25, 1.75)
  local cageScale = clamp(tonumber(cfg.cageRigidity) or 1.25, 0.85, 1.20)
  local ffbDampPct = clamp(tonumber(cfg.ffbDampingPct) or 16, 0, 60)
  local rackDampScale = clamp(0.68 + (ffbDampPct / 60) * 0.82, 0.65, 1.50)

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
        if base.spring >= 8000 and base.spring <= 650000 then
          local isDriftMod = strContains(origin, "driftmod")
          if base.isFront then
            local mrF = isDriftMod and 7.61 or 1.0
            local cBumpF = math.min(13700, math.floor(dampBumpF * mrF))
            local cRebF = math.min(21350, math.floor(dampReboundF * mrF))
            pcall(obj.setBeamSpringDamp, obj, cid, math.floor(springF * mrF), cBumpF, math.floor(springF * mrF), cRebF)
          else
            local mrR = isDriftMod and 3.87 or 1.0
            local cBumpR = math.min(6000, math.floor(dampBumpR * mrR))
            local cRebR = math.min(9400, math.floor(dampReboundR * mrR))
            pcall(obj.setBeamSpringDamp, obj, cid, math.floor(springR * mrR), cBumpR, math.floor(springR * mrR), cRebR)
          end
        end
      elseif (strContains(origin, "swaybar") or strContains(origin, "antiroll")) and base.spring >= 2000 and base.spring <= 350000 then
        local scale = base.isFront and frontArbScale or rearArbScale
        local newSpring = math.floor(base.spring * scale)
        pcall(obj.setBeamSpringDamp, obj, cid, newSpring, base.damp, newSpring, base.dampRebound)
      elseif strContains(origin, "steering") and base.damp >= 20 and base.damp <= 6000 and base.spring <= 250000 then
        local newDamp = math.floor(base.damp * rackDampScale)
        pcall(obj.setBeamSpringDamp, obj, cid, base.spring, newDamp, base.spring, newDamp)
      elseif (strContains(origin, "body") or strContains(origin, "rollcage") or strContains(origin, "frame")) and base.spring >= 250000 and base.spring <= 12000000 and cageScale ~= 1.0 then
        local newSpring = math.floor(base.spring * cageScale)
        pcall(obj.setBeamSpringDamp, obj, cid, newSpring, base.damp, newSpring, base.dampRebound)
      end
    end
  end

  local baseLockDeg = 64
  local lockDeg = tonumber(cfg.steerLockDeg) or baseLockDeg
  local steerSpeed = clamp(tonumber(cfg.steerSpeed) or 1.32, 0.6, 1.8)
  local wheelDeg = clamp(tonumber(cfg.steerWheelDeg) or 900, 540, 1080)
  local casterDeg = clamp(tonumber(cfg.casterDeg) or 7.8, 3.0, 10.5)
  local ffbGainPct = clamp(tonumber(cfg.ffbStrengthPct) or 120, 60, 160)
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
          if h.inRate then h.inRate = math.max(baseH.inRate * steerSpeed, 3.8 * steerSpeed) end
          if h.outRate then h.outRate = math.max(baseH.outRate * steerSpeed, 3.8 * steerSpeed) end
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

  local brakeBiasF = clamp(tonumber(cfg.brakeBiasPct) or 65, 50, 75) / 100
  local rearPsi = clamp(tonumber(cfg.rearTirePsi) or 20, 12, 42)
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

  local lsdPct = clamp(tonumber(cfg.lsdLockPct) or 96, 0, 100)
  local finalDrive = clamp(tonumber(cfg.finalDriveRatio) or 4.11, 3.1, 4.9)
  local boostPsi = clamp(tonumber(cfg.turboBoostPsi) or 17, 0, 28)

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
