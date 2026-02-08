/**
 * Add "WILD" text centered on bottom border of WILD.PNG
 * Uses the project's custom font (font.TTF)
 * 
 * Creates WILD_TEXT.png in symbols folder for preview
 * 
 * Note: Sharp doesn't support custom fonts directly, so we use canvas
 * but canvas on Windows may have issues. If font doesn't load, it will use fallback.
 */
const sharp = require('sharp');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'symbols', 'WILD.png');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'symbols', 'WILD_TEXT.png');
const FONT_PATH = path.resolve(__dirname, '..', 'public', 'fonts', 'font.TTF');

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Add WILD Text to WILD.PNG          ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Register custom font BEFORE creating canvas
  // Use absolute path and register with a simple name
  const FONT_FAMILY = 'ProjectFont';
  if (fs.existsSync(FONT_PATH)) {
    try {
      const absPath = path.resolve(FONT_PATH);
      registerFont(absPath, { family: FONT_FAMILY });
      console.log(`✓ Registered font as: ${FONT_FAMILY}`);
      console.log(`  Font path: ${absPath}`);
    } catch (err) {
      console.warn(`⚠ Failed to register font: ${err.message}`);
      console.warn(`   Will use system fallback`);
    }
  } else {
    console.warn(`⚠ Font not found: ${FONT_PATH}, using Arial fallback`);
  }

  const meta = await sharp(SRC).metadata();
  const w = meta.width;
  const h = meta.height;
  console.log(`Source: ${SRC} (${w}×${h})\n`);

  // Create canvas for text rendering
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Load the WILD image
  const wildImage = await loadImage(SRC);
  ctx.drawImage(wildImage, 0, 0);

  // Draw "WILD" text at bottom center
  const fontSize = 48;
  const textY = h - 20; // 20px from bottom
  const textX = w / 2; // Center horizontally

  // Use the registered font family name (not the internal font name)
  ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
  console.log(`Using font: ${FONT_FAMILY}`);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  // Test if font loaded by checking metrics
  const metrics = ctx.measureText('WILD');
  console.log(`Font metrics: width=${metrics.width.toFixed(1)}`);
  console.log(`Applied font: ${ctx.font}`);

  // Disable shadow for stroke (we'll draw it manually)
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  
  // Draw text with multiple strokes for bold outline effect
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  
  // Draw multiple strokes for thicker outline
  for (let i = 0; i < 3; i++) {
    ctx.strokeText('WILD', textX, textY);
  }

  // Draw text fill (gold)
  ctx.fillStyle = '#FFD700';
  ctx.fillText('WILD', textX, textY);
  
  // Add subtle shadow effect by drawing slightly offset
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000000';
  ctx.fillText('WILD', textX + 2, textY + 2);
  ctx.globalAlpha = 1.0;

  // Convert canvas to buffer
  const textBuffer = canvas.toBuffer('image/png');

  // Save the result
  await sharp(textBuffer)
    .png()
    .toFile(OUT);

  console.log(`✅ Created: ${OUT}`);
  console.log(`   Text "WILD" added at bottom center`);
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
