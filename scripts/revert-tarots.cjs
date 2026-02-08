/**
 * Revert tarot cards to their original state.
 * Copies from tarots_original/ back to tarots/
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'tarots_original');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'tarots');

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));

for (const file of files) {
  fs.copyFileSync(path.join(SRC, file), path.join(OUT, file));
  console.log(`  ✓ Reverted ${file}`);
}

console.log(`\n✅ ${files.length} tarots reverted to originals.`);
