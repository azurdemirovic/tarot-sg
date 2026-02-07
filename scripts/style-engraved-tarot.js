/**
 * "Engraved Tarot" style treatment for slot symbols.
 * 
 * Reads from public/assets/symbols_original/
 * Writes to   public/assets/symbols/
 * 
 * To revert: run scripts/revert-symbols.js
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZE = 500;
const SRC = path.join(__dirname, '..', 'public', 'assets', 'symbols_original');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'symbols');

// Only process game symbols (not UI assets)
const SKIP = ['frame.png', 'button.png'];
const symbols = fs.readdirSync(SRC)
  .filter(f => f.endsWith('.png') && !SKIP.includes(f));

/* ── Texture generators ─────────────────────────────── */

function crosshatchSVG(size) {
  // Two sets of diagonal lines forming a cross-hatch, on white bg
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="white"/>
    <defs>
      <pattern id="h1" width="7" height="7" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(0,0,0,0.18)" stroke-width="0.6"/>
      </pattern>
      <pattern id="h2" width="7" height="7" patternTransform="rotate(-35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(0,0,0,0.18)" stroke-width="0.6"/>
      </pattern>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#h1)"/>
    <rect width="${size}" height="${size}" fill="url(#h2)"/>
  </svg>`);
}

function noiseBuffer(size, intensity = 22) {
  // Gray noise centred on 128 for soft-light neutrality
  const len = size * size * 4;
  const buf = Buffer.alloc(len);
  for (let i = 0; i < len; i += 4) {
    const v = 128 + Math.floor((Math.random() - 0.5) * intensity * 2);
    buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
  }
  return buf;
}

function rimLightSVG(size) {
  // Radial: bright top-left highlight, dark bottom-right shadow
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <radialGradient id="rim" cx="20%" cy="20%" r="80%">
        <stop offset="0%"   stop-color="white" stop-opacity="0.12"/>
        <stop offset="60%"  stop-color="white" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.18"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#rim)"/>
  </svg>`);
}

function innerStrokeSVG(size) {
  // Double keyline border: thin inner rectangle pair
  const o1 = 4, o2 = 9; // offsets for double keyline
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect x="${o1}" y="${o1}" width="${size - o1 * 2}" height="${size - o1 * 2}"
          fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1.2" rx="2"/>
    <rect x="${o2}" y="${o2}" width="${size - o2 * 2}" height="${size - o2 * 2}"
          fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="0.8" rx="1"/>
  </svg>`);
}

function dropShadowSVG(size) {
  // Tight, soft shadow offset bottom-right
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <filter id="ds" x="-10%" y="-10%" width="130%" height="130%">
        <feDropShadow dx="2" dy="2" stdDeviation="2.5" flood-color="black" flood-opacity="0.35"/>
      </filter>
    </defs>
    <rect x="12" y="12" width="${size - 24}" height="${size - 24}" rx="4"
          fill="rgba(0,0,0,0)" stroke="none" filter="url(#ds)"/>
  </svg>`);
}

/* ── Main processing pipeline ───────────────────────── */

async function processSymbol(filename) {
  const input = path.join(SRC, filename);
  const output = path.join(OUT, filename);

  // 1 ▸ Grayscale + crush blacks (strong contrast)
  const base = await sharp(input)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .grayscale()
    .linear(1.5, -40)        // boost contrast, push shadows darker
    .modulate({ brightness: 0.95 })
    .toBuffer();

  // 2 ▸ Edge detection for engraved ink-line look
  const edges = await sharp(base)
    .convolve({
      width: 3, height: 3,
      kernel: [-1, -1, -1,  -1, 8, -1,  -1, -1, -1],
      scale: 1, offset: 0
    })
    .negate()                         // dark edges on white
    .linear(1.8, -100)               // strengthen lines
    .toBuffer();

  // 3 ▸ Crosshatch texture (pre-render SVG)
  const crosshatch = await sharp(crosshatchSVG(SIZE))
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();

  // 4 ▸ Paper grain / noise
  const noise = await sharp(noiseBuffer(SIZE, 22),
    { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer();

  // 5 ▸ Rim light gradient
  const rim = await sharp(rimLightSVG(SIZE))
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();

  // 6 ▸ Inner stroke / double keyline
  const stroke = await sharp(innerStrokeSVG(SIZE))
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();

  // 7 ▸ Composite everything
  await sharp(base)
    .composite([
      { input: edges,      blend: 'multiply',   top: 0, left: 0 },  // ink lines
      { input: crosshatch, blend: 'multiply',   top: 0, left: 0 },  // hatch texture
      { input: noise,      blend: 'soft-light', top: 0, left: 0 },  // paper grain
      { input: rim,        blend: 'overlay',     top: 0, left: 0 },  // rim highlight
      { input: stroke,     blend: 'over',        top: 0, left: 0 },  // double keyline
    ])
    .sharpen({ sigma: 0.8 })
    .toFile(output);

  console.log(`  ✓ ${filename}`);
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Engraved Tarot — Symbol Styler      ║');
  console.log('╚══════════════════════════════════════╝\n');
  console.log(`Source:  ${SRC}`);
  console.log(`Output:  ${OUT}`);
  console.log(`Symbols: ${symbols.length}\n`);

  for (const sym of symbols) {
    await processSymbol(sym);
  }

  console.log('\n✅ Done! Originals safe in symbols_original/');
  console.log('   Revert with: node scripts/revert-symbols.js');
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
