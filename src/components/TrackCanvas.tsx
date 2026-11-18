import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Compass } from 'lucide-react';
import { TRACK_PRESETS } from '../data/presets';
import {
  ChassisPreset,
  DriftTuneParams,
  LiveHudState,
  TelemetrySample,
  TrackDefinition,
  TrackId,
} from '../types/drift';
import {
  CarSimState,
  createInitialCarState,
  InputControls,
  stepDriftPhysics,
} from '../utils/driftPhysics';

interface TrackCanvasProps {
  chassis: ChassisPreset;
  tune: DriftTuneParams;
  track: TrackDefinition;
  onSelectTrack: (id: TrackId) => void;
  onTelemetrySample: (sample: TelemetrySample) => void;
}

export const TrackCanvas: React.FC<TrackCanvasProps> = ({
  chassis,
  tune,
  track,
  onSelectTrack,
  onTelemetrySample,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<CarSimState>(createInitialCarState(track));
  const keysRef = useRef<Set<string>>(new Set());
  const touchInputRef = useRef<Partial<InputControls>>({});

  const [autopilot, setAutopilot] = useState(true);
  const [showVectors, setShowVectors] = useState(true);
  const [paused, setPaused] = useState(false);

  const [hud, setHud] = useState<LiveHudState>({
    speedKmh: 0,
    rpm: 2400,
    gear: 2,
    slipAngleDeg: 0,
    lateralG: 0,
    boostPsi: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    isDrifting: false,
    currentDriftPoints: 0,
    comboMultiplier: 1.0,
    totalScore: 0,
    bestDriftRun: 0,
    clipZoneActive: null,
  });

  // Reset car position when switching tracks
  useEffect(() => {
    simRef.current = createInitialCarState(track);
  }, [track]);

  // Keyboard listener (WASD / Arrow keys + Space handbrake + Shift clutch kick)
  useEffect(() => {
    const driveKeys = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Space',
      'ShiftLeft',
      'ShiftRight',
    ]);

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (driveKeys.has(e.code)) {
        if (e.code === 'Space' || e.code.startsWith('Arrow')) {
          e.preventDefault();
        }
        keysRef.current.add(e.code);
        // Pressing any driving key automatically hands control to player
        setAutopilot(false);
      }
      if (e.code === 'KeyR') {
        simRef.current = createInitialCarState(track);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [track]);

  // Main 60fps simulation + render loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let hudTimer = 0;
    let sampleTimer = 0;

    const renderFrame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const keys = keysRef.current;
      const touch = touchInputRef.current;
      const steerVal =
        touch.steer !== undefined
          ? touch.steer
          : (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
            (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);

      const input: InputControls = {
        throttle:
          touch.throttle !== undefined
            ? touch.throttle
            : keys.has('KeyW') || keys.has('ArrowUp')
            ? 1
            : 0,
        brake:
          touch.brake !== undefined
            ? touch.brake
            : keys.has('KeyS') || keys.has('ArrowDown')
            ? 1
            : 0,
        steer: steerVal,
        handbrake: Boolean(touch.handbrake) || keys.has('Space'),
        clutchKick:
          Boolean(touch.clutchKick) ||
          keys.has('ShiftLeft') ||
          keys.has('ShiftRight'),
      };

      let latestHud: LiveHudState | null = null;
      if (!paused) {
        latestHud = stepDriftPhysics(
          simRef.current,
          input,
          autopilot,
          chassis,
          tune,
          track,
          dt
        );
      }

      hudTimer += dt;
      if (latestHud && hudTimer >= 0.06) {
        hudTimer = 0;
        setHud(latestHud);
      }

      sampleTimer += dt;
      if (latestHud && sampleTimer >= 0.16) {
        sampleTimer = 0;
        onTelemetrySample({
          timeSec: Number((now / 1000).toFixed(2)),
          speedKmh: latestHud.speedKmh,
          slipAngleDeg: latestHud.slipAngleDeg,
          throttlePct: Math.round(latestHud.throttle * 100),
          lateralG: latestHud.lateralG,
        });
      }

      drawTrackAndCar(
        canvasRef.current,
        simRef.current,
        track,
        chassis,
        showVectors
      );

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [autopilot, chassis, onTelemetrySample, paused, showVectors, track, tune]);

  const handleResetCar = () => {
    simRef.current = createInitialCarState(track);
  };

  const setTouchControl = (patch: Partial<InputControls>) => {
    setAutopilot(false);
    touchInputRef.current = { ...touchInputRef.current, ...patch };
  };

  return (
    <section className="flex flex-col gap-3">
      {/* Track & Simulation Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#232834] bg-[#13161D] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {TRACK_PRESETS.map((t) => {
            const active = t.id === track.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTrack(t.id)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-orange-500 text-slate-950 font-semibold'
                    : 'bg-[#0B0D11] text-[#9AA4B2] hover:text-[#F4F6F8]'
                }`}
              >
                {t.name.split(' — ')[0]}
              </button>
            );
          })}
          <span className="ml-2 hidden text-xs text-[#7D8796] xl:inline">
            {track.surfaceLabel} · μ {track.surfaceGripMult.toFixed(2)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutopilot((prev) => !prev)}
            className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              autopilot
                ? 'border-sky-500/70 bg-sky-500/15 text-sky-300'
                : 'border-[#2C3240] bg-[#0B0D11] text-[#D1D5DB] hover:border-[#3E4658]'
            }`}
          >
            {autopilot ? 'Driver: AI Demo' : 'Driver: Manual (WASD)'}
          </button>

          <button
            type="button"
            onClick={() => setShowVectors((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              showVectors
                ? 'border-[#3E4658] bg-[#1D222D] text-[#F4F6F8]'
                : 'border-[#232834] bg-[#0B0D11] text-[#9AA4B2]'
            }`}
          >
            <Compass className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Vectors</span>
          </button>

          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Resume Simulation' : 'Pause Simulation'}
            className="inline-flex items-center gap-1.5 rounded border border-[#2C3240] bg-[#0B0D11] px-2.5 py-1.5 text-xs font-medium text-[#D1D5DB] hover:border-[#3E4658] hover:text-white whitespace-nowrap shrink-0"
          >
            {paused ? (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{paused ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetCar}
            aria-label="Reset Car Position"
            className="inline-flex items-center gap-1.5 rounded border border-[#2C3240] bg-[#0B0D11] px-2.5 py-1.5 text-xs font-medium text-[#D1D5DB] hover:border-[#3E4658] hover:text-white whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset Car</span>
          </button>
        </div>
      </div>

      {/* Interactive Drift Track Canvas */}
      <div className="relative overflow-hidden rounded-lg border border-[#232834] bg-[#090B0E]">
        <canvas
          ref={canvasRef}
          width={1000}
          height={620}
          className="block aspect-[1000/620] w-full"
        />

        {/* Compact Top-Left Drift Score Overlay */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-baseline gap-4 rounded border border-[#232834] bg-[#0B0D11]/85 px-3 py-2 backdrop-blur-xs">
          <div>
            <div className="text-[11px] font-medium text-[#9AA4B2]">
              Active Drift
            </div>
            <div className="font-mono text-lg font-semibold text-orange-400 tabular-nums">
              {hud.currentDriftPoints.toLocaleString()}
              <span className="ml-1.5 text-xs text-sky-400">
                ×{hud.comboMultiplier.toFixed(1)}
              </span>
            </div>
          </div>
          <div className="h-7 w-px bg-[#232834]" />
          <div>
            <div className="text-[11px] font-medium text-[#9AA4B2]">
              Session Total
            </div>
            <div className="font-mono text-lg font-semibold text-[#F4F6F8] tabular-nums">
              {hud.totalScore.toLocaleString()}
            </div>
          </div>
          {hud.clipZoneActive && (
            <>
              <div className="h-7 w-px bg-[#232834]" />
              <div className="text-xs font-semibold text-amber-400">
                {hud.clipZoneActive} · 1.5x
              </div>
            </>
          )}
        </div>

        {/* Keyboard Hint & Manual Touch/Mouse Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#232834] bg-[#0F1218] px-3 py-2 text-xs">
          <span className="text-[#9AA4B2]">
            Controls: <strong className="text-[#F4F6F8]">W/S</strong> Throttle &amp; Brake ·{' '}
            <strong className="text-[#F4F6F8]">A/D</strong> Steer ·{' '}
            <strong className="text-[#F4F6F8]">Space</strong> Handbrake ·{' '}
            <strong className="text-[#F4F6F8]">Shift</strong> Clutch Kick ·{' '}
            <strong className="text-[#F4F6F8]">R</strong> Reset
          </span>

          <div className="flex items-center gap-1.5 select-none">
            <button
              type="button"
              onMouseDown={() => setTouchControl({ steer: -1 })}
              onMouseUp={() => setTouchControl({ steer: undefined })}
              onMouseLeave={() => setTouchControl({ steer: undefined })}
              onTouchStart={() => setTouchControl({ steer: -1 })}
              onTouchEnd={() => setTouchControl({ steer: undefined })}
              className="rounded border border-[#2C3240] bg-[#171B24] px-2.5 py-1 font-mono text-[11px] text-[#F4F6F8] active:bg-orange-500 active:text-slate-950"
            >
              Left
            </button>
            <button
              type="button"
              onMouseDown={() => setTouchControl({ steer: 1 })}
              onMouseUp={() => setTouchControl({ steer: undefined })}
              onMouseLeave={() => setTouchControl({ steer: undefined })}
              onTouchStart={() => setTouchControl({ steer: 1 })}
              onTouchEnd={() => setTouchControl({ steer: undefined })}
              className="rounded border border-[#2C3240] bg-[#171B24] px-2.5 py-1 font-mono text-[11px] text-[#F4F6F8] active:bg-orange-500 active:text-slate-950"
            >
              Right
            </button>
            <button
              type="button"
              onMouseDown={() => setTouchControl({ throttle: 1 })}
              onMouseUp={() => setTouchControl({ throttle: undefined })}
              onMouseLeave={() => setTouchControl({ throttle: undefined })}
              onTouchStart={() => setTouchControl({ throttle: 1 })}
              onTouchEnd={() => setTouchControl({ throttle: undefined })}
              className="rounded border border-[#2C3240] bg-[#171B24] px-2.5 py-1 font-mono text-[11px] text-emerald-300 active:bg-emerald-500 active:text-slate-950"
            >
              Gas
            </button>
            <button
              type="button"
              onMouseDown={() => setTouchControl({ handbrake: true })}
              onMouseUp={() => setTouchControl({ handbrake: false })}
              onMouseLeave={() => setTouchControl({ handbrake: false })}
              onTouchStart={() => setTouchControl({ handbrake: true })}
              onTouchEnd={() => setTouchControl({ handbrake: false })}
              className="rounded border border-[#2C3240] bg-[#171B24] px-2.5 py-1 font-mono text-[11px] text-orange-300 active:bg-orange-500 active:text-slate-950"
            >
              E-Brake
            </button>
          </div>
        </div>
      </div>

      {/* Live Instrument Telemetry Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-[#232834] bg-[#13161D] px-3.5 py-2.5">
          <div className="text-[11px] text-[#9AA4B2]">Speed</div>
          <div className="mt-0.5 font-mono text-xl font-semibold text-[#F4F6F8] tabular-nums">
            {hud.speedKmh} <span className="text-xs font-normal text-[#9AA4B2]">km/h</span>
          </div>
        </div>

        <div className="rounded-lg border border-[#232834] bg-[#13161D] px-3.5 py-2.5">
          <div className="text-[11px] text-[#9AA4B2]">Engine RPM</div>
          <div className="mt-0.5 font-mono text-xl font-semibold text-[#F4F6F8] tabular-nums">
            {hud.rpm.toLocaleString()}{' '}
            <span className="text-xs font-normal text-orange-400">
              {hud.gear === 0 ? 'R' : `G${hud.gear}`}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-[#232834] bg-[#13161D] px-3.5 py-2.5">
          <div className="text-[11px] text-[#9AA4B2]">Slip Angle</div>
          <div
            className={`mt-0.5 font-mono text-xl font-semibold tabular-nums ${
              hud.isDrifting ? 'text-orange-400' : 'text-[#F4F6F8]'
            }`}
          >
            {hud.slipAngleDeg.toFixed(1)}°
          </div>
        </div>

        <div className="rounded-lg border border-[#232834] bg-[#13161D] px-3.5 py-2.5">
          <div className="text-[11px] text-[#9AA4B2]">Turbo Boost</div>
          <div className="mt-0.5 font-mono text-xl font-semibold text-sky-400 tabular-nums">
            {hud.boostPsi.toFixed(1)}{' '}
            <span className="text-xs font-normal text-[#9AA4B2]">PSI</span>
          </div>
        </div>

        <div className="rounded-lg border border-[#232834] bg-[#13161D] px-3.5 py-2.5">
          <div className="text-[11px] text-[#9AA4B2]">Lateral Load</div>
          <div className="mt-0.5 font-mono text-xl font-semibold text-[#F4F6F8] tabular-nums">
            {hud.lateralG.toFixed(2)}{' '}
            <span className="text-xs font-normal text-[#9AA4B2]">G</span>
          </div>
        </div>

        <div className="rounded-lg border border-[#232834] bg-[#13161D] px-3.5 py-2.5">
          <div className="text-[11px] text-[#9AA4B2]">Best Drift Run</div>
          <div className="mt-0.5 font-mono text-xl font-semibold text-emerald-400 tabular-nums">
            {hud.bestDriftRun.toLocaleString()}
          </div>
        </div>
      </div>
    </section>
  );
};

function drawTrackAndCar(
  canvas: HTMLCanvasElement | null,
  car: CarSimState,
  track: TrackDefinition,
  chassis: ChassisPreset,
  showVectors: boolean
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = track.worldWidth;
  const h = track.worldHeight;

  // Ground / tarmac apron
  ctx.fillStyle = '#0D1016';
  ctx.fillRect(0, 0, w, h);

  // Subtle coordinate grid on infield
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= w; gx += 50) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = 0; gy <= h; gy += 50) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // Draw closed smooth track path using quadratic midpoints
  const wps = track.waypoints;
  const traceLoop = () => {
    ctx.beginPath();
    const firstMidX = (wps[wps.length - 1].x + wps[0].x) / 2;
    const firstMidY = (wps[wps.length - 1].y + wps[0].y) / 2;
    ctx.moveTo(firstMidX, firstMidY);
    for (let i = 0; i < wps.length; i++) {
      const curr = wps[i];
      const next = wps[(i + 1) % wps.length];
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }
    ctx.closePath();
  };

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Outer rumble curb border
  traceLoop();
  ctx.strokeStyle = '#991B1B';
  ctx.lineWidth = track.roadWidth + 14;
  ctx.stroke();

  traceLoop();
  ctx.setLineDash([14, 14]);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = track.roadWidth + 14;
  ctx.stroke();
  ctx.setLineDash([]);

  // Main asphalt road surface
  traceLoop();
  ctx.strokeStyle = '#1E232C';
  ctx.lineWidth = track.roadWidth;
  ctx.stroke();

  // Centerline dashed guide
  traceLoop();
  ctx.setLineDash([10, 14]);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // Clipping zones
  for (const zone of track.clippingZones) {
    const active = car.clipZoneActive === zone.label;
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
    ctx.fillStyle = active
      ? 'rgba(245, 158, 11, 0.22)'
      : 'rgba(245, 158, 11, 0.07)';
    ctx.fill();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = active ? '#F59E0B' : 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = active ? 2.2 : 1.3;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = active ? '#FCD34D' : 'rgba(245, 158, 11, 0.78)';
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(zone.label, zone.x, zone.y - zone.radius - 6);
  }

  // Persistent tire skidmarks
  ctx.lineCap = 'round';
  for (const seg of car.skidmarks) {
    ctx.strokeStyle = `rgba(8, 10, 14, ${seg.alpha.toFixed(2)})`;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
  }

  // Tire smoke particles
  for (const p of car.smoke) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(218, 224, 234, ${p.alpha.toFixed(3)})`;
    ctx.fill();
  }

  // Velocity & heading physics vector overlay
  if (showVectors) {
    const speed = Math.hypot(car.vx, car.vy);
    if (speed > 18) {
      // Velocity vector (cyan)
      const scale = 0.34;
      ctx.beginPath();
      ctx.moveTo(car.x, car.y);
      ctx.lineTo(car.x + car.vx * scale, car.y + car.vy * scale);
      ctx.strokeStyle = '#0EA5E9';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // Car heading vector (orange)
      const hLen = Math.min(85, speed * scale);
      ctx.beginPath();
      ctx.moveTo(car.x, car.y);
      ctx.lineTo(
        car.x + Math.cos(car.heading) * hLen,
        car.y + Math.sin(car.heading) * hLen
      );
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Draw top-down car chassis with steerable front wheels
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading);

  const len = chassis.bodyLengthPx;
  const wid = chassis.bodyWidthPx;
  const halfL = len / 2;
  const halfW = wid / 2;

  // Drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.roundRect(-halfL - 2, -halfW + 3, len + 2, wid, 4);
  ctx.fill();

  // Rear wheels
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(-halfL + 4, -halfW - 2.5, 10, 4);
  ctx.fillRect(-halfL + 4, halfW - 1.5, 10, 4);

  // Front steerable wheels
  const fx = halfL - 9;
  for (const fy of [-halfW - 0.5, halfW + 0.5]) {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(car.steerAngle);
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-5, -2, 10, 4);
    ctx.restore();
  }

  // Car body shell
  ctx.fillStyle = chassis.accentColor;
  ctx.beginPath();
  ctx.roundRect(-halfL, -halfW, len, wid, 4);
  ctx.fill();

  // Windshield & cabin roof
  ctx.fillStyle = '#0B0D11';
  ctx.beginPath();
  ctx.roundRect(-halfL + 8, -halfW + 2.5, len * 0.52, wid - 5, 2.5);
  ctx.fill();

  // Headlight beams
  ctx.fillStyle = 'rgba(254, 240, 138, 0.9)';
  ctx.fillRect(halfL - 2, -halfW + 2.5, 2.5, 4);
  ctx.fillRect(halfL - 2, halfW - 6.5, 2.5, 4);

  // Taillights
  ctx.fillStyle = '#EF4444';
  ctx.fillRect(-halfL - 0.5, -halfW + 2.5, 2, 4.5);
  ctx.fillRect(-halfL - 0.5, halfW - 7, 2, 4.5);

  ctx.restore();
}
