-- DriftMod Live Telemetry & Scoring Extension for BeamNG.drive
-- Auto-loaded from scripts/driftmod/modScript.lua

local M = {}

local state = {
  score = 0,
  combo = 1.0,
  runPoints = 0,
  minSlipDeg = 12,
  minSpeedKmh = 28,
  targetLockDeg = 64
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
