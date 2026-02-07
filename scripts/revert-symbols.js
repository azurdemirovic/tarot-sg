/**
 * Revert symbols back to originals (undo any style treatment).
 * Copies from public/assets/symbols_original/ → public/assets/symbols/
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'symbols_original');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'symbols');

const SKIP = ['frame.png', 'button.png'];
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.png') && !SKIP.includes(f));

console.log(`Reverting ${files.length} symbols to originals...\n`);

files.forEach(f => {
  fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
  console.log(`  ✓ ${f}`);
});

console.log('\n✅ All symbols reverted to original state.');
