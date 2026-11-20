import { ChassisPreset, DriftTuneParams, ModFileSpec } from '../types/drift';

export interface PhysicsCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface NodeStabilityStats {
  nodeId: string;
  partName: string;
  weightKg: number;
  sumSpringNm: number;
  sumDampNsM: number;
  stiffnessRatio: number; // Sum(k) / m (s^-2)
  dampingRatio: number; // Sum(c) / m (s^-1)
}

export interface BeamngPreFlightReport {
  overallStatus: 'pass' | 'warn' | 'fail';
  maxStiffnessRatio: number;
  maxStiffnessNode: string;
  maxDampingRatio: number;
  maxDampingNode: string;
  checks: PhysicsCheckItem[];
}

export interface ReferenceJbeamSummary {
  partNames: string[];
  slotTypes: string[];
  subSlots: Array<{ slotType: string; defaultPart: string; description: string }>;
  nodeCount: number;
  frontAxleYAvg: number | null;
  rearAxleYAvg: number | null;
  nodeWeightRange: [number, number] | null;
  beamSpringRange: [number, number] | null;
  beamDampRange: [number, number] | null;
  missingUnibodyTieIns: string[];
  matchedTieInNodes: Array<{
    nodeId: string;
    refPos: [number, number, number];
    nearestDriftModNode: string;
    distanceM: number;
  }>;
}

type JBeamRowObj = Record<string, unknown>;

const DEFAULT_SOLVER_STIFFNESS_WARN = 2_200_000;
const DEFAULT_SOLVER_STIFFNESS_FAIL = 3_000_000; // Well below BeamNG 2000Hz 4M-16M blowup wall
const DEFAULT_SOLVER_DAMPING_WARN = 1_500;
const DEFAULT_SOLVER_DAMPING_FAIL = 2_400; // Hard 2000Hz blowup is 2/dt = 4000 s^-1
const ASSUMED_UNIBODY_NODE_WEIGHT_KG = 2.8;

/**
 * Strips C-style comments, trailing commas, and omitted commas between adjacent
 * tokens from standard BeamNG .jbeam files so stock game files parse cleanly.
 */
export function parseRelaxedJbeam(rawText: string): Record<string, Record<string, unknown>> {
  let noComments = '';
  let inStr = false;
  let escaped = false;
  let i = 0;
  while (i < rawText.length) {
    const ch = rawText[i];
    const next = rawText[i + 1];
    if (inStr) {
      noComments += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inStr = false;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      noComments += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < rawText.length && rawText[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < rawText.length && !(rawText[i] === '*' && rawText[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    noComments += ch;
    i++;
  }

  // Remove trailing commas before ] or }
  const noTrailing = noComments.replace(/,\s*([\]}])/g, '$1');

  // Tokenize and insert omitted commas between adjacent value-ending and value-starting tokens
  type TokKind = '{' | '}' | '[' | ']' | ':' | ',' | 'STR' | 'LIT';
  const tokens: Array<{ kind: TokKind; raw: string }> = [];
  let idx = 0;
  const len = noTrailing.length;
  while (idx < len) {
    const c = noTrailing[idx];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      idx++;
      continue;
    }
    if (c === '{' || c === '}' || c === '[' || c === ']' || c === ':' || c === ',') {
      tokens.push({ kind: c, raw: c });
      idx++;
      continue;
    }
    if (c === '"') {
      const start = idx;
      idx++;
      let esc = false;
      while (idx < len) {
        const sc = noTrailing[idx];
        if (esc) {
          esc = false;
        } else if (sc === '\\') {
          esc = true;
        } else if (sc === '"') {
          idx++;
          break;
        }
        idx++;
      }
      tokens.push({ kind: 'STR', raw: noTrailing.slice(start, idx) });
      continue;
    }
    // Literal (number, true, false, null)
    const start = idx;
    while (idx < len && !' \t\r\n{}[]:,"'.includes(noTrailing[idx])) {
      idx++;
    }
    tokens.push({ kind: 'LIT', raw: noTrailing.slice(start, idx) });
  }

  const isValueEnd = (k: TokKind) => k === '}' || k === ']' || k === 'STR' || k === 'LIT';
  const isValueStart = (k: TokKind) => k === '{' || k === '[' || k === 'STR' || k === 'LIT';

  const parts: string[] = [];
  for (let t = 0; t < tokens.length; t++) {
    const cur = tokens[t];
    if (t > 0 && isValueEnd(tokens[t - 1].kind) && isValueStart(cur.kind)) {
      parts.push(',');
    }
    parts.push(cur.raw);
  }

  return JSON.parse(parts.join('')) as Record<string, Record<string, unknown>>;
}

function evalJbeamNumeric(
  raw: unknown,
  vars: Record<string, number>,
  fallback = 0
): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return fallback;
  if (raw === 'FLT_MAX') return Infinity;
  let expr = raw.trim();
  if (expr.startsWith('$=')) {
    expr = expr.slice(2);
  }
  if (expr.startsWith('$') && /^[\$a-zA-Z0-9_]+$/.test(expr)) {
    return vars[expr] ?? fallback;
  }
  const substituted = expr.replace(/\$[a-zA-Z0-9_]+/g, (token) => {
    const val = vars[token];
    return val !== undefined ? String(val) : String(fallback);
  });
  if (/^[0-9+\-*/().\s]+$/.test(substituted)) {
    try {
      const fn = new Function(`return (${substituted});`) as () => unknown;
      const res = fn();
      if (typeof res === 'number' && Number.isFinite(res)) return res;
    } catch {
      return fallback;
    }
  }
  const parsed = Number(substituted);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectVariables(
  parts: Record<string, Record<string, unknown>>,
  mode: 'default' | 'max'
): Record<string, number> {
  const vars: Record<string, number> = {};
  for (const part of Object.values(parts)) {
    const rows = (part.variables as unknown[][]) || [];
    for (const row of rows) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0].startsWith('$')) continue;
      const name = row[0];
      const defVal = typeof row[4] === 'number' ? row[4] : 0;
      const maxVal = typeof row[6] === 'number' ? row[6] : defVal;
      vars[name] = mode === 'max' ? Math.max(defVal, maxVal) : defVal;
    }
  }
  return vars;
}

export function validateModPhysics(
  files: ModFileSpec[],
  _chassis: ChassisPreset,
  _tune: DriftTuneParams
): BeamngPreFlightReport {
  const parts: Record<string, Record<string, unknown>> = {};
  for (const f of files) {
    if (!f.filename.endsWith('.jbeam')) continue;
    const doc = JSON.parse(f.content) as Record<string, Record<string, unknown>>;
    Object.assign(parts, doc);
  }

  // Evaluate both default and worst-case max variable settings
  const maxVars = collectVariables(parts, 'max');

  const nodes = new Map<
    string,
    {
      pos: [number, number, number];
      weightKg: number;
      partName: string;
      collision: boolean;
      selfCollision: boolean;
      groups: string[];
    }
  >();

  const sumSpring = new Map<string, number>();
  const sumDamp = new Map<string, number>();
  const wheelCheckIssues: string[] = [];
  const nodeOffsetIssues: string[] = [];
  const powertrainIssues: string[] = [];
  const hydroIssues: string[] = [];
  const collisionIssues: string[] = [];
  const flexbodyIssues: string[] = [];
  const groupToNodes = new Map<string, Set<string>>();

  // Pass 1: Extract nodes & properties from active core parts (exclude secondary variants so shared node names don't double-count)
  const secondaryVariants = new Set<string>();
  for (const partName of Object.keys(parts)) {
    if (partName.endsWith('_street_subframe_F') || partName.endsWith('_coilover_F_pro')) {
      secondaryVariants.add(partName);
    }
  }

  for (const [partName, part] of Object.entries(parts)) {
    if (secondaryVariants.has(partName)) continue;
    let curWeight = 5.0;
    let curCollision = false;
    let curSelfCollision = false;
    let curGroups: string[] = [];

    for (const row of (part.nodes as unknown[]) || []) {
      if (!Array.isArray(row) && typeof row === 'object' && row !== null) {
        const obj = row as JBeamRowObj;
        if (typeof obj.nodeWeight === 'number') curWeight = obj.nodeWeight;
        if (typeof obj.collision === 'boolean') curCollision = obj.collision;
        if (typeof obj.selfCollision === 'boolean') curSelfCollision = obj.selfCollision;
        if ('group' in obj) {
          const g = obj.group;
          curGroups = Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : typeof g === 'string' && g ? [g] : [];
        }
      } else if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number') {
        const nid = row[0];
        const pos: [number, number, number] = [row[1], row[2] as number, row[3] as number];
        nodes.set(nid, {
          pos,
          weightKg: curWeight,
          partName,
          collision: curCollision,
          selfCollision: curSelfCollision,
          groups: [...curGroups],
        });
        for (const g of curGroups) {
          const set = groupToNodes.get(g) ?? new Set<string>();
          set.add(nid);
          groupToNodes.set(g, set);
        }
        // Check interior/upper suspension nodes against stock bx_body wheel-well collision traps
        if (curCollision && pos[2] > 0.25) {
          collisionIssues.push(`${nid} (${partName}, z=${pos[2].toFixed(3)}m) has collision:true`);
        }
      }
    }
  }

  // Pass 2: Accumulate per-node spring & damping totals across all beams & hydros + verify contracts
  let hasWheeldataSpindleRL = false;
  let hasWheeldataSpindleRR = false;
  let hasDiffAxleRL = false;
  let hasDiffAxleRR = false;

  for (const [partName, part] of Object.entries(parts)) {
    if (secondaryVariants.has(partName)) continue;

    const processBeamList = (rows: unknown[] | undefined, isHydro: boolean) => {
      if (!rows) return;
      let curSpring = 1_500_000;
      let curDamp = 60;
      let curDampRebound = 60;
      let curLimitSpring = 0;
      let curLimitDamp = 0;
      let curBeamType = '|NORMAL';

      for (const row of rows) {
        if (!Array.isArray(row) && typeof row === 'object' && row !== null) {
          const obj = row as JBeamRowObj;
          if ('beamSpring' in obj) curSpring = evalJbeamNumeric(obj.beamSpring, maxVars, curSpring);
          if ('beamDamp' in obj) {
            curDamp = evalJbeamNumeric(obj.beamDamp, maxVars, curDamp);
            if (!('beamDampRebound' in obj)) curDampRebound = curDamp;
          }
          if ('beamDampRebound' in obj) curDampRebound = evalJbeamNumeric(obj.beamDampRebound, maxVars, curDampRebound);
          if ('beamLimitSpring' in obj) curLimitSpring = evalJbeamNumeric(obj.beamLimitSpring, maxVars, 0);
          if ('beamLimitDamp' in obj) curLimitDamp = evalJbeamNumeric(obj.beamLimitDamp, maxVars, 0);
          if (typeof obj.beamType === 'string') curBeamType = obj.beamType;
        } else if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string' && row[0] !== 'id1:') {
          const id1 = row[0];
          const id2 = row[1];
          const overrides = (row[2] as JBeamRowObj | undefined) ?? {};
          const kBase = 'beamSpring' in overrides ? evalJbeamNumeric(overrides.beamSpring, maxVars, curSpring) : curSpring;
          const cBase = Math.max(
            'beamDamp' in overrides ? evalJbeamNumeric(overrides.beamDamp, maxVars, curDamp) : curDamp,
            'beamDampRebound' in overrides ? evalJbeamNumeric(overrides.beamDampRebound, maxVars, curDampRebound) : curDampRebound
          );
          const kEff = curBeamType === '|BOUNDED' ? Math.max(kBase, curLimitSpring) : kBase;
          const cEff = curBeamType === '|BOUNDED' ? Math.max(cBase, curLimitDamp) : cBase;

          sumSpring.set(id1, (sumSpring.get(id1) ?? 0) + kEff);
          sumSpring.set(id2, (sumSpring.get(id2) ?? 0) + kEff);
          sumDamp.set(id1, (sumDamp.get(id1) ?? 0) + cEff);
          sumDamp.set(id2, (sumDamp.get(id2) ?? 0) + cEff);

          if (isHydro) {
            const inLim = typeof overrides.inLimit === 'number' ? overrides.inLimit : 1;
            const outLim = typeof overrides.outLimit === 'number' ? overrides.outLimit : 1;
            if (!(inLim >= 0.4 && inLim < 1.0 && outLim > 1.0 && outLim <= 1.6)) {
              hydroIssues.push(`${id1}-${id2} invalid hydro limits [${inLim}, ${outLim}]`);
            }
          }
        }
      }
    };

    processBeamList(part.beams as unknown[] | undefined, false);
    processBeamList(part.hydros as unknown[] | undefined, true);

    // Check wheel_F / wheel_R slot nodeOffset against hub spindle coordinates
    const slotRows = [
      ...((part.slots as unknown[][]) || []),
      ...((part.slots2 as unknown[][]) || []),
    ];
    for (const sRow of slotRows) {
      if (!Array.isArray(sRow) || typeof sRow[0] !== 'string') continue;
      const slotName = sRow[0];
      if (!slotName.startsWith('wheel_F_') && !slotName.startsWith('wheel_R_')) continue;
      const isFront = slotName.startsWith('wheel_F_');
      const meta = (sRow[sRow.length - 1] as JBeamRowObj | undefined) ?? {};
      const no = meta.nodeOffset as JBeamRowObj | undefined;
      const refIn = nodes.get(isFront ? 'fw1r' : 'rw1r');
      const refOut = nodes.get(isFront ? 'fw1rr' : 'rw1rr');
      if (!no || !refIn || !refOut) {
        nodeOffsetIssues.push(`${slotName} missing nodeOffset or hub spindle nodes`);
        continue;
      }
      const offY = typeof no.y === 'number' ? no.y : 0;
      const offZ = typeof no.z === 'number' ? no.z : 0;
      const offX = evalJbeamNumeric(no.x, { $trackoffset_F: 0, $trackoffset_R: 0 }, 0);
      const hubMidX = Math.abs(refIn.pos[0] + refOut.pos[0]) * 0.5;
      const expectedOffX = hubMidX - 0.425;
      if (Math.abs(offY - refIn.pos[1]) > 0.025 || Math.abs(offZ - refIn.pos[2]) > 0.025) {
        nodeOffsetIssues.push(
          `${slotName} nodeOffset (y=${offY}, z=${offZ}) misaligned with hub spindle (y=${refIn.pos[1]}, z=${refIn.pos[2]})`
        );
      } else if (Math.abs(offX - expectedOffX) > 0.025) {
        nodeOffsetIssues.push(
          `${slotName} nodeOffset.x (${offX.toFixed(3)}) misaligned with hub center ${hubMidX.toFixed(3)}m`
        );
      }
    }

    // Check powertrain contracts (wheeldata_R spindleRL/RR <-> differential_R wheelaxleRL/RR)
    const pt = part.powertrain as unknown[][] | undefined;
    if (pt) {
      for (const pRow of pt) {
        if (!Array.isArray(pRow) || pRow[0] === 'type') continue;
        const pName = pRow[1];
        const pInput = pRow[2];
        const pOpts = (pRow[4] as JBeamRowObj | undefined) ?? {};
        if (partName.includes('wheeldata_R')) {
          if (pName === 'spindleRL' && pInput === 'wheelaxleRL' && pOpts.connectedWheel === 'RL') {
            hasWheeldataSpindleRL = true;
          }
          if (pName === 'spindleRR' && pInput === 'wheelaxleRR' && pOpts.connectedWheel === 'RR') {
            hasWheeldataSpindleRR = true;
          }
        }
        if (partName.includes('diff_R')) {
          if (pName === 'wheelaxleRL') {
            hasDiffAxleRL = true;
            if ('connectedWheel' in pOpts) {
              powertrainIssues.push('diff_R wheelaxleRL should not set connectedWheel directly (wheeldata_R owns spindleRL)');
            }
          }
          if (pName === 'wheelaxleRR') {
            hasDiffAxleRR = true;
            if ('connectedWheel' in pOpts) {
              powertrainIssues.push('diff_R wheelaxleRR should not set connectedWheel directly (wheeldata_R owns spindleRR)');
            }
          }
        }
      }
    }

    // Check pressureWheels orientation & nodeArm existence
    const pw = part.pressureWheels as unknown[][] | undefined;
    if (pw) {
      for (const row of pw) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || row[0] === 'name') continue;
        const [wName, , , n1, n2, , nodeArm, wheelDir] = row as [
          string,
          string,
          string,
          string,
          string,
          number,
          string,
          number,
        ];
        const p1 = nodes.get(n1);
        const p2 = nodes.get(n2);
        const arm = nodes.get(nodeArm);
        if (!p1 || !p2) {
          wheelCheckIssues.push(`${wName} missing hub spindle node ${n1} or ${n2}`);
          continue;
        }
        if (!arm) {
          wheelCheckIssues.push(`${wName} missing nodeArm ${nodeArm}`);
        }
        const dx = p2.pos[0] - p1.pos[0];
        const span = Math.hypot(dx, p2.pos[1] - p1.pos[1], p2.pos[2] - p1.pos[2]);
        if (span < 0.1 || span > 0.24) {
          wheelCheckIssues.push(`${wName} hub width ${(span * 1000).toFixed(0)}mm outside 100..240mm`);
        }
        // BeamNG pressureWheels convention: (pos(node2) - pos(node1)).x * wheelDir > 0
        if (dx * wheelDir <= 0) {
          wheelCheckIssues.push(
            `${wName} flipped wheel axis polarity (${n1}->${n2} dx=${dx.toFixed(3)} with wheelDir=${wheelDir})`
          );
        }
      }
    }

    // Check flexbodies
    const fb = part.flexbodies as unknown[][] | undefined;
    if (fb) {
      for (const row of fb) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || row[0] === 'mesh') continue;
        const meshName = row[0];
        const groups = Array.isArray(row[1]) ? (row[1] as string[]) : [];
        let nodeCount = 0;
        for (const g of groups) {
          nodeCount += groupToNodes.get(g)?.size ?? 0;
        }
        if (nodeCount < 3) {
          flexbodyIssues.push(`${meshName} has only ${nodeCount} nodes in [${groups.join(', ')}] (< 3)`);
        }
      }
    }
  }

  if (!hasWheeldataSpindleRL || !hasWheeldataSpindleRR) {
    powertrainIssues.push('wheeldata_R missing spindleRL/spindleRR powertrain shafts');
  }
  if (!hasDiffAxleRL || !hasDiffAxleRR) {
    powertrainIssues.push('diff_R missing wheelaxleRL/wheelaxleRR shafts');
  }
  if (_chassis.beamngInternalId === 'bx') {
    if (!nodes.has('fx6r') || !nodes.has('fx6l')) {
      powertrainIssues.push('bx subframe missing fx6r/fx6l front engine mount nodes');
    }
    const fx4r = nodes.get('fx4r');
    if (fx4r && Math.abs(fx4r.pos[0]) < 0.36) {
      powertrainIssues.push(`fx4r (${fx4r.pos[0].toFixed(3)}m) inside bx engine bay block (< 0.36m)`);
    }
  }

  // Pass 3: Compute worst stiffness-to-mass and damping-to-mass across local AND stock unibody nodes
  let maxStiffnessRatio = 0;
  let maxStiffnessNode = '';
  let maxDampingRatio = 0;
  let maxDampingNode = '';

  const allNodeIds = new Set([...sumSpring.keys(), ...nodes.keys()]);
  for (const nid of allNodeIds) {
    const info = nodes.get(nid);
    const weight = info ? info.weightKg : ASSUMED_UNIBODY_NODE_WEIGHT_KG;
    const kTotal = sumSpring.get(nid) ?? 0;
    const cTotal = sumDamp.get(nid) ?? 0;
    const kRatio = kTotal / weight;
    const cRatio = cTotal / weight;
    const tag = info ? `${nid} (${info.weightKg}kg)` : `${nid} (stock unibody ~${weight}kg)`;
    if (kRatio > maxStiffnessRatio) {
      maxStiffnessRatio = kRatio;
      maxStiffnessNode = tag;
    }
    if (cRatio > maxDampingRatio) {
      maxDampingRatio = cRatio;
      maxDampingNode = tag;
    }
  }

  const stiffnessStatus: PhysicsCheckItem['status'] =
    maxStiffnessRatio >= DEFAULT_SOLVER_STIFFNESS_FAIL
      ? 'fail'
      : maxStiffnessRatio >= DEFAULT_SOLVER_STIFFNESS_WARN
        ? 'warn'
        : 'pass';

  const dampingStatus: PhysicsCheckItem['status'] =
    maxDampingRatio >= DEFAULT_SOLVER_DAMPING_FAIL
      ? 'fail'
      : maxDampingRatio >= DEFAULT_SOLVER_DAMPING_WARN
        ? 'warn'
        : 'pass';

  const wheelTotalIssues = [...wheelCheckIssues, ...nodeOffsetIssues];

  const checks: PhysicsCheckItem[] = [
    {
      id: 'solver-stiffness',
      label: '2000 Hz Solver Stiffness (Σk / m)',
      status: stiffnessStatus,
      detail: `Peak ${(maxStiffnessRatio / 1e6).toFixed(2)} MN/(m·kg) on ${maxStiffnessNode || 'n/a'} (limit < 3.00)`,
    },
    {
      id: 'solver-damping',
      label: '2000 Hz Damping Margin (Σc / m)',
      status: dampingStatus,
      detail: `Peak ${Math.round(maxDampingRatio)} s⁻¹ on ${maxDampingNode || 'n/a'} (limit < 2,400)`,
    },
    {
      id: 'wheel-polarity',
      label: 'Hub Polarity & Wheel Offset',
      status: wheelTotalIssues.length > 0 ? 'fail' : 'pass',
      detail:
        wheelTotalIssues.length > 0
          ? wheelTotalIssues[0]
          : 'All 4 hubs (+X · wheelDir > 0) & wheel nodeOffsets aligned to axle centers',
    },
    {
      id: 'unibody-collision',
      label: 'Unibody & Engine Clearance',
      status: collisionIssues.length + powertrainIssues.length > 0 ? 'fail' : 'pass',
      detail:
        collisionIssues[0] ??
        powertrainIssues[0] ??
        'Suspension collision-isolated, fx6r/l engine mounts & spindleRL/RR shafts matched',
    },
    {
      id: 'flexbody-hydros',
      label: 'Flexbody Groups & Steering Hydros',
      status: flexbodyIssues.length + hydroIssues.length > 0 ? 'fail' : 'pass',
      detail:
        flexbodyIssues[0] ??
        hydroIssues[0] ??
        'All flexbody node frames >= 3 nodes and steering hydros bounded',
    },
  ];

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');

  return {
    overallStatus: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    maxStiffnessRatio,
    maxStiffnessNode,
    maxDampingRatio,
    maxDampingNode,
    checks,
  };
}

/**
 * Analyzes user-supplied stock BeamNG .jbeam files (e.g. bx_body.jbeam, bx_suspension_F.jbeam)
 * and diffs axle centers, slot names, stiffness ranges, and unibody tie-in distances.
 */
export function analyzeReferenceJbeam(
  rawText: string,
  generatedFiles: ModFileSpec[]
): ReferenceJbeamSummary {
  const refDoc = parseRelaxedJbeam(rawText);
  const partNames = Object.keys(refDoc);
  const slotTypes: string[] = [];
  const subSlots: Array<{ slotType: string; defaultPart: string; description: string }> = [];
  const refNodes = new Map<string, [number, number, number]>();

  let minW = Infinity;
  let maxW = -Infinity;
  let minK = Infinity;
  let maxK = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;

  for (const part of Object.values(refDoc)) {
    if (typeof part.slotType === 'string') slotTypes.push(part.slotType);
    for (const s of (part.slots as unknown[][]) || []) {
      if (Array.isArray(s) && typeof s[0] === 'string' && s[0] !== 'type') {
        subSlots.push({
          slotType: s[0],
          defaultPart: typeof s[1] === 'string' ? s[1] : '',
          description: typeof s[2] === 'string' ? s[2] : '',
        });
      }
    }
    for (const s of (part.slots2 as unknown[][]) || []) {
      if (Array.isArray(s) && typeof s[0] === 'string' && s[0] !== 'name') {
        subSlots.push({
          slotType: s[0],
          defaultPart: typeof s[3] === 'string' ? s[3] : '',
          description: typeof s[4] === 'string' ? s[4] : '',
        });
      }
    }
    for (const row of (part.nodes as unknown[]) || []) {
      if (!Array.isArray(row) && typeof row === 'object' && row !== null) {
        const w = (row as JBeamRowObj).nodeWeight;
        if (typeof w === 'number') {
          minW = Math.min(minW, w);
          maxW = Math.max(maxW, w);
        }
      } else if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number') {
        refNodes.set(row[0], [row[1], row[2] as number, row[3] as number]);
      }
    }
    for (const row of (part.beams as unknown[]) || []) {
      if (!Array.isArray(row) && typeof row === 'object' && row !== null) {
        const k = (row as JBeamRowObj).beamSpring;
        const c = (row as JBeamRowObj).beamDamp;
        if (typeof k === 'number') {
          minK = Math.min(minK, k);
          maxK = Math.max(maxK, k);
        }
        if (typeof c === 'number') {
          minC = Math.min(minC, c);
          maxC = Math.max(maxC, c);
        }
      }
    }
  }

  const frontWheelYs = ['fw1r', 'fw1l', 'fh1r', 'fh1l']
    .map((id) => refNodes.get(id)?.[1])
    .filter((v): v is number => typeof v === 'number');
  const rearWheelYs = ['rw1r', 'rw1l', 'rh1r', 'rh1l']
    .map((id) => refNodes.get(id)?.[1])
    .filter((v): v is number => typeof v === 'number');

  // Compare generated optional tie-in beams against nodes found in the reference file
  const genNodes = new Map<string, [number, number, number]>();
  const tieInTargets = new Set<string>();
  const tieInPairs: Array<{ local: string; remote: string }> = [];

  for (const f of generatedFiles) {
    if (!f.filename.endsWith('.jbeam')) continue;
    const doc = JSON.parse(f.content) as Record<string, Record<string, unknown>>;
    for (const part of Object.values(doc)) {
      for (const row of (part.nodes as unknown[]) || []) {
        if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number') {
          genNodes.set(row[0], [row[1], row[2] as number, row[3] as number]);
        }
      }
      let isOpt = false;
      for (const row of (part.beams as unknown[]) || []) {
        if (!Array.isArray(row) && typeof row === 'object' && row !== null && 'optional' in row) {
          isOpt = Boolean((row as JBeamRowObj).optional);
        } else if (isOpt && Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') {
          if (genNodes.has(row[0]) && !genNodes.has(row[1])) {
            tieInTargets.add(row[1]);
            tieInPairs.push({ local: row[0], remote: row[1] });
          } else if (genNodes.has(row[1]) && !genNodes.has(row[0])) {
            tieInTargets.add(row[0]);
            tieInPairs.push({ local: row[1], remote: row[0] });
          }
        }
      }
    }
  }

  const missingUnibodyTieIns: string[] = [];
  const matchedTieInNodes: ReferenceJbeamSummary['matchedTieInNodes'] = [];
  for (const nid of tieInTargets) {
    const rp = refNodes.get(nid);
    if (!rp) {
      missingUnibodyTieIns.push(nid);
    } else {
      const pair = tieInPairs.find((p) => p.remote === nid);
      const lp = pair ? genNodes.get(pair.local) : undefined;
      const dist = lp ? Math.hypot(lp[0] - rp[0], lp[1] - rp[1], lp[2] - rp[2]) : 0;
      matchedTieInNodes.push({
        nodeId: nid,
        refPos: rp,
        nearestDriftModNode: pair?.local ?? '',
        distanceM: dist,
      });
    }
  }

  return {
    partNames,
    slotTypes,
    subSlots,
    nodeCount: refNodes.size,
    frontAxleYAvg: frontWheelYs.length ? frontWheelYs.reduce((a, b) => a + b, 0) / frontWheelYs.length : null,
    rearAxleYAvg: rearWheelYs.length ? rearWheelYs.reduce((a, b) => a + b, 0) / rearWheelYs.length : null,
    nodeWeightRange: Number.isFinite(minW) ? [minW, maxW] : null,
    beamSpringRange: Number.isFinite(minK) ? [minK, maxK] : null,
    beamDampRange: Number.isFinite(minC) ? [minC, maxC] : null,
    missingUnibodyTieIns,
    matchedTieInNodes,
  };
}
