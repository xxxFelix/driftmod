import { CHASSIS_PRESETS } from './src/data/presets.ts';
import { generateBeamNGModFiles } from './src/utils/jbeamGenerator.ts';

const preset = CHASSIS_PRESETS[0];
const files = generateBeamNGModFiles(preset, preset.defaultTune);

const parts = {};
for (const f of files) {
  if (f.filename.endsWith('.jbeam')) {
    Object.assign(parts, JSON.parse(f.content));
  }
}

const targetNodes = ['fu2r', 'fx1r', 'f1r', 'f12rr', 'f5r', 'f6r'];
const secondaryVariants = new Set(['bx_driftmod_street_subframe_F', 'bx_driftmod_coilover_F_pro']);

for (const target of targetNodes) {
  console.log(`\n=== Beams connected to ${target} ===`);
  for (const [partName, part] of Object.entries(parts)) {
    if (secondaryVariants.has(partName)) continue;
    let curSpring = 1500000;
    let curLimitSpring = 0;
    let curBeamType = '|NORMAL';
    for (const row of part.beams || []) {
      if (!Array.isArray(row) && typeof row === 'object' && row !== null) {
        if ('beamSpring' in row) curSpring = Number(row.beamSpring) || curSpring;
        if ('beamLimitSpring' in row) curLimitSpring = Number(row.beamLimitSpring) || 0;
        if (typeof row.beamType === 'string') curBeamType = row.beamType;
      } else if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string' && row[0] !== 'id1:') {
        if (row[0] === target || row[1] === target) {
          const other = row[0] === target ? row[1] : row[0];
          const kBase = (row[2] && 'beamSpring' in row[2]) ? Number(row[2].beamSpring) : curSpring;
          const kEff = curBeamType === '|BOUNDED' ? Math.max(kBase, curLimitSpring) : kBase;
          console.log(`  ${partName}: ${target} - ${other} (k=${kEff}, type=${curBeamType})`);
        }
      }
    }
  }
}
