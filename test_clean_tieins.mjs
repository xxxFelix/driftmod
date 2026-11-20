import { CHASSIS_PRESETS } from './src/data/presets.ts';
import { generateBeamNGModFiles } from './src/utils/jbeamGenerator.ts';
import { validateModPhysics } from './src/utils/beamngPhysicsValidator.ts';
import fs from 'node:fs';

// Let's inspect what happens if we replace the tie-in beams in doubleWishboneJbeam
// Let's create a test function that modifies the files in memory and checks validateModPhysics
const preset = CHASSIS_PRESETS[0];
const tune = preset.defaultTune;
const files = generateBeamNGModFiles(preset, tune);

// Let's inspect the current files
console.log('Validating default:');
const rep = validateModPhysics(files, preset, tune);
console.log('Status:', rep.overallStatus, 'maxK:', rep.maxStiffnessRatio, 'on', rep.maxStiffnessNode);
for (const c of rep.checks) {
  console.log(`  ${c.id}: ${c.status} (${c.detail})`);
}
