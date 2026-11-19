import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ChassisPreset, DriftTuneParams } from '../types/drift';
import {
  buildSuspensionMeshScene,
  MESH_MATERIALS,
  MeshPart,
  Vec3,
} from '../utils/suspensionMeshGenerator';

interface SuspensionMeshPreviewProps {
  chassis: ChassisPreset;
  tune: DriftTuneParams;
}

type FocusMode = 'front_axle' | 'front_corner' | 'rear_axle' | 'full';

interface ProjectedTri {
  pts: [number, number, number, number, number, number];
  depth: number;
  fill: string;
  stroke: string;
}

function shadeHex(hex: string, factor: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((num >> 16) & 255) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((num >> 8) & 255) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((num & 255) * factor)));
  return `rgb(${r},${g},${b})`;
}

export const SuspensionMeshPreview: React.FC<SuspensionMeshPreviewProps> = ({
  chassis,
  tune,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [focus, setFocus] = useState<FocusMode>('front_axle');
  const [yawDeg, setYawDeg] = useState(38);
  const [pitchDeg, setPitchDeg] = useState(22);
  const [zoom, setZoom] = useState(1.0);
  const dragRef = useRef<{ active: boolean; x: number; y: number; yaw: number; pitch: number }>({
    active: false,
    x: 0,
    y: 0,
    yaw: 38,
    pitch: 22,
  });

  const parts = useMemo(() => buildSuspensionMeshScene(chassis, tune), [chassis, tune]);

  const visibleParts = useMemo<MeshPart[]>(() => {
    if (focus === 'front_axle') return parts.filter((p) => p.axle === 'front');
    if (focus === 'rear_axle') return parts.filter((p) => p.axle === 'rear');
    if (focus === 'front_corner') {
      return parts.filter(
        (p) =>
          p.axle === 'front' &&
          (p.id === 'driftmod_subframe_F' ||
            p.id === 'driftmod_steering_F' ||
            p.id.endsWith('_FL'))
      );
    }
    return parts;
  }, [parts, focus]);

  const triCount = useMemo(
    () => visibleParts.reduce((acc, p) => acc + Math.floor(p.indices.length / 3), 0),
    [visibleParts]
  );

  const handleSetFocus = (next: FocusMode) => {
    setFocus(next);
    if (next === 'front_corner') {
      setYawDeg(52);
      setPitchDeg(18);
      setZoom(1.25);
    } else if (next === 'front_axle') {
      setYawDeg(38);
      setPitchDeg(22);
      setZoom(1.0);
    } else if (next === 'rear_axle') {
      setYawDeg(142);
      setPitchDeg(20);
      setZoom(1.0);
    } else {
      setYawDeg(45);
      setPitchDeg(26);
      setZoom(0.75);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Subtle CAD studio backdrop
    ctx.fillStyle = '#0B0D11';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#141822';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Target center based on focus mode
    const yFront = -chassis.wheelbaseM * 0.5;
    const yRear = chassis.wheelbaseM * 0.5;
    let target: Vec3 = [0, yFront, 0.36];
    let baseScale = 235;
    if (focus === 'front_corner') {
      target = [0.38, yFront, 0.36];
      baseScale = 290;
    } else if (focus === 'rear_axle') {
      target = [0, yRear, 0.36];
      baseScale = 235;
    } else if (focus === 'full') {
      target = [0, 0, 0.36];
      baseScale = 140;
    }

    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    const lightDir: Vec3 = [0.45, -0.55, 0.7];
    const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]);
    const lx = lightDir[0] / lLen;
    const ly = lightDir[1] / lLen;
    const lz = lightDir[2] / lLen;

    const fovDist = 3.6;
    const scalePx = baseScale * zoom;
    const cx = width * 0.5;
    const cy = height * 0.54;

    const projectPoint = (vx: number, vy: number, vz: number): [number, number, number] => {
      const dx = vx - target[0];
      const dy = vy - target[1];
      const dz = vz - target[2];

      // Rotate around Z (yaw) then X (pitch)
      const rx = dx * cosY - dy * sinY;
      const ry0 = dx * sinY + dy * cosY;
      const ry = ry0 * cosP - dz * sinP;
      const rz = ry0 * sinP + dz * cosP;

      const persp = fovDist / Math.max(0.6, fovDist - ry);
      return [cx + rx * scalePx * persp, cy - rz * scalePx * persp, ry];
    };

    const tris: ProjectedTri[] = [];

    for (const part of visibleParts) {
      const matColor = MESH_MATERIALS[part.material].colorHex;
      const verts = part.vertices;
      const norms = part.normals;
      const idx = part.indices;

      for (let i = 0; i < idx.length; i += 3) {
        const i0 = idx[i] * 3;
        const i1 = idx[i + 1] * 3;
        const i2 = idx[i + 2] * 3;

        const [x0, y0, d0] = projectPoint(verts[i0], verts[i0 + 1], verts[i0 + 2]);
        const [x1, y1, d1] = projectPoint(verts[i1], verts[i1 + 1], verts[i1 + 2]);
        const [x2, y2, d2] = projectPoint(verts[i2], verts[i2 + 1], verts[i2 + 2]);

        // Backface cull in screen space (optional—keep thin tubes double-safe if needed, cull reversed winding)
        const area2 = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
        if (area2 > 0) continue;

        const nx = norms[i0];
        const ny = norms[i0 + 1];
        const nz = norms[i0 + 2];
        const rawDot = nx * lx + ny * ly + nz * lz;
        const ndl = Math.max(0, rawDot);
        const rim = Math.max(0, -rawDot) * 0.25;
        const shade = 0.36 + 0.62 * ndl + rim;

        tris.push({
          pts: [x0, y0, x1, y1, x2, y2],
          depth: (d0 + d1 + d2) / 3,
          fill: shadeHex(matColor, shade),
          stroke: shadeHex(matColor, Math.min(1.15, shade + 0.08)),
        });
      }
    }

    // Painter's sort far-to-near (smaller ry is farther away)
    tris.sort((a, b) => a.depth - b.depth);

    ctx.lineWidth = 0.45;
    for (const t of tris) {
      const [x0, y0, x1, y1, x2, y2] = t.pts;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fillStyle = t.fill;
      ctx.fill();
      ctx.strokeStyle = t.stroke;
      ctx.stroke();
    }
  }, [visibleParts, chassis.wheelbaseM, focus, yawDeg, pitchDeg, zoom]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      x: e.clientX,
      y: e.clientY,
      yaw: yawDeg,
      pitch: pitchDeg,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setYawDeg(dragRef.current.yaw - dx * 0.55);
    setPitchDeg(Math.min(75, Math.max(-20, dragRef.current.pitch + dy * 0.45)));
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  return (
    <section
      aria-label="3D Collada suspension mesh preview"
      className="rounded-lg border border-[#232834] bg-[#13161D] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-[#F4F6F8]">
            3D Double Wishbone Mesh (.dae)
          </h2>
          <p className="mt-0.5 text-xs text-[#9AA4B2]">
            Drag to orbit · Exported directly in{' '}
            <span className="font-mono text-[#F4F6F8]">driftmod_suspension.dae</span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-[#9AA4B2]">
          <span>{visibleParts.length} meshes</span>
          <span>·</span>
          <span>{triCount.toLocaleString()} tris</span>
        </div>
      </div>

      {/* Camera Focus Controls */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['front_axle', 'Front Axle'],
              ['front_corner', 'FL Corner'],
              ['rear_axle', 'Rear Axle'],
              ['full', 'Full Set'],
            ] as [FocusMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleSetFocus(mode)}
              className={`rounded border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                focus === mode
                  ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                  : 'border-[#232834] bg-[#0B0D11] text-[#9AA4B2] hover:border-[#343B4C] hover:text-[#F4F6F8]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
            aria-label="Zoom out 3D mesh"
            className="rounded border border-[#232834] bg-[#0B0D11] px-2 py-1 font-mono text-xs text-[#9AA4B2] hover:text-white"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.85, Number((z + 0.15).toFixed(2))))}
            aria-label="Zoom in 3D mesh"
            className="rounded border border-[#232834] bg-[#0B0D11] px-2 py-1 font-mono text-xs text-[#9AA4B2] hover:text-white"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => handleSetFocus(focus)}
            aria-label="Reset camera angle"
            className="rounded border border-[#232834] bg-[#0B0D11] p-1.5 text-[#9AA4B2] hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Interactive 3D Canvas */}
      <div className="mt-3 overflow-hidden rounded border border-[#232834] bg-[#0B0D11]">
        <canvas
          ref={canvasRef}
          width={560}
          height={360}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="block w-full cursor-grab touch-none active:cursor-grabbing"
        />
      </div>

      {/* Mesh Color Legend */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[#232834] pt-3 text-[11px] text-[#9AA4B2] sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#64748b]" />
          <span>Tubular Subframe</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#f97316]" />
          <span>Upper &amp; Lower Wishbones</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#cbd5e1]" />
          <span>Knuckle &amp; Steering Rack</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#eab308]" />
          <span>2-Way Drift Coilovers</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#ef4444]" />
          <span>6-Pot Calipers &amp; Rotors</span>
        </div>
        <div className="font-mono text-[11px] text-[#F4F6F8] tabular-nums">
          KPI {tune.kpiDeg.toFixed(1)}° · Caster +{tune.frontCasterDeg.toFixed(1)}°
        </div>
      </div>
    </section>
  );
};
