/**
 * Apply engraved tarot style (fry) to male.png and female.png
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SYMBOLS_ORIGINAL = path.join(__dirname, '..', 'public', 'assets', 'symbols_original');
const SYMBOLS_OUT = path.join(__dirname, '..', 'public', 'assets', 'symbols');

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

function noiseBuffer(w, h, intensity = 20) {
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

async function frySymbol(filename) {
  const SRC = path.join(SYMBOLS_ORIGINAL, filename);
  const OUT = path.join(SYMBOLS_OUT, filename);

  console.log(`\n── Processing ${filename} ──`);

  if (!fs.existsSync(SRC)) {
    console.error(`❌ Source not found: ${SRC}`);
    return;
  }

  const meta = await sharp(SRC).metadata();
  const w = meta.width;
  const h = meta.height;
  const hasAlpha = meta.channels === 4;
  console.log(`Source: ${SRC} (${w}×${h}, alpha=${hasAlpha})`);

  // 1. Extract alpha channel if present
  let alphaBuf = null;
  if (hasAlpha) {
    alphaBuf = await sharp(SRC).extractChannel(3).toBuffer();
  }

  // 2. Load original color image
  const originalColor = await sharp(SRC)
    .removeAlpha()
    .toBuffer();

  // 3. Create saturation mask for colored areas (gold text etc.)
  const { data: colorData } = await sharp(originalColor)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const maskData = Buffer.alloc(w * h);
  for (let i = 0; i < colorData.length; i += 3) {
    const r = colorData[i];
    const g = colorData[i + 1];
    const b = colorData[i + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;

    const isGold = r > 180 && g > 140 && b < 100 && saturation > 0.3;

    maskData[i / 3] = (saturation > 0.4 || isGold) ? 255 : 0;
  }

  const colorMask = await sharp(maskData, {
    raw: { width: w, height: h, channels: 1 }
  })
    .extend({ channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 4. Grayscale + contrast crush
  const grayBase = await sharp(SRC)
    .removeAlpha()
    .grayscale()
    .linear(1.8, -60)
    .toBuffer();

  // 5. Edge detection
  const edges = await sharp(grayBase)
    .convolve({
      width: 3, height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      scale: 1, offset: 0
    })
    .negate()
    .linear(2.0, -90)
    .toBuffer();

  // 6. Crosshatch
  const crosshatch = await sharp(crosshatchSVG(w, h))
    .resize(w, h)
    .png()
    .toBuffer();

  // 7. Noise
  const noise = await sharp(noiseBuffer(w, h, 20),
    { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();

  // 8. Rim light
  const rim = await sharp(rimLightSVG(w, h))
    .resize(w, h)
    .png()
    .toBuffer();

  // 9. Composite all effects on grayscale base
  const styledGray = await sharp(grayBase)
    .composite([
      { input: edges,      blend: 'multiply',   top: 0, left: 0 },
      { input: crosshatch, blend: 'multiply',   top: 0, left: 0 },
      { input: noise,      blend: 'soft-light', top: 0, left: 0 },
      { input: rim,        blend: 'overlay',     top: 0, left: 0 },
    ])
    .sharpen({ sigma: 0.8 })
    .removeAlpha()
    .toBuffer();

  // 10. Apply light effects to original color (for gold text area)
  const styledColor = await sharp(originalColor)
    .composite([
      { input: crosshatch, blend: 'multiply',   top: 0, left: 0, alpha: 0.3 },
      { input: noise,      blend: 'soft-light', top: 0, left: 0, alpha: 0.2 },
    ])
    .sharpen({ sigma: 0.5 })
    .toBuffer();

  // 11. Blend: use color where mask indicates gold, grayscale elsewhere
  const { data: grayPixels } = await sharp(styledGray).raw().toBuffer({ resolveWithObject: true });
  const { data: colorPixels } = await sharp(styledColor).raw().toBuffer({ resolveWithObject: true });

  const maskGrayscale = await sharp(colorMask)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const maskPixels = maskGrayscale.data;

  const finalPixels = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const maskVal = maskPixels[i];
    const idx = i * 3;

    if (maskVal > 128) {
      finalPixels[idx] = colorPixels[idx];
      finalPixels[idx + 1] = colorPixels[idx + 1];
      finalPixels[idx + 2] = colorPixels[idx + 2];
    } else {
      finalPixels[idx] = grayPixels[idx];
      finalPixels[idx + 1] = grayPixels[idx + 1];
      finalPixels[idx + 2] = grayPixels[idx + 2];
    }
  }

  const finalRGB = await sharp(finalPixels, {
    raw: { width: w, height: h, channels: 3 }
  })
    .png()
    .toBuffer();

  // 12. Re-apply original alpha if present
  if (alphaBuf) {
    await sharp(finalRGB)
      .joinChannel(alphaBuf)
      .png()
      .toFile(OUT);
  } else {
    await sharp(finalRGB)
      .png()
      .toFile(OUT);
  }

  console.log(`✅ Created: ${OUT}`);
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Fry male.png & female.png          ║');
  console.log('╚══════════════════════════════════════╝');

  await frySymbol('male.png');
  await frySymbol('female.png');

  console.log('\n✅ Done! male.png and female.png have been fried.');
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
