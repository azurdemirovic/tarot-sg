import { ThreeBackground } from '../../threeBackground';
import { TearScreenRect } from './TarotTearEffect';
import { ReelSpinner } from './ReelSpinner';

/**
 * Helper to compute screen-space rects for tarot columns and trigger tear effects.
 * Bridges the PixiJS grid world with the Three.js tear effect.
 */

/** PixiJS grid offset on screen (set in main.ts: gridView.position.set(105, 105)) */
const GRID_OFFSET_X = 105;
const GRID_OFFSET_Y = 105;

/**
 * Calculate the screen-space rectangle for a tarot column.
 * The tarot card spans the full column height (all rows).
 */
export function getTarotColumnScreenRect(
  col: number,
  cellSize: number,
  padding: number,
  rows: number,
  pixiCanvas: HTMLCanvasElement
): TearScreenRect {
  const step = cellSize + padding;
  const totalHeight = rows * cellSize + (rows - 1) * padding;

  // PixiJS local coordinates (relative to grid)
  // Tarot card bleeds into padding gaps (see ReelSpinner: sprite.width = cellSize + padding)
  const localX = col * step - padding / 2;
  const localY = 0;
  const localW = cellSize + padding;
  const localH = totalHeight;

  // Get the PixiJS canvas bounding rect to account for CSS positioning
  const canvasRect = pixiCanvas.getBoundingClientRect();

  // Scale factor: PixiJS canvas may be CSS-scaled
  const scaleX = canvasRect.width / pixiCanvas.width;
  const scaleY = canvasRect.height / pixiCanvas.height;

  // Convert to screen-space
  const screenX = canvasRect.left + (GRID_OFFSET_X + localX) * scaleX;
  const screenY = canvasRect.top + (GRID_OFFSET_Y + localY) * scaleY;
  const screenW = localW * scaleX;
  const screenH = localH * scaleY;

  return {
    x: screenX,
    y: screenY,
    width: screenW,
    height: screenH,
  };
}

/**
 * Get the image path for a tarot type.
 * Maps tarot type IDs to their face image paths.
 */
export function getTarotImagePath(tarotType: string): string {
  // After the flip animation, the tarot face is shown.
  // The face textures are in /assets/tarots/
  return `/assets/tarots/${tarotType}.jpg`;
}

/**
 * Play tear effects for the given tarot columns.
 * Sets the final symbols underneath BEFORE starting the tear, so the rip
 * reveals the symbols naturally as it progresses.
 *
 * @param threeBg - ThreeBackground instance (or null if 3D bg is disabled)
 * @param columns - Array of column indices that have tarot cards
 * @param tarotType - The tarot type ID (e.g. 'T_FOOL')
 * @param reelSpinners - Array of ReelSpinner instances
 * @param cellSize - Cell size in pixels
 * @param padding - Padding between cells
 * @param rows - Number of rows
 * @param pixiCanvas - The PixiJS canvas element
 * @param finalSymbolIds - Optional: per-column symbol IDs to set underneath before tearing.
 *                         Map of col index → string[] of symbol IDs for that column.
 *                         If provided, symbols are placed underneath before the tear starts.
 * @param stagger - Delay between column tears in ms (default 150)
 */
export async function playTarotTearEffects(
  threeBg: ThreeBackground | null,
  columns: number[],
  tarotType: string,
  reelSpinners: ReelSpinner[],
  cellSize: number,
  padding: number,
  rows: number,
  pixiCanvas: HTMLCanvasElement,
  finalSymbolIds?: Map<number, string[]>,
  stagger: number = 150
): Promise<void> {
  if (!threeBg) {
    // No 3D background — just swap symbols instantly (fallback)
    for (const col of columns) {
      if (finalSymbolIds?.has(col)) {
        reelSpinners[col].setSymbols(finalSymbolIds.get(col)!, false);
      } else {
        reelSpinners[col].setColumnVisible(false);
      }
    }
    return;
  }

  const imagePath = getTarotImagePath(tarotType);
  const sortedCols = [...columns].sort((a, b) => a - b);

  // Build tear column descriptors
  const tearColumns = sortedCols.map(col => ({
    imagePath,
    screenRect: getTarotColumnScreenRect(col, cellSize, padding, rows, pixiCanvas),
  }));

  // Compute grid screen rect for clipping the tear overlay to the grid area.
  // Inset slightly so the tear stays inside the frame border on all sides.
  const canvasRect = pixiCanvas.getBoundingClientRect();
  const scaleX = canvasRect.width / pixiCanvas.width;
  const scaleY = canvasRect.height / pixiCanvas.height;
  const cols = 5; // grid columns
  const step = cellSize + padding;
  const gridW = cols * cellSize + (cols - 1) * padding;
  const gridH = rows * cellSize + (rows - 1) * padding;
  const inset = 6 * scaleY; // small inset to stay inside the frame
  const topInset = 20 * scaleY; // larger top inset — card spawns slightly above
  const gridScreenRect = {
    x: canvasRect.left + GRID_OFFSET_X * scaleX + inset,
    y: canvasRect.top + GRID_OFFSET_Y * scaleY + topInset,
    width: gridW * scaleX - inset * 2,
    height: gridH * scaleY - topInset - inset,
  };

  // The onReady callback swaps the PixiJS symbols ONLY after the Three.js
  // tear textures are loaded, preventing the visible blink between Pixi and Three.js.
  const onReady = () => {
    if (finalSymbolIds) {
      for (const col of sortedCols) {
        if (finalSymbolIds.has(col)) {
          reelSpinners[col].setSymbols(finalSymbolIds.get(col)!, false);
          reelSpinners[col].setColumnVisible(true);
        }
      }
    } else {
      for (const col of sortedCols) {
        reelSpinners[col].setColumnVisible(false);
      }
    }
  };

  // Play tear sound when the tear animation starts
  try {
    const tearCtx = new AudioContext();
    const resp = await fetch('/assets/sound/tear-tarot.wav');
    const buf = await tearCtx.decodeAudioData(await resp.arrayBuffer());
    const src = tearCtx.createBufferSource();
    src.buffer = buf;
    const gain = tearCtx.createGain();
    gain.gain.value = 2.5;
    src.connect(gain);
    gain.connect(tearCtx.destination);
    src.start(0);
    src.onended = () => tearCtx.close();
  } catch (e) { console.warn('🔊 Tear sound failed:', e); }

  // Play tear effects with stagger, clipped to grid area
  await threeBg.playTearEffects(tearColumns, stagger, gridScreenRect, onReady);
}
