/**
 * Fry cardback.jpg and create 5 tarot-hued variants.
 *
 * Pipeline: fry the base → tint in each tarot's thematic color.
 *
 * Colors chosen by tarot suit associations:
 *   FOOL       → Gold/Amber    (fortune, chaos)
 *   CUPS       → Deep Blue     (water element)
 *   LOVERS     → Crimson Red   (passion, love)
 *   PRIESTESS  → Royal Purple  (mystery, divination)
 *   DEATH      → Dark Emerald  (transformation, nature)
 *
 * Source:  public/assets/symbols_original/cardback.jpg
 * Output:  public/assets/tarots/CARDBACK_FOOL.jpg … CARDBACK_DEATH.jpg
 */
const sharp = require('sharp');
const path  = require('path');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'symbols_original', 'cardback.jpg');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'tarots');

const VARIANTS = [
  { id: 'FOOL',      r: 200, g: 160, b: 40  },
  { id: 'CUPS',      r: 40,  g: 110, b: 190 },
  { id: 'LOVERS',    r: 185, g: 40,  b: 55  },
  { id: 'PRIESTESS', r: 120, g: 50,  b: 180 },
  { id: 'DEATH',     r: 40,  g: 130, b: 70  },
];

/* ── Texture generators (same as tarot styler) ── */

function crosshatchSVG(w, h) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="white"/>
    <defs>
      <pattern id="h1" width="8" height="8" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0,0,0,0.14)" stroke-width="0.6"/>
      </pattern>
      <pattern id="h2" width="8" height="8" patternTransform="rotate(-35)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(0,0,0,0.14)" stroke-width="0.6"/>
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
        <stop offset="0%"   stop-color="white" stop-opacity="0.12"/>
        <stop offset="60%"  stop-color="white" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.18"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#rim)"/>
  </svg>`);
}

/**
 * Create a black border with ink bleed effect.
 * Uses extend to add border, then applies a subtle darkening mask at edges.
 */
function createBorderMask(w, h, borderWidth = 6, bleedWidth = 10) {
  // Create a mask that's transparent in center, black at edges with gradient
  const mask = Buffer.alloc(w * h * 4);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      
      // Calculate distance from edges
      const distTop = y;
      const distBottom = h - 1 - y;
      const distLeft = x;
      const distRight = w - 1 - x;
      const minDist = Math.min(distTop, distBottom, distLeft, distRight);
      
      // Create gradient: full black at edge, fading to transparent
      let alpha = 0;
      if (minDist < borderWidth) {
        alpha = 1; // Solid black border
      } else if (minDist < bleedWidth) {
        // Ink bleed: fade from borderWidth to bleedWidth
        alpha = 1 - (minDist - borderWidth) / (bleedWidth - borderWidth);
        alpha = Math.pow(alpha, 1.5); // Slight curve for smoother fade
      }
      
      mask[idx] = 0;     // R
      mask[idx + 1] = 0; // G
      mask[idx + 2] = 0; // B
      mask[idx + 3] = Math.floor(alpha * 255); // A
    }
  }
  
  return mask;
}

/* ── Main ── */

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Cardback Fry + Hue Variants        ║');
  console.log('╚══════════════════════════════════════╝\n');

  const meta = await sharp(SRC).metadata();
  const w = meta.width;
  const h = meta.height;
  console.log(`Source: ${SRC} (${w}×${h})\n`);

  // 1. Fry the base: grayscale + contrast + edges + crosshatch + grain + rim + sharpen
  const grayBase = await sharp(SRC)
    .grayscale()
    .linear(1.6, -50)   // contrast crush
    .toBuffer();

  // Edge detection
  const edges = await sharp(grayBase)
    .convolve({
      width: 3, height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
      scale: 1, offset: 0
    })
    .negate()
    .linear(1.8, -80)
    .removeAlpha()
    .toColourspace('srgb')
    .toBuffer();

  // Crosshatch
  const crosshatch = await sharp(crosshatchSVG(w, h))
    .resize(w, h)
    .removeAlpha()
    .toColourspace('srgb')
    .png()
    .toBuffer();

  // Noise
  const noise = await sharp(noiseBuffer(w, h, 20),
    { raw: { width: w, height: h, channels: 4 } })
    .removeAlpha()
    .toColourspace('srgb')
    .png()
    .toBuffer();

  // Rim light
  const rim = await sharp(rimLightSVG(w, h))
    .resize(w, h)
    .removeAlpha()
    .toColourspace('srgb')
    .png()
    .toBuffer();

  // Ensure base is 3ch
  const base3 = await sharp(grayBase)
    .removeAlpha()
    .toColourspace('srgb')
    .toBuffer();

  // Composite all effects
  const friedBase = await sharp(base3)
    .composite([
      { input: edges,      blend: 'multiply',   top: 0, left: 0 },
      { input: crosshatch, blend: 'multiply',   top: 0, left: 0 },
      { input: noise,      blend: 'soft-light', top: 0, left: 0 },
      { input: rim,        blend: 'overlay',     top: 0, left: 0 },
    ])
    .sharpen({ sigma: 0.8 })
    .toBuffer();

  console.log('  ✓ Base fried\n');

  // Create border mask (once, reused for all variants)
  const borderWidth = 6;
  const bleedWidth = 10;
  const borderMaskBuffer = createBorderMask(w, h, borderWidth, bleedWidth);
  const borderMask = await sharp(borderMaskBuffer, {
    raw: { width: w, height: h, channels: 4 }
  })
    .blur(0.8)  // Soft blur for ink bleed effect
    .png()
    .toBuffer();

  // 2. Create each color variant
  for (const v of VARIANTS) {
    const outPath = path.join(OUT, `CARDBACK_${v.id}.jpg`);
    
    // Tint the fried base
    const tinted = await sharp(friedBase)
      .tint({ r: v.r, g: v.g, b: v.b })
      .toBuffer();
    
    // Composite the border mask (black border with ink bleed) using 'darken' blend
    // This will only darken pixels where the mask has black, leaving center untouched
    await sharp(tinted)
      .composite([
        { input: borderMask, blend: 'darken', top: 0, left: 0 }
      ])
      .jpeg({ quality: 92 })
      .toFile(outPath);
    
    console.log(`  ✓ CARDBACK_${v.id}.jpg  — tint rgb(${v.r},${v.g},${v.b}) + black border`);
  }

  console.log('\n✅ Done! 5 cardback variants saved to tarots/');
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
