/**
 * Optimize GLB models by separating, resizing textures, and recombining.
 * Uses gltf-pipeline for safe GLB handling and sharp for image resizing.
 * 
 * Usage: node scripts/optimize-glb-textures.cjs
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

const MODELS_DIR = path.join(__dirname, '..', 'public', 'assets', '3d');
const TEMP_DIR = path.join(__dirname, '..', 'tmp_glb_optimize');
const TARGET_SIZE = 512;
const JPEG_QUALITY = 80;

async function optimizeGlb(filePath) {
  const name = path.basename(filePath, '.glb');
  const fullName = path.basename(filePath);
  console.log(`\n📦 Processing: ${fullName}`);

  const originalSize = fs.statSync(filePath).size;
  console.log(`  Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);

  // Create temp directory for this model
  const tempDir = path.join(TEMP_DIR, name);
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Step 1: Separate GLB into GLTF + external files
    const gltfPath = path.join(tempDir, `${name}.gltf`);
    execSync(`npx gltf-pipeline -i "${filePath}" -o "${gltfPath}" --separate`, { stdio: 'pipe' });

    // Step 2: Find and resize all image files
    const files = fs.readdirSync(tempDir);
    const imageFiles = files.filter(f => /\.(png|jpg|jpeg)$/i.test(f));
    console.log(`  Found ${imageFiles.length} texture files`);

    let texturesSaved = 0;
    for (const imgFile of imageFiles) {
      const imgPath = path.join(tempDir, imgFile);
      const originalImgSize = fs.statSync(imgPath).size;

      try {
        // Resize to TARGET_SIZE and convert to JPEG
        const outputPath = imgPath.replace(/\.(png|jpg|jpeg)$/i, '.jpg');
        await sharp(imgPath)
          .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover' })
          .jpeg({ quality: JPEG_QUALITY })
          .toFile(outputPath + '.tmp');

        // Replace original with optimized
        if (outputPath !== imgPath) {
          fs.unlinkSync(imgPath); // remove original PNG
        }
        fs.renameSync(outputPath + '.tmp', outputPath);

        const newImgSize = fs.statSync(outputPath).size;
        texturesSaved += originalImgSize - newImgSize;
        console.log(`  ✅ ${imgFile}: ${(originalImgSize/1024).toFixed(0)}KB → ${(newImgSize/1024).toFixed(0)}KB`);

        // Update GLTF JSON to reference new filename and mimeType
        let gltfJson = fs.readFileSync(gltfPath, 'utf8');
        const oldUri = imgFile;
        const newUri = imgFile.replace(/\.(png|jpg|jpeg)$/i, '.jpg');
        if (oldUri !== newUri) {
          gltfJson = gltfJson.split(oldUri).join(newUri);
        }
        // Update mimeType from image/png to image/jpeg
        gltfJson = gltfJson.replace(
          new RegExp(`"mimeType"\\s*:\\s*"image/png"(\\s*,\\s*"uri"\\s*:\\s*"${newUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")`, 'g'),
          `"mimeType": "image/jpeg"$1`
        );
        fs.writeFileSync(gltfPath, gltfJson, 'utf8');
      } catch (e) {
        console.log(`  ⚠️ Failed to process ${imgFile}: ${e.message}`);
      }
    }

    // Step 3: Recombine into GLB
    execSync(`npx gltf-pipeline -i "${gltfPath}" -o "${filePath}"`, { stdio: 'pipe' });

    const newSize = fs.statSync(filePath).size;
    const saved = originalSize - newSize;
    console.log(`  📊 ${(originalSize/1024/1024).toFixed(2)} MB → ${(newSize/1024/1024).toFixed(2)} MB (saved ${(saved/1024/1024).toFixed(2)} MB, ${Math.round(saved/originalSize*100)}%)`);
  } finally {
    // Cleanup temp dir
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  }
}

async function main() {
  // Create temp root
  if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const files = fs.readdirSync(MODELS_DIR)
    .filter(f => f.endsWith('.glb'))
    .map(f => path.join(MODELS_DIR, f));

  console.log(`Found ${files.length} GLB files in ${MODELS_DIR}`);

  for (const file of files) {
    await optimizeGlb(file);
  }

  // Cleanup temp root
  if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true });

  console.log('\n✅ All models optimized!');
  let total = 0;
  for (const file of files) {
    const size = fs.statSync(file).size / 1024 / 1024;
    total += size;
    console.log(`  ${path.basename(file)}: ${size.toFixed(2)} MB`);
  }
  console.log(`  TOTAL: ${total.toFixed(2)} MB`);
}

main().catch(console.error);
