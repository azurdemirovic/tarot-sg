/**
 * Light "engraved tarot" fry for frame.png only.
 * Reads from symbols_original/frame.png, writes to symbols/frame.png
 * 
 * Revert: copy public/assets/symbols_original/frame.png → public/assets/symbols/frame.png
 */
const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'symbols_original', 'frame.png');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'symbols', 'frame.png');

function crosshatchSVG(w, h) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="white"/>
    <defs>
      <pattern id="h1" width="9" height="9" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="9" stroke="rgba(0,0,0,0.10)" stroke-width="0.5"/>
      </pattern>
      <pattern id="h2" width="9" height="9" patternTransform="rotate(-35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="9" stroke="rgba(0,0,0,0.10)" stroke-width="0.5"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#h1)"/>
    <rect width="${w}" height="${h}" fill="url(#h2)"/>
  </svg>`);
}

function noiseBuffer(w, h, intensity = 15) {
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
        <stop offset="0%"   stop-color="white" stop-opacity="0.08"/>
        <stop offset="60%"  stop-color="white" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.10"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#rim)"/>
  </svg>`);
}

async function main() {
  console.log('🖼️  Styling frame.png (light fry)...\n');

  const meta = await sharp(SRC).metadata();
  const w = meta.width;
  const h = meta.height;
  const hasAlpha = meta.channels === 4;

  // Extract alpha if present
  let alphaBuf = null;
  if (hasAlpha) {
    alphaBuf = await sharp(SRC).extractChannel(3).toBuffer();
  }

  // 1. Grayscale + gentle contrast (lighter than symbols)
  const base = await sharp(SRC)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .grayscale()
    .linear(1.3, -20)               // gentle contrast (symbols use 1.5, -40)
    .modulate({ brightness: 0.95 })
    .toBuffer();

  // 2. Light edge detection
  const edges = await sharp(base)
    .convolve({
      width: 3, height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      scale: 1, offset: 0
    })
    .negate()
    .linear(1.4, -60)               // softer than symbols (1.8, -100)
    .toBuffer();

  // 3. Crosshatch (lighter opacity)
  const crosshatch = await sharp(crosshatchSVG(w, h))
    .resize(w, h)
    .png()
    .toBuffer();

  // 4. Subtle grain
  const noise = await sharp(noiseBuffer(w, h, 15), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();

  // 5. Rim light
  const rim = await sharp(rimLightSVG(w, h))
    .resize(w, h)
    .png()
    .toBuffer();

  // 6. Composite
  let result = await sharp(base)
    .composite([
      { input: edges,      blend: 'multiply',   top: 0, left: 0 },
      { input: crosshatch, blend: 'multiply',   top: 0, left: 0 },
      { input: noise,      blend: 'soft-light', top: 0, left: 0 },
      { input: rim,        blend: 'overlay',     top: 0, left: 0 },
    ])
    .sharpen({ sigma: 0.6 })        // lighter sharpen
    .removeAlpha()
    .toBuffer();

  // 7. Re-apply alpha if original had it
  if (alphaBuf) {
    await sharp(result)
      .joinChannel(alphaBuf)
      .toFile(OUT);
  } else {
    await sharp(result).toFile(OUT);
  }

  console.log(`  ✓ frame.png (${w}×${h}) — styled with light fry`);
  console.log('\n✅ Done! Original safe in symbols_original/frame.png');
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
