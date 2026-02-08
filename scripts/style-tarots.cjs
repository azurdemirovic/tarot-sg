/**
 * "Colorful Engraved" style treatment for tarot cards.
 * 
 * Same pipeline as symbol styler but KEEPS COLOR — just fries it a bit.
 * Slight desaturation, contrast boost, edge ink, crosshatch, grain, rim light.
 * 
 * Reads from public/assets/tarots_original/  (untouched originals)
 * Writes to   public/assets/tarots/
 * 
 * To revert: node scripts/revert-tarots.cjs
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'tarots_original');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'tarots');

const tarots = fs.readdirSync(SRC)
  .filter(f => f.endsWith('.jpg') || f.endsWith('.png'));

/* ── Texture generators ────────────────────────────── */

function crosshatchSVG(w, h) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="white"/>
    <defs>
      <pattern id="h1" width="8" height="8" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0,0,0,0.12)" stroke-width="0.5"/>
      </pattern>
      <pattern id="h2" width="8" height="8" patternTransform="rotate(-35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0,0,0,0.12)" stroke-width="0.5"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#h1)"/>
    <rect width="${w}" height="${h}" fill="url(#h2)"/>
  </svg>`);
}

function noiseBuffer(w, h, intensity = 18) {
  const len = w * h * 4;
  const buf = Buffer.alloc(len);
  for (let i = 0; i < len; i += 4) {
    const v = 128 + Math.floor((Math.random() - 0.5) * intensity * 2);
    buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
  }
  return buf;
}

function rimLightSVG(w, h) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <radialGradient id="rim" cx="20%" cy="20%" r="80%">
        <stop offset="0%"   stop-color="white" stop-opacity="0.10"/>
        <stop offset="60%"  stop-color="white" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.15"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#rim)"/>
  </svg>`);
}

/* ── Main processing pipeline ──────────────────────── */

async function processTarot(filename) {
  const input = path.join(SRC, filename);
  const output = path.join(OUT, filename);

  const meta = await sharp(input).metadata();
  const w = meta.width;
  const h = meta.height;

  // 1. Color base: slight desaturation + contrast boost + crush blacks a bit
  const base = await sharp(input)
    .modulate({ saturation: 0.8, brightness: 0.95 })  // 20% desaturation, slight dim
    .linear(1.4, -30)                                   // contrast boost (gentler than symbols)
    .toBuffer();

  // 2. Edge detection for ink-line look (from grayscale derivative)
  const grayForEdges = await sharp(base)
    .grayscale()
    .toBuffer();

  const edges = await sharp(grayForEdges)
    .convolve({
      width: 3, height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      scale: 1, offset: 0
    })
    .negate()
    .linear(1.5, -70)  // softer than symbols
    .toBuffer();

  // Convert edges to 3-channel to match base (ensure same channel count)
  const edges3ch = await sharp(edges)
    .removeAlpha()
    .toColourspace('srgb')
    .toBuffer();

  // 3. Crosshatch texture (light)
  const crosshatch = await sharp(crosshatchSVG(w, h))
    .resize(w, h)
    .removeAlpha()
    .toColourspace('srgb')
    .png()
    .toBuffer();

  // 4. Paper grain / noise
  const noise = await sharp(noiseBuffer(w, h, 18),
    { raw: { width: w, height: h, channels: 4 } })
    .removeAlpha()
    .toColourspace('srgb')
    .png()
    .toBuffer();

  // 5. Rim light gradient
  const rim = await sharp(rimLightSVG(w, h))
    .resize(w, h)
    .removeAlpha()
    .toColourspace('srgb')
    .png()
    .toBuffer();

  // 6. Ensure base is 3 channels sRGB
  const base3ch = await sharp(base)
    .removeAlpha()
    .toColourspace('srgb')
    .toBuffer();

  // 7. Composite all effects on COLOR base
  const styled = await sharp(base3ch)
    .composite([
      { input: edges3ch,   blend: 'multiply',   top: 0, left: 0 },
      { input: crosshatch, blend: 'multiply',   top: 0, left: 0 },
      { input: noise,      blend: 'soft-light', top: 0, left: 0 },
      { input: rim,        blend: 'overlay',     top: 0, left: 0 },
    ])
    .sharpen({ sigma: 0.7 })
    .toFile(output);

  console.log(`  ✓ ${filename} (${w}×${h}) — colorful fry applied`);
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Colorful Engraved — Tarot Styler    ║');
  console.log('╚══════════════════════════════════════╝\n');
  console.log(`Source:  ${SRC}`);
  console.log(`Output:  ${OUT}`);
  console.log(`Tarots:  ${tarots.length}\n`);

  for (const t of tarots) {
    await processTarot(t);
  }

  console.log('\n✅ Done! Originals safe in tarots_original/');
  console.log('   Revert with: node scripts/revert-tarots.cjs');
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
