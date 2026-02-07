/**
 * "Engraved Tarot" style treatment for slot symbols.
 * 
 * Reads from public/assets/symbols_original/  (untouched originals)
 * Writes to   public/assets/symbols/
 * 
 * Preserves each image's native dimensions and ALPHA TRANSPARENCY.
 * 
 * To revert: node scripts/revert-symbols.cjs
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'symbols_original');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'symbols');

// Only process game symbols (not UI assets)
const SKIP = ['frame.png', 'button.png'];
const symbols = fs.readdirSync(SRC)
  .filter(f => f.endsWith('.png') && !SKIP.includes(f));

/* ── Texture generators (sized per-image) ────────────── */

function crosshatchSVG(w, h) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="white"/>
    <defs>
      <pattern id="h1" width="7" height="7" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(0,0,0,0.18)" stroke-width="0.6"/>
      </pattern>
      <pattern id="h2" width="7" height="7" patternTransform="rotate(-35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(0,0,0,0.18)" stroke-width="0.6"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#h1)"/>
    <rect width="${w}" height="${h}" fill="url(#h2)"/>
  </svg>`);
}

function noiseBuffer(w, h, intensity = 22) {
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
        <stop offset="0%"   stop-color="white" stop-opacity="0.12"/>
        <stop offset="60%"  stop-color="white" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.18"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#rim)"/>
  </svg>`);
}

/* ── Main processing pipeline ───────────────────────── */

async function processSymbol(filename) {
  const input = path.join(SRC, filename);
  const output = path.join(OUT, filename);

  // Read original dimensions
  const meta = await sharp(input).metadata();
  const w = meta.width;
  const h = meta.height;

  // ── Extract original alpha channel BEFORE any processing ──
  const alphaBuf = await sharp(input)
    .extractChannel(3)          // channel 3 = alpha
    .toBuffer();

  // 1 ▸ Flatten to white bg, then grayscale + crush blacks
  //     (flatten removes alpha so effects work on solid pixels)
  const base = await sharp(input)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .grayscale()
    .linear(1.5, -40)
    .modulate({ brightness: 0.95 })
    .toBuffer();

  // 2 ▸ Edge detection for engraved ink-line look
  const edges = await sharp(base)
    .convolve({
      width: 3, height: 3,
      kernel: [-1, -1, -1,  -1, 8, -1,  -1, -1, -1],
      scale: 1, offset: 0
    })
    .negate()
    .linear(1.8, -100)
    .toBuffer();

  // 3 ▸ Crosshatch texture
  const crosshatch = await sharp(crosshatchSVG(w, h))
    .resize(w, h)
    .png()
    .toBuffer();

  // 4 ▸ Paper grain / noise
  const noise = await sharp(noiseBuffer(w, h, 22),
    { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();

  // 5 ▸ Rim light gradient
  const rim = await sharp(rimLightSVG(w, h))
    .resize(w, h)
    .png()
    .toBuffer();

  // 6 ▸ Composite all effects (result is opaque RGB)
  const styled = await sharp(base)
    .composite([
      { input: edges,      blend: 'multiply',   top: 0, left: 0 },
      { input: crosshatch, blend: 'multiply',   top: 0, left: 0 },
      { input: noise,      blend: 'soft-light', top: 0, left: 0 },
      { input: rim,        blend: 'overlay',     top: 0, left: 0 },
    ])
    .sharpen({ sigma: 0.8 })
    .removeAlpha()              // ensure 3 channels (RGB)
    .toBuffer();

  // 7 ▸ Re-apply original alpha mask to restore transparency
  await sharp(styled)
    .joinChannel(alphaBuf)      // adds the saved alpha as 4th channel
    .toFile(output);

  // Verify transparency preserved
  const outMeta = await sharp(output).metadata();
  const { data } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  let transparentCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 255) transparentCount++;
  }
  const pct = (transparentCount / (w * h) * 100).toFixed(1);
  console.log(`  ✓ ${filename} (${w}×${h}) — ${pct}% transparent`);
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Engraved Tarot — Symbol Styler      ║');
  console.log('║  (preserves alpha transparency)      ║');
  console.log('╚══════════════════════════════════════╝\n');
  console.log(`Source:  ${SRC}`);
  console.log(`Output:  ${OUT}`);
  console.log(`Symbols: ${symbols.length}\n`);

  for (const sym of symbols) {
    await processSymbol(sym);
  }

  console.log('\n✅ Done! Originals safe in symbols_original/');
  console.log('   Revert with: node scripts/revert-symbols.cjs');
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
