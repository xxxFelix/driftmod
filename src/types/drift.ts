export type ViewTab = 'sandbox' | 'setup' | 'telemetry' | 'export';

export type ChassisId =
  | 'bx_coupe'
  | 'etk_k'
  | 'sunburst_rwd'
  | 'bastion_pro'
  | 'grand_marshal';

export type TrackId = 'west_coast_pad' | 'industrial_yard' | 'hirochi_touge';

export interface DriftTuneParams {
  /** Max front wheel steering lock angle in degrees (40 - 72) */
  steeringLockDeg: number;
  /** Ackermann geometry percentage (-15 to 100; 0 = parallel, negative = anti-Ackermann) */
  ackermannPct: number;
  /** Front Kingpin Inclination / SAI angle in degrees (4.0 - 14.0; low KPI prevents high-lock jacking) */
  kpiDeg: number;
  /** Steering rack speed multiplier (0.6 - 1.8) */
  steeringSpeed: number;
  /** Physical FFB steering wheel rotation lock-to-lock in degrees (540 - 1080; 900 for DD/belt wheels) */
  steeringWheelDeg: number;
  /** FFB self-aligning torque (SAT) gain percentage (60 - 160%) */
  ffbStrengthPct: number;
  /** Steering rack FFB smoothing & DD oscillation damping percentage (0 - 60%) */
  ffbDampingPct: number;
  /** Front suspension caster angle in degrees (3.0 - 10.5) */
  frontCasterDeg: number;
  /** Front wheel negative camber in degrees (-7.0 to 0.0) */
  frontCamberDeg: number;
  /** Rear wheel negative camber in degrees (-6.0 to +0.5) */
  rearCamberDeg: number;
  /** Front static toe angle in degrees (-0.60 toe-out to +0.30 toe-in) */
  frontToeDeg: number;
  /** Rear static toe angle in degrees (-0.20 toe-out to +0.80 toe-in) */
  rearToeDeg: number;
  /** Front coilover spring rate in kN/m (35 - 110) */
  frontSpringKn: number;
  /** Rear coilover spring rate in kN/m (25 - 90) */
  rearSpringKn: number;
  /** Rear anti-roll bar stiffness bias percentage (20 - 80; lower = softer/disconnected rear bar) */
  rearArbBiasPct: number;
  /** Rear anti-squat geometry percentage (20 - 90) */
  antiSquatPct: number;
  /** Static front weight distribution percentage (47 - 58; FD Pro shifts weight rearward ~49.5%) */
  frontWeightPct: number;
  /** Chassis / chromoly roll-cage torsional stiffness multiplier (0.8 - 1.5) */
  chassisRigidity: number;
  /** Rear tire section width in mm (225 - 315) */
  rearTireWidthMm: number;
  /** Rear tire pressure in PSI (12 - 42; 16-20 PSI = max FD grip, 32+ PSI = loose street slide) */
  rearTirePsi: number;
  /** Brake balance % front (50 - 75; high front bias enables left-foot braking mid-drift) */
  brakeBiasPct: number;
  /** Rear limited-slip differential lock rate (0 = open, 100 = welded spool) */
  lsdLockPct: number;
  /** Final drive gear ratio (3.10 - 4.90) */
  finalDriveRatio: number;
  /** Turbo wastegate target boost in PSI (0 - 28) */
  turboBoostPsi: number;
  /** Rear tire compound grip factor (0.65 = street/all-season, 1.15 = 200TW FD semi-slick) */
  rearTireGrip: number;
}

export interface ChassisPreset {
  id: ChassisId;
  name: string;
  beamngInternalId: string;
  drivetrain: string;
  massKg: number;
  wheelbaseM: number;
  basePowerHp: number;
  redlineRpm: number;
  bodyLengthPx: number;
  bodyWidthPx: number;
  accentColor: string;
  summary: string;
  defaultTune: DriftTuneParams;
}

export interface TrackWaypoint {
  x: number;
  y: number;
}

export interface ClippingZone {
  x: number;
  y: number;
  radius: number;
  label: string;
}

export interface TrackDefinition {
  id: TrackId;
  name: string;
  location: string;
  surfaceLabel: string;
  surfaceGripMult: number;
  roadWidth: number;
  worldWidth: number;
  worldHeight: number;
  waypoints: TrackWaypoint[];
  clippingZones: ClippingZone[];
  startAngleRad: number;
}

export interface LiveHudState {
  speedKmh: number;
  rpm: number;
  gear: number;
  slipAngleDeg: number;
  lateralG: number;
  boostPsi: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  isDrifting: boolean;
  currentDriftPoints: number;
  comboMultiplier: number;
  totalScore: number;
  bestDriftRun: number;
  clipZoneActive: string | null;
  faultStatus?: 'SPINOUT' | 'BOGGED' | 'OFF_TRACK' | null;
}

export interface TelemetrySample {
  timeSec: number;
  speedKmh: number;
  slipAngleDeg: number;
  throttlePct: number;
  lateralG: number;
}

export interface ModFileSpec {
  filename: string;
  relativePath: string;
  language: 'json' | 'lua' | 'xml';
  summary: string;
  content: string;
}
