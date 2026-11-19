import React, { useState } from 'react';
import { ChassisPreset, DriftTuneParams } from '../types/drift';

interface FrontGeometryWireframeProps {
  chassis: ChassisPreset;
  tune: DriftTuneParams;
}

export const FrontGeometryWireframe: React.FC<FrontGeometryWireframeProps> = ({
  chassis,
  tune,
}) => {
  // Interactive lock preview slider (0 = straight ahead, 1 = full lock)
  const [lockPreviewPct, setLockPreviewPct] = useState(75);

  const steerFrac = lockPreviewPct / 100;
  const kpiRad = (tune.kpiDeg * Math.PI) / 180;
  const casterRad = (tune.frontCasterDeg * Math.PI) / 180;

  // Steering & Ackermann angles (Top Plan View)
  const innerDeg = steerFrac * tune.steeringLockDeg + tune.frontToeDeg;
  const outerFactor = 1 - (tune.ackermannPct / 100) * 0.28;
  const outerDeg = Math.max(
    -2,
    steerFrac * tune.steeringLockDeg * outerFactor - tune.frontToeDeg
  );
  const ackermannDeltaDeg = Number((innerDeg - outerDeg).toFixed(1));

  // Front View KPI, Lower Control Arm & Scrub Radius calculation
  // Fixed chassis upper strut mount vs knuckle lower balljoint at 150mm ground height
  const lbjHeightMm = 155;
  const lbjInboardMm = -52;
  const kpiInterceptMm = lbjInboardMm + lbjHeightMm * Math.tan(kpiRad);
  const camberShiftMm = Math.sin((tune.frontCamberDeg * Math.PI) / 180) * 18;
  const scrubRadiusMm = Math.round(camberShiftMm - kpiInterceptMm);

  // Dynamic camber gain & vertical jacking at previewed steering angle
  const previewAngleRad = (Math.abs(innerDeg) * Math.PI) / 180;
  const dynamicCamberDeg =
    tune.frontCamberDeg +
    tune.kpiDeg * (1 - Math.cos(previewAngleRad)) -
    tune.frontCasterDeg * Math.sin(previewAngleRad) * 0.68;
  const jackingMm = Math.round(
    Math.max(0, Math.sin(kpiRad) * Math.sin(previewAngleRad) * 145)
  );

  // Side View Caster & Mechanical Trail
  const spindleHeightMm = 195;
  const mechanicalTrailMm = Math.round(spindleHeightMm * Math.tan(casterRad));

  // --- SVG Coordinates: Panel 1 (Front View: 0..220 x 0..170) ---
  const frontGroundY = 144;
  const tireCenterX = 148;
  const tireW = 26;
  const tireH = 74;
  const tireCy = frontGroundY - tireH * 0.5;
  // Control arm inner chassis pivot
  const lcaPivotX = 48;
  const lcaPivotY = 114;
  // Lower balljoint moves slightly with KPI / camber geometry
  const lbjX = tireCenterX - 24;
  const lbjY = 116;
  // Upper strut mount shifts inward/outward with KPI angle
  const strutHeightPx = 76;
  const upperMountX = lbjX - Math.tan(kpiRad) * strutHeightPx;
  const upperMountY = lbjY - strutHeightPx;
  // Ground intercept of KPI line in Front View (1 px ≈ 2.2 mm scale)
  const kpiGroundX = lbjX + Math.tan(kpiRad) * (frontGroundY - lbjY);
  const contactPatchX = tireCenterX + camberShiftMm * 0.45;

  // --- SVG Coordinates: Panel 2 (Side View Caster: 220..440 x 0..170) ---
  const sideGroundY = 144;
  const sideWheelCx = 330;
  const sideWheelR = 37;
  const sideWheelCy = sideGroundY - sideWheelR;
  const sideTopMountX = sideWheelCx + Math.tan(casterRad) * 66;
  const sideTopMountY = sideWheelCy - 66;
  const sideTrailGroundX = sideWheelCx - Math.tan(casterRad) * sideWheelR;

  // --- SVG Coordinates: Panel 3 (Top Plan View Steering & Ackermann: 0..440 x 176..356) ---
  const topOriginY = 176;
  const axleY = topOriginY + 62;
  const leftWheelX = 116;
  const rightWheelX = 324;
  const chassisHalfW = 46;
  const rackY = axleY + 5;

  // Left-turn preview: Left wheel is inner (-innerDeg), Right wheel is outer (-outerDeg)
  const innerRad = (-innerDeg * Math.PI) / 180;
  const outerRad = (-outerDeg * Math.PI) / 180;

  // Steering rack translates right (+x) for a rear-steer left turn
  const rackTravelPx = steerFrac * 17;
  const rackLeftEndX = 220 - chassisHalfW - 4 + rackTravelPx;
  const rackRightEndX = 220 + chassisHalfW + 4 + rackTravelPx;

  // Lower balljoints / kingpin pivots inboard of tire centers
  const leftBalljointX = leftWheelX + 12;
  const rightBalljointX = rightWheelX - 12;

  // Shortened knuckle steering arms (98mm rear-steer): prevents over-center toggle past 65 deg lock
  const ackermannArmOffset = (tune.ackermannPct / 100) * 4;
  const leftArmLocalX = 6 - ackermannArmOffset;
  const leftArmLocalY = 14;
  const leftTieArmX =
    leftBalljointX + leftArmLocalX * Math.cos(innerRad) - leftArmLocalY * Math.sin(innerRad);
  const leftTieArmY =
    axleY + leftArmLocalX * Math.sin(innerRad) + leftArmLocalY * Math.cos(innerRad);

  const rightArmLocalX = -6 + ackermannArmOffset;
  const rightArmLocalY = 14;
  const rightTieArmX =
    rightBalljointX + rightArmLocalX * Math.cos(outerRad) - rightArmLocalY * Math.sin(outerRad);
  const rightTieArmY =
    axleY + rightArmLocalX * Math.sin(outerRad) + rightArmLocalY * Math.cos(outerRad);

  // Perpendicular axle rays pointing inward-left toward the turn center
  const rayLen = 96;
  const innerAbsRad = (Math.max(4, Math.abs(innerDeg)) * Math.PI) / 180;
  const outerAbsRad = (Math.max(4, Math.abs(outerDeg)) * Math.PI) / 180;
  const leftRayEndX = leftWheelX - Math.cos(innerAbsRad) * rayLen;
  const leftRayEndY = axleY + Math.sin(innerAbsRad) * rayLen;
  const rightRayEndX = rightWheelX - Math.cos(outerAbsRad) * rayLen;
  const rightRayEndY = axleY + Math.sin(outerAbsRad) * rayLen;

  return (
    <section
      aria-label="Front suspension wireframe kinematics"
      className="rounded-lg border border-[#232834] bg-[#13161D] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-[#F4F6F8]">
            Front Suspension Wireframe Kinematics
          </h2>
          <p className="mt-0.5 text-xs text-[#9AA4B2]">
            {chassis.beamngInternalId} · Live KPI, Caster &amp; Ackermann geometry
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
          <span className="text-[#9AA4B2]">Steer Preview</span>
          <span className="font-semibold text-orange-400">
            {Math.round(steerFrac * tune.steeringLockDeg)}°
          </span>
        </div>
      </div>

      {/* Lock angle preview slider */}
      <div className="mt-3 flex items-center gap-3">
        <span className="shrink-0 font-mono text-[11px] text-[#7D8796] tabular-nums">
          0°
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={lockPreviewPct}
          onChange={(e) => setLockPreviewPct(parseInt(e.target.value, 10))}
          aria-label="Preview front wheel steering angle"
          className="drift-slider flex-1"
        />
        <span className="shrink-0 font-mono text-[11px] text-[#7D8796] tabular-nums">
          {tune.steeringLockDeg}° Lock
        </span>
      </div>

      {/* Unified Multi-Projection CAD Wireframe */}
      <div className="mt-3 overflow-hidden rounded border border-[#232834] bg-[#0B0D11]">
        <svg
          viewBox="0 0 440 356"
          className="w-full"
          role="img"
          aria-label="Front view KPI and scrub radius, side view caster trail, and top view Ackermann steering geometry wireframe"
        >
          {/* Subtle CAD grid */}
          <defs>
            <pattern
              id="cadGrid"
              width="22"
              height="22"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 22 0 L 0 0 0 22"
                fill="none"
                stroke="#151923"
                strokeWidth="0.8"
              />
            </pattern>
          </defs>
          <rect x="0" y="0" width="440" height="356" fill="url(#cadGrid)" />

          {/* Section dividers */}
          <line x1="220" y1="0" x2="220" y2="176" stroke="#232834" strokeWidth="1" />
          <line x1="0" y1="176" x2="440" y2="176" stroke="#232834" strokeWidth="1" />

          {/* PANEL 1: FRONT VIEW (KPI & Scrub Radius) */}
          <text x="10" y="16" className="fill-[#7D8796] font-mono text-[9px]">
            Front View · KPI {tune.kpiDeg.toFixed(1)}°
          </text>
          {/* Tarmac line */}
          <line x1="12" y1={frontGroundY} x2="208" y2={frontGroundY} stroke="#334155" strokeWidth="1.2" />
          {/* Chassis crossmember / strut tower stub */}
          <line x1="28" y1={upperMountY} x2={upperMountX} y2={upperMountY} stroke="#475569" strokeWidth="1.5" strokeDasharray="3 2" />
          <line x1="28" y1={lcaPivotY} x2={lcaPivotX} y2={lcaPivotY} stroke="#475569" strokeWidth="1.5" />
          {/* Lower Control Arm */}
          <line x1={lcaPivotX} y1={lcaPivotY} x2={lbjX} y2={lbjY} stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" />
          {/* Strut / Coilover Body */}
          <line x1={upperMountX} y1={upperMountY} x2={lbjX} y2={lbjY} stroke="#CBD5E1" strokeWidth="2.2" />
          {/* Coil spring zig-zag highlight */}
          <line
            x1={(upperMountX + lbjX) * 0.5 - 3}
            y1={(upperMountY + lbjY) * 0.5 - 8}
            x2={(upperMountX + lbjX) * 0.5 + 3}
            y2={(upperMountY + lbjY) * 0.5 + 8}
            stroke="#F97316"
            strokeWidth="2"
          />
          {/* Knuckle upright & spindle stub */}
          <line x1={lbjX} y1={lbjY} x2={tireCenterX} y2={tireCy + 6} stroke="#E2E8F0" strokeWidth="2.2" />
          <line x1={upperMountX * 0.35 + lbjX * 0.65} y1={upperMountY * 0.35 + lbjY * 0.65} x2={tireCenterX} y2={tireCy - 6} stroke="#64748B" strokeWidth="1.5" />

          {/* Front Wheel Wireframe (rotated by dynamic camber) */}
          <g transform={`translate(${tireCenterX}, ${tireCy}) rotate(${-dynamicCamberDeg})`}>
            <rect
              x={-tireW / 2}
              y={-tireH / 2}
              width={tireW}
              height={tireH}
              rx="4"
              fill="#0EA5E9"
              fillOpacity="0.1"
              stroke="#0EA5E9"
              strokeWidth="1.8"
            />
            <line x1="0" y1={-tireH / 2} x2="0" y2={tireH / 2} stroke="#0EA5E9" strokeWidth="1" strokeDasharray="3 3" />
          </g>

          {/* Kingpin Axis dashed ray to tarmac */}
          <line
            x1={upperMountX}
            y1={upperMountY - 8}
            x2={kpiGroundX}
            y2={frontGroundY}
            stroke="#F97316"
            strokeWidth="1.6"
            strokeDasharray="4 3"
          />
          {/* Scrub Radius span bar at tarmac */}
          <line
            x1={kpiGroundX}
            y1={frontGroundY - 3}
            x2={contactPatchX}
            y2={frontGroundY - 3}
            stroke="#10B981"
            strokeWidth="3"
          />
          <circle cx={kpiGroundX} cy={frontGroundY} r="2.8" fill="#F97316" />
          <circle cx={contactPatchX} cy={frontGroundY} r="2.8" fill="#0EA5E9" />
          <circle cx={lcaPivotX} cy={lcaPivotY} r="2.5" fill="#F4F6F8" />
          <circle cx={lbjX} cy={lbjY} r="2.5" fill="#F97316" />
          <circle cx={upperMountX} cy={upperMountY} r="2.5" fill="#F97316" />

          <text
            x={(kpiGroundX + contactPatchX) * 0.5}
            y={frontGroundY + 14}
            textAnchor="middle"
            className="fill-emerald-400 font-mono text-[9px]"
          >
            Scrub {scrubRadiusMm > 0 ? `+${scrubRadiusMm}` : scrubRadiusMm} mm
          </text>

          {/* PANEL 2: SIDE VIEW (Caster & Mechanical Trail) */}
          <text x="230" y="16" className="fill-[#7D8796] font-mono text-[9px]">
            Side View · Caster +{tune.frontCasterDeg.toFixed(1)}°
          </text>
          <line x1="234" y1={sideGroundY} x2="428" y2={sideGroundY} stroke="#334155" strokeWidth="1.2" />
          {/* Side tire profile */}
          <circle
            cx={sideWheelCx}
            cy={sideWheelCy}
            r={sideWheelR}
            fill="#0EA5E9"
            fillOpacity="0.08"
            stroke="#0EA5E9"
            strokeWidth="1.8"
          />
          <circle
            cx={sideWheelCx}
            cy={sideWheelCy}
            r={sideWheelR * 0.58}
            fill="none"
            stroke="#334155"
            strokeWidth="1"
          />
          {/* Vertical reference line */}
          <line
            x1={sideWheelCx}
            y1={sideTopMountY - 4}
            x2={sideWheelCx}
            y2={sideGroundY}
            stroke="#334155"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
          {/* Caster strut axis */}
          <line
            x1={sideTopMountX}
            y1={sideTopMountY}
            x2={sideTrailGroundX}
            y2={sideGroundY}
            stroke="#F97316"
            strokeWidth="1.8"
            strokeDasharray="4 3"
          />
          {/* Trail bar */}
          <line
            x1={sideTrailGroundX}
            y1={sideGroundY - 3}
            x2={sideWheelCx}
            y2={sideGroundY - 3}
            stroke="#10B981"
            strokeWidth="3"
          />
          <circle cx={sideTopMountX} cy={sideTopMountY} r="2.6" fill="#F97316" />
          <circle cx={sideWheelCx} cy={sideWheelCy} r="2.6" fill="#0EA5E9" />
          <circle cx={sideTrailGroundX} cy={sideGroundY} r="2.6" fill="#F97316" />
          <circle cx={sideWheelCx} cy={sideGroundY} r="2.6" fill="#0EA5E9" />

          <text
            x={(sideTrailGroundX + sideWheelCx) * 0.5}
            y={sideGroundY + 14}
            textAnchor="middle"
            className="fill-emerald-400 font-mono text-[9px]"
          >
            Trail +{mechanicalTrailMm} mm
          </text>

          {/* PANEL 3: TOP PLAN VIEW (Control Arms, Tie Rods & Ackermann Angles) */}
          <text x="10" y={topOriginY + 16} className="fill-[#7D8796] font-mono text-[9px]">
            Top Plan View (Left Turn) · Ackermann ({tune.ackermannPct}%)
          </text>

          {/* Subframe rails */}
          <rect
            x={220 - chassisHalfW}
            y={axleY - 22}
            width={chassisHalfW * 2}
            height="72"
            rx="3"
            fill="none"
            stroke="#2C3240"
            strokeWidth="1.5"
          />
          {/* Steering Rack Housing */}
          <line
            x1={220 - chassisHalfW - 4}
            y1={rackY}
            x2={220 + chassisHalfW + 4}
            y2={rackY}
            stroke="#334155"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {/* Translating Steering Rack Bar */}
          <line
            x1={rackLeftEndX}
            y1={rackY}
            x2={rackRightEndX}
            y2={rackY}
            stroke="#94A3B8"
            strokeWidth="2.4"
            strokeLinecap="round"
          />

          {/* Left High-Clearance Swept Lower A-Arm */}
          <path
            d={`M ${220 - chassisHalfW} ${axleY - 12} Q ${(220 - chassisHalfW + leftBalljointX) * 0.5} ${axleY - 2} ${leftBalljointX} ${axleY} L ${220 - chassisHalfW} ${axleY + 20} Z`}
            fill="#94A3B8"
            fillOpacity="0.08"
            stroke="#94A3B8"
            strokeWidth="1.6"
          />
          {/* Right High-Clearance Swept Lower A-Arm */}
          <path
            d={`M ${220 + chassisHalfW} ${axleY - 12} Q ${(220 + chassisHalfW + rightBalljointX) * 0.5} ${axleY - 2} ${rightBalljointX} ${axleY} L ${220 + chassisHalfW} ${axleY + 20} Z`}
            fill="#94A3B8"
            fillOpacity="0.08"
            stroke="#94A3B8"
            strokeWidth="1.6"
          />

          {/* Knuckle Steering Arms & Tie Rods */}
          <line
            x1={leftBalljointX}
            y1={axleY}
            x2={leftTieArmX}
            y2={leftTieArmY}
            stroke="#CBD5E1"
            strokeWidth="2"
          />
          <line
            x1={rightBalljointX}
            y1={axleY}
            x2={rightTieArmX}
            y2={rightTieArmY}
            stroke="#CBD5E1"
            strokeWidth="2"
          />
          <line
            x1={rackLeftEndX}
            y1={rackY}
            x2={leftTieArmX}
            y2={leftTieArmY}
            stroke="#F97316"
            strokeWidth="1.8"
          />
          <line
            x1={rackRightEndX}
            y1={rackY}
            x2={rightTieArmX}
            y2={rightTieArmY}
            stroke="#0EA5E9"
            strokeWidth="1.8"
          />
          <circle cx={leftTieArmX} cy={leftTieArmY} r="2.2" fill="#F97316" />
          <circle cx={rightTieArmX} cy={rightTieArmY} r="2.2" fill="#0EA5E9" />

          {/* Ackermann Perpendicular Rays toward Turn Center */}
          <line
            x1={leftWheelX}
            y1={axleY}
            x2={leftRayEndX}
            y2={leftRayEndY}
            stroke="#F97316"
            strokeOpacity="0.45"
            strokeWidth="1.1"
            strokeDasharray="3 3"
          />
          <line
            x1={rightWheelX}
            y1={axleY}
            x2={rightRayEndX}
            y2={rightRayEndY}
            stroke="#0EA5E9"
            strokeOpacity="0.45"
            strokeWidth="1.1"
            strokeDasharray="3 3"
          />

          {/* Left Front Tire (Inner turn wheel) */}
          <g transform={`translate(${leftWheelX}, ${axleY}) rotate(${-innerDeg})`}>
            <rect
              x="-9"
              y="-23"
              width="18"
              height="46"
              rx="3"
              fill="#F97316"
              fillOpacity="0.14"
              stroke="#F97316"
              strokeWidth="2"
            />
            <line x1="0" y1="-23" x2="0" y2="23" stroke="#F97316" strokeWidth="1" strokeDasharray="2 2" />
          </g>

          {/* Right Front Tire (Outer / Leading turn wheel) */}
          <g transform={`translate(${rightWheelX}, ${axleY}) rotate(${-outerDeg})`}>
            <rect
              x="-9"
              y="-23"
              width="18"
              height="46"
              rx="3"
              fill="#0EA5E9"
              fillOpacity="0.14"
              stroke="#0EA5E9"
              strokeWidth="2"
            />
            <line x1="0" y1="-23" x2="0" y2="23" stroke="#0EA5E9" strokeWidth="1" strokeDasharray="2 2" />
          </g>

          <text x={leftWheelX} y={axleY + 56} textAnchor="middle" className="fill-orange-400 font-mono text-[9px]">
            Inner {innerDeg.toFixed(1)}°
          </text>
          <text x={rightWheelX} y={axleY + 56} textAnchor="middle" className="fill-sky-400 font-mono text-[9px]">
            Outer {outerDeg.toFixed(1)}°
          </text>
          <text x="220" y={topOriginY + 168} textAnchor="middle" className="fill-[#9AA4B2] font-mono text-[9px]">
            Ackermann Split {ackermannDeltaDeg > 0 ? `+${ackermannDeltaDeg}°` : `${ackermannDeltaDeg}°`}
          </text>
        </svg>
      </div>

      {/* Live Numeric Readout Strip (unboxed tabular figures) */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#232834] pt-3 font-mono text-xs tabular-nums sm:grid-cols-4">
        <div>
          <div className="text-[11px] text-[#7D8796]">Scrub Radius</div>
          <div className="font-semibold text-emerald-400">
            {scrubRadiusMm > 0 ? `+${scrubRadiusMm}` : scrubRadiusMm} mm
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[#7D8796]">Caster Trail</div>
          <div className="font-semibold text-emerald-400">+{mechanicalTrailMm} mm</div>
        </div>
        <div>
          <div className="text-[11px] text-[#7D8796]">Camber @ Angle</div>
          <div className="font-semibold text-[#F4F6F8]">
            {dynamicCamberDeg.toFixed(1)}°
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[#7D8796]">KPI Jacking</div>
          <div className="font-semibold text-orange-400">+{jackingMm} mm</div>
        </div>
      </div>
    </section>
  );
};
