import { DriftTuneParams } from '../types/drift';

export interface TuneAdjustmentTip {
  key: keyof DriftTuneParams;
  category: string;
  label: string;
  fromFormatted: string;
  toFormatted: string;
  direction: 'up' | 'down';
  headline: string;
  detail: string;
}

interface ParamAdvisorSpec {
  category: string;
  label: string;
  min: number;
  max: number;
  unit: string;
  format?: (v: number) => string;
  upHeadline: string;
  upDetail: string;
  downHeadline: string;
  downDetail: string;
  /** Minimum fraction of slider range required to trigger (default 0.08) */
  minRangePct?: number;
}

const PARAM_ADVISOR_SPECS: Record<keyof DriftTuneParams, ParamAdvisorSpec> = {
  steeringLockDeg: {
    category: 'Steering Geometry',
    label: 'Max Steering Lock',
    min: 40,
    max: 72,
    unit: '°',
    upHeadline: 'Deeper drift angle without spinning out',
    upDetail:
      'More steering lock raises the slip-angle ceiling, letting you hold aggressive lead and chase lines without running out of countersteer.',
    downHeadline: 'Lower maximum sustainable slip angle',
    downDetail:
      'Reducing steering lock narrows your catch margin, making the car easier to spin if pushed past 45° of angle.',
  },
  ackermannPct: {
    category: 'Steering Geometry',
    label: 'Ackermann Geometry',
    min: -15,
    max: 100,
    unit: '%',
    upHeadline: 'Increased front scrub & mid-drift bind',
    upDetail:
      'Positive Ackermann forces the inside front tire to turn sharper than the outside tire, scrubbing speed and resistance at high drift angles.',
    downHeadline: 'Reduced front scrub & smoother lock holds',
    downDetail:
      'Moving toward 0% parallel or anti-Ackermann keeps both front tires tracking cleanly at full lock for steadier front grip.',
  },
  kpiDeg: {
    category: 'Steering Geometry',
    label: 'Kingpin Inclination (KPI)',
    min: 4.0,
    max: 14.0,
    unit: '°',
    format: (v) => v.toFixed(1),
    upHeadline: 'More steering jacking & less front bite',
    upDetail:
      'Higher KPI lifts the chassis corner and pushes camber positive at full lock, reducing front lateral grip mid-drift.',
    downHeadline: 'Flatter leading tire at full lock',
    downDetail:
      'Lower drop-knuckle KPI minimizes wheel jacking so the front axle maintains predictable bite all the way to the bump stops.',
  },
  frontCasterDeg: {
    category: 'Alignment',
    label: 'Front Caster Angle',
    min: 3.0,
    max: 10.5,
    unit: '°',
    format: (v) => `+${v.toFixed(1)}`,
    upHeadline: 'Stronger self-aligning countersteer',
    upDetail:
      'Higher caster speeds up steering wheel self-centering on transitions and adds helpful negative camber on the leading wheel.',
    downHeadline: 'Lighter, slower self-centering feel',
    downDetail:
      'Lower caster reduces self-aligning torque, requiring more active steering input to catch fast transitions.',
  },
  frontCamberDeg: {
    category: 'Alignment',
    label: 'Front Camber',
    min: -7.0,
    max: 0.0,
    unit: '°',
    format: (v) => v.toFixed(1),
    upHeadline: 'Reduced high-angle front contact patch',
    upDetail:
      'Dialing front camber back toward 0° rolls the leading tire onto its outer shoulder at 60°+ lock, weakening front bite.',
    downHeadline: 'Stronger front grip at big steering lock',
    downDetail:
      'More negative front camber flattens the leading tire contact patch during deep drifts for sharper turn-in and control.',
  },
  rearCamberDeg: {
    category: 'Alignment',
    label: 'Rear Camber',
    min: -6.0,
    max: 0.5,
    unit: '°',
    format: (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
    upHeadline: 'More rear traction & forward chase drive',
    upDetail:
      'Flattening rear camber toward 0° lets the full tire tread sit flat under squat, boosting forward acceleration while sideways.',
    downHeadline: 'Looser rear breakaway with less forward bite',
    downDetail:
      'Adding negative rear camber shrinks the active contact patch under load, making the rear break traction earlier at lower speeds.',
  },
  frontToeDeg: {
    category: 'Alignment',
    label: 'Front Static Toe',
    min: -0.6,
    max: 0.3,
    unit: '°',
    format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
    upHeadline: 'Calmer straight-line steering, softer turn-in',
    upDetail:
      'Moving toward front toe-in stabilizes high-speed entries but dulls initial flick responsiveness.',
    downHeadline: 'Sharper turn-in & eager drift initiation',
    downDetail:
      'Adding front toe-out preloads the outside tire on turn-in so the front nose bites immediately when initiating.',
  },
  rearToeDeg: {
    category: 'Alignment',
    label: 'Rear Static Toe',
    min: -0.2,
    max: 0.8,
    unit: '°',
    format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
    upHeadline: 'More rear stability & forward drive',
    upDetail:
      'Increasing rear toe-in plants the rear axle under throttle and resists sudden over-rotation during fast transitions.',
    downHeadline: 'Quicker rear rotation & looser transitions',
    downDetail:
      'Reducing rear toe-in frees up the rear end to swing wide faster, requiring finer throttle control to avoid spinning.',
  },
  steeringSpeed: {
    category: 'Steering Geometry',
    label: 'Rack Speed Multiplier',
    min: 0.6,
    max: 1.8,
    unit: 'x',
    format: (v) => v.toFixed(2),
    upHeadline: 'Faster lock-to-lock countersteer catch',
    upDetail:
      'Higher steering rack speed helps catch sudden snaps quickly, though small steering corrections become more sensitive.',
    downHeadline: 'Smoother but slower transition speed',
    downDetail:
      'Lowering rack speed damps twitchy inputs, but leaves less time to catch steep high-angle entries.',
  },
  steeringWheelDeg: {
    category: 'FFB Wheel',
    label: 'FFB Wheel Rotation',
    min: 540,
    max: 1080,
    unit: '°',
    upHeadline: 'Wider wheel rotation & finer mid-drift precision',
    upDetail:
      'Increasing wheel lock toward 900–1080° matches real-world drift steering ratios for smoother micro-corrections on DD wheels.',
    downHeadline: 'Faster steering ratio with less hand travel',
    downDetail:
      'Lowering lock toward 540–720° speeds up lock-to-lock flicks at the cost of narrower mid-corner precision.',
  },
  ffbStrengthPct: {
    category: 'FFB Wheel',
    label: 'FFB Self-Steer Gain',
    min: 60,
    max: 160,
    unit: '%',
    upHeadline: 'Stronger self-aligning kick on wheel release',
    upDetail:
      'Raising FFB gain amplifies pneumatic trail feedback so a 900° DD or belt wheel snaps crisply into countersteer.',
    downHeadline: 'Lighter rack torque & gentler transitions',
    downDetail:
      'Reducing FFB gain prevents clipping on high-torque DD bases and softens aggressive snap-oversteer kicks.',
  },
  ffbDampingPct: {
    category: 'FFB Wheel',
    label: 'Steering Rack Damping',
    min: 0,
    max: 60,
    unit: '%',
    upHeadline: 'Calmer straights with reduced DD chatter',
    upDetail:
      'Adding rack damping filters high-frequency oscillation and tank-slapper vibration on direct drive wheels.',
    downHeadline: 'Raw, unfiltered rack feel & faster self-steer spin',
    downDetail:
      'Lowering rack damping lets the steering wheel spin freely during rapid initiations with maximum road texture.',
  },
  frontSpringKn: {
    category: 'Coilovers',
    label: 'Front Coilover Spring',
    min: 35,
    max: 110,
    unit: ' kN/m',
    upHeadline: 'Crisper turn-in & less nose dive',
    upDetail:
      'Stiffer front coilovers reduce front roll and sharpen steering response when flicking into corners.',
    downHeadline: 'Softer front roll & gentler initiation',
    downDetail:
      'Softer front springs absorb rough tarmac better, but slow down initial weight transfer and nose bite.',
  },
  rearSpringKn: {
    category: 'Coilovers',
    label: 'Rear Coilover Spring',
    min: 25,
    max: 90,
    unit: ' kN/m',
    upHeadline: 'Less rear squat & easier wheelspin',
    upDetail:
      'Stiffening the rear springs limits weight transfer to the rear tires, reducing traction so lower power breaks loose sooner.',
    downHeadline: 'Deeper rear squat & higher forward grip',
    downDetail:
      'Softer rear coilovers allow more rearward squat on throttle, planting the tires for stronger chase acceleration.',
  },
  rearArbBiasPct: {
    category: 'Suspension',
    label: 'Rear ARB Stiffness Bias',
    min: 20,
    max: 80,
    unit: '%',
    upHeadline: 'Sharper oversteer snap, less rear bite',
    upDetail:
      'Increasing rear anti-roll bar stiffness loads the outside rear tire harder in roll, loosening rear grip and speeding up transitions.',
    downHeadline: 'Softened rear ARB boosts side-bite & squat',
    downDetail:
      'Lowering rear ARB bias lets each rear wheel track independently over bumps, maximizing Formula Drift-style forward traction.',
  },
  antiSquatPct: {
    category: 'Suspension',
    label: 'Rear Anti-Squat',
    min: 20,
    max: 90,
    unit: '%',
    upHeadline: 'Stronger forward drive on throttle',
    upDetail:
      'Higher anti-squat pushes the rear tires harder into the asphalt under power without collapsing rear ride height.',
    downHeadline: 'Softer initial bite under throttle',
    downDetail:
      'Lower anti-squat eases forward drive shock on throttle tip-in, smoothing transitions on slick surfaces.',
  },
  frontWeightPct: {
    category: 'Chassis Balance',
    label: 'Static Weight Bias (Front)',
    min: 47.0,
    max: 58.0,
    unit: '%',
    format: (v) => v.toFixed(1),
    upHeadline: 'Lighter rear axle & looser drift balance',
    upDetail:
      'Shifting static weight forward unloads the rear tires, making breakaway easier at the expense of forward chase speed.',
    downHeadline: 'Rear-shifted weight increases chase drive',
    downDetail:
      'Moving weight rearward (~49.5% front) plants more vertical load over the driven tires for faster drift acceleration.',
  },
  chassisRigidity: {
    category: 'Chassis Balance',
    label: 'Chromoly Cage Rigidity',
    min: 0.8,
    max: 1.5,
    unit: 'x',
    format: (v) => v.toFixed(2),
    upHeadline: 'Immediate suspension & yaw response',
    upDetail:
      'Higher torsional rigidity removes chassis flex delay so steering and damper adjustments take effect crisply.',
    downHeadline: 'More compliant, slightly delayed chassis flex',
    downDetail:
      'Lower chassis rigidity softens harsh transitions on bumpy surfaces at the cost of steering precision.',
  },
  rearTireWidthMm: {
    category: 'Wheels & Tires',
    label: 'Rear Tire Width',
    min: 225,
    max: 315,
    unit: ' mm',
    upHeadline: 'Larger rear footprint & higher chase speed',
    upDetail:
      'Wider rear tires deliver significantly more forward drive and mid-drift stability, requiring more power to sustain slip.',
    downHeadline: 'Easier breakaway for lower-power slides',
    downDetail:
      'Narrower rear tires break traction effortlessly with less horsepower, though peak cornering and chase speed drop.',
  },
  rearTirePsi: {
    category: 'Wheels & Tires',
    label: 'Rear Tire Pressure',
    min: 12,
    max: 42,
    unit: ' PSI',
    upHeadline: 'Higher rear PSI reduces rear grip',
    upDetail:
      'Increasing rear tire pressure crowns the tread and shrinks the contact patch, likely leading to less rear grip and easier wheelspin.',
    downHeadline: 'Lower rear PSI increases rear bite & forward drive',
    downDetail:
      'Airing down toward 16–20 PSI widens the contact patch against the asphalt, boosting traction and drift chase speed.',
  },
  rearTireGrip: {
    category: 'Wheels & Tires',
    label: 'Tire Compound Grip',
    min: 0.65,
    max: 1.15,
    unit: ' μ',
    format: (v) => v.toFixed(2),
    upHeadline: 'Higher speed drifts with stronger throttle demand',
    upDetail:
      'Stickier competition compounds carry faster drift speeds and sharper bite, requiring decisive initiation and boost.',
    downHeadline: 'Lower grip yields effortless, slower slides',
    downDetail:
      'Harder street compounds break loose smoothly at modest throttle with lower peak lateral G.',
  },
  brakeBiasPct: {
    category: 'Brakes',
    label: 'Brake Bias (Front)',
    min: 50,
    max: 75,
    unit: '%',
    upHeadline: 'Safer mid-drift left-foot braking',
    upDetail:
      'Biasing brakes further forward lets you scrub speed or tuck behind a lead car without locking the rear axle into a spin.',
    downHeadline: 'Higher risk of rear brake lockup mid-drift',
    downDetail:
      'Moving brake bias rearward causes the rear tires to lock earlier under foot braking, easily snapping the car around.',
  },
  lsdLockPct: {
    category: 'Drivetrain',
    label: 'Rear LSD / Spool Lock',
    min: 0,
    max: 100,
    unit: '%',
    upHeadline: 'Predictable dual-wheel lock & steady slides',
    upDetail:
      'Increasing LSD lock toward a 100% welded spool ensures both rear tires spin in unison for consistent initiation and angle holding.',
    downHeadline: 'More inside-wheel slip & mid-drift straightening',
    downDetail:
      'Opening up the differential softens turn-in understeer, but risks spinning only one tire and snapping straight mid-corner.',
  },
  finalDriveRatio: {
    category: 'Drivetrain',
    label: 'Quick-Change Final Drive',
    min: 3.1,
    max: 4.9,
    unit: ':1',
    format: (v) => v.toFixed(2),
    upHeadline: 'Shorter gearing adds rear wheel torque',
    upDetail:
      'A higher numerical final drive multiplies wheel torque to spin wide sticky tires easily in 2nd and 3rd gear.',
    downHeadline: 'Taller gearing extends gear speed range',
    downDetail:
      'A lower numerical ratio stretches each gear for high-speed sweepers, though wheelspin takes more torque to sustain.',
  },
  turboBoostPsi: {
    category: 'Drivetrain',
    label: 'Target Boost Pressure',
    min: 0,
    max: 28,
    unit: ' PSI',
    upHeadline: 'More torque to overpower high-grip tires',
    upDetail:
      'Raising boost builds stronger mid-range wheelspin power so sticky rear setups stay sideways on wide tracks.',
    downHeadline: 'Smoother, easier-to-modulate power delivery',
    downDetail:
      'Lowering boost tames sudden torque spikes, making throttle modulation cleaner on tight low-grip layouts.',
  },
};

export function evaluateSignificantTuneChange(
  key: keyof DriftTuneParams,
  baselineVal: number,
  newVal: number
): TuneAdjustmentTip | null {
  const spec = PARAM_ADVISOR_SPECS[key];
  if (!spec) return null;

  const span = Math.max(1e-4, spec.max - spec.min);
  const delta = newVal - baselineVal;
  const threshold = span * (spec.minRangePct ?? 0.08);
  const crossedSpoolBoundary =
    key === 'lsdLockPct' &&
    ((baselineVal < 98 && newVal >= 98) || (baselineVal >= 98 && newVal < 98));

  if (Math.abs(delta) < threshold && !crossedSpoolBoundary) {
    return null;
  }

  const direction: 'up' | 'down' = delta >= 0 ? 'up' : 'down';
  const fmt = spec.format ?? ((v: number) => String(v));

  return {
    key,
    category: spec.category,
    label: spec.label,
    fromFormatted: `${fmt(baselineVal)}${spec.unit}`,
    toFormatted: `${fmt(newVal)}${spec.unit}`,
    direction,
    headline: direction === 'up' ? spec.upHeadline : spec.downHeadline,
    detail: direction === 'up' ? spec.upDetail : spec.downDetail,
  };
}
