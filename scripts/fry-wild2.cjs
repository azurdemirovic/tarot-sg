/**
 * Apply engraved tarot style to WILD2.png and replace WILD.png
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'symbols_original', 'WILD2.png');
const OUT_WILD2 = path.join(__dirname, '..', 'public', 'assets', 'symbols', 'WILD2.png');
const OUT_WILD = path.join(__dirname, '..', 'public', 'assets', 'symbols', 'WILD.png');

// Copy the processing logic from style-engraved-tarot.cjs
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

async function processWILD2() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Fry WILD2.png → Replace WILD.png    ║');
  console.log('╚══════════════════════════════════════╝\n');

  if (!fs.existsSync(SRC)) {
    console.error(`❌ Source not found: ${SRC}`);
    process.exit(1);
  }

  const meta = await sharp(SRC).metadata();
  const w = meta.width;
  const h = meta.height;
  console.log(`Source: ${SRC} (${w}×${h})\n`);

  // 1. Extract alpha channel
  const alphaBuf = await sharp(SRC).extractChannel(3).toBuffer();

  // 2. Load original color image (for preserving gold text)
  const originalColor = await sharp(SRC)
    .removeAlpha()
    .toBuffer();

  // 3. Create a mask for colored areas (gold text has high saturation)
  // Convert to HSV-like space to detect saturation
  const { data: colorData } = await sharp(originalColor)
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // Create saturation mask: preserve areas with high saturation (gold text)
  const maskData = Buffer.alloc(w * h);
  for (let i = 0; i < colorData.length; i += 3) {
    const r = colorData[i];
    const g = colorData[i + 1];
    const b = colorData[i + 2];
    
    // Calculate saturation (simplified)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    
    // Also check if it's in the gold/yellow range (high R, medium G, low B)
    const isGold = r > 180 && g > 140 && b < 100 && saturation > 0.3;
    
    // Preserve if high saturation OR gold-colored
    maskData[i / 3] = (saturation > 0.4 || isGold) ? 255 : 0;
  }
  
  const colorMask = await sharp(maskData, {
    raw: { width: w, height: h, channels: 1 }
  })
    .extend({ channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 4. Grayscale + contrast crush (for non-gold areas)
  const grayBase = await sharp(SRC)
    .removeAlpha()
    .grayscale()
    .linear(1.8, -60)
    .toBuffer();

  // 3. Edge detection
  const edges = await sharp(grayBase)
    .convolve({
      width: 3, height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      scale: 1, offset: 0
    })
    .negate()
    .linear(2.0, -90)
    .toBuffer();

  // 4. Crosshatch
  const crosshatch = await sharp(crosshatchSVG(w, h))
    .resize(w, h)
    .png()
    .toBuffer();

  // 5. Noise
  const noise = await sharp(noiseBuffer(w, h, 20),
    { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();

  // 6. Rim light
  const rim = await sharp(rimLightSVG(w, h))
    .resize(w, h)
    .png()
    .toBuffer();

  // 7. Composite all effects on grayscale base
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

  // 8. Apply light effects to original color (for gold text area)
  const styledColor = await sharp(originalColor)
    .composite([
      { input: crosshatch, blend: 'multiply',   top: 0, left: 0, alpha: 0.3 }, // Lighter crosshatch
      { input: noise,      blend: 'soft-light', top: 0, left: 0, alpha: 0.2 }, // Lighter noise
    ])
    .sharpen({ sigma: 0.5 }) // Lighter sharpen
    .toBuffer();

  // 9. Manually blend: use color where mask indicates gold, grayscale elsewhere
  const { data: grayPixels } = await sharp(styledGray).raw().toBuffer({ resolveWithObject: true });
  const { data: colorPixels } = await sharp(styledColor).raw().toBuffer({ resolveWithObject: true });
  
  // Extract mask as grayscale
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
      // High mask = gold area, use color version
      finalPixels[idx] = colorPixels[idx];
      finalPixels[idx + 1] = colorPixels[idx + 1];
      finalPixels[idx + 2] = colorPixels[idx + 2];
    } else {
      // Low mask = non-gold area, use grayscale version
      finalPixels[idx] = grayPixels[idx];
      finalPixels[idx + 1] = grayPixels[idx + 1];
      finalPixels[idx + 2] = grayPixels[idx + 2];
    }
  }
  
  // Convert final pixels to PNG buffer first
  const finalRGB = await sharp(finalPixels, {
    raw: { width: w, height: h, channels: 3 }
  })
    .png()
    .toBuffer();

  // 10. Re-apply original alpha
  await sharp(finalRGB)
    .joinChannel(alphaBuf)
    .png()
    .toFile(OUT_WILD2);

  console.log(`✅ Created: ${OUT_WILD2}`);

  // 9. Copy to WILD.png
  await sharp(OUT_WILD2).toFile(OUT_WILD);
  console.log(`✅ Replaced: ${OUT_WILD}`);

  console.log('\n✅ Done! WILD.png has been replaced with fried WILD2.png');
}

processWILD2().catch(err => { console.error('❌ Error:', err); process.exit(1); });
