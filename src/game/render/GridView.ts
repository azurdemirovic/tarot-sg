import { Container, Sprite, Graphics, Assets, BlurFilter, Texture } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';
import { Grid, TarotColumn } from '../Types';
import { ReelSpinner } from './ReelSpinner';
import { DEBUG } from '../config/debug';

export class GridView extends Container {
  private cellSize: number = 156; // 120 * 1.3
  private padding: number = 10;
  private sprites: Sprite[][] = [];
  private frameSprite: Sprite | null = null;
  private bgPlaceholder: Graphics | null = null;
  private reelSpinners: ReelSpinner[] = [];
  private isAnimating: boolean = false;
  private gridLines: Graphics | null = null;
  /** Container that holds all reel spinners — offset for centering */
  private reelContainer: Container | null = null;

  constructor(
    private assetLoader: AssetLoader,
    private cols: number = 5,
    private rows: number = 3
  ) {
    super();
    this.sortableChildren = true; // Enable zIndex-based sorting
    this.initializeGrid();
    this.loadBackground();
    this.loadFrame();
  }

  private async loadFrame(): Promise<void> {
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Load and add frame image as background
    try {
      const frameTexture = await Assets.load('/assets/symbols/frame.png');
      this.frameSprite = new Sprite(frameTexture);
      
      // Scale frame to be larger than grid, centered
      const borderX = 83;
      const borderY = 83;
      const scale = 1.01;
      this.frameSprite.width = (totalWidth + borderX * 2) * scale;
      this.frameSprite.height = (totalHeight + borderY * 2) * scale;
      // Center: offset by border + half of the extra from scaling
      const extraW = (totalWidth + borderX * 2) * (scale - 1) / 2;
      const extraH = (totalHeight + borderY * 2) * (scale - 1) / 2;
      this.frameSprite.position.set(-borderX - extraW, -borderY - extraH);
      
      // Add frame on top of everything — high zIndex so overlays stay behind
      this.frameSprite.zIndex = 100;
      this.addChild(this.frameSprite);
      console.log('✅ Frame loaded');
    } catch (error) {
      console.warn('Frame image not found:', error);
    }
  }

  private async loadBackground(): Promise<void> {
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;
    
    try {
      const bgTexture = await Assets.load('/assets/symbols/BACKGROUND.jpg');
      const bgSprite = new Sprite(bgTexture);
      bgSprite.width = totalWidth;
      bgSprite.height = totalHeight;
      this.addChildAt(bgSprite, 0); // behind everything
      // Remove the white placeholder now that real bg is in place
      if (this.bgPlaceholder) {
        this.removeChild(this.bgPlaceholder);
        this.bgPlaceholder.destroy();
        this.bgPlaceholder = null;
      }
      console.log('✅ Background loaded');
    } catch (error) {
      console.warn('Background image not found, using white fallback:', error);
      const bg = new Graphics();
      bg.rect(0, 0, totalWidth, totalHeight);
      bg.fill({ color: 0xffffff, alpha: 1.0 });
      this.addChildAt(bg, 0);
    }
  }

  private initializeGrid(): void {
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;
    
    // Store base dimensions
    this.baseTotalWidth = totalWidth;
    this.baseTotalHeight = totalHeight;

    // Placeholder white bg (replaced once BACKGROUND.jpg loads)
    this.bgPlaceholder = new Graphics();
    this.bgPlaceholder.rect(0, 0, totalWidth, totalHeight);
    this.bgPlaceholder.fill({ color: 0xffffff, alpha: 1.0 });
    this.addChild(this.bgPlaceholder);

    // Grid border: outer border + internal grid lines (BEHIND symbols)
    this.gridLines = new Graphics();
    this.drawGridLines(this.cols, this.rows, this.cellSize, this.padding, totalWidth, totalHeight);
    this.addChild(this.gridLines);

    // Create a container for reel spinners (for centering on resize)
    this.reelContainer = new Container();
    this.addChild(this.reelContainer);

    // Create reel spinners (ON TOP of grid lines)
    for (let col = 0; col < this.cols; col++) {
      const reelSpinner = new ReelSpinner(this.assetLoader, this.cellSize, this.rows, this.padding);
      reelSpinner.position.set(col * (this.cellSize + this.padding), 0);
      this.reelContainer.addChild(reelSpinner);
      this.reelSpinners.push(reelSpinner);
      
      this.sprites[col] = [];
      for (let row = 0; row < this.rows; row++) {
        this.sprites[col][row] = new Sprite();
      }
    }
  }

  /**
   * Draw grid lines (outer border + internal lines) onto this.gridLines.
   */
  private drawGridLines(
    cols: number, rows: number, cellSize: number, padding: number,
    totalWidth: number, totalHeight: number,
    offsetX: number = 0, offsetY: number = 0
  ): void {
    if (!this.gridLines) return;
    this.gridLines.clear();

    // Outer border
    this.gridLines.rect(offsetX, offsetY, totalWidth, totalHeight);
    this.gridLines.stroke({ color: 0xdddddd, width: 2 });

    // Vertical internal lines
    for (let col = 1; col < cols; col++) {
      const x = offsetX + col * (cellSize + padding) - padding / 2;
      this.gridLines.moveTo(x, offsetY);
      this.gridLines.lineTo(x, offsetY + totalHeight);
      this.gridLines.stroke({ color: 0xdddddd, width: 1 });
    }

    // Horizontal internal lines
    for (let row = 1; row < rows; row++) {
      const y = offsetY + row * (cellSize + padding) - padding / 2;
      this.gridLines.moveTo(offsetX, y);
      this.gridLines.lineTo(offsetX + totalWidth, y);
      this.gridLines.stroke({ color: 0xdddddd, width: 1 });
    }

    // Apply blur filter to soften the lines
    this.gridLines.filters = [new BlurFilter({ strength: 1.76 })];
  }

  private pendingStopTimers: ReturnType<typeof setTimeout>[] = [];
  private spinDoneResolve: (() => void) | null = null;
  private onReelLandCallback: ((col: number) => void) | null = null;

  /** Set a callback that fires when each reel lands (col index passed). */
  setOnReelLand(callback: ((col: number) => void) | null): void {
    this.onReelLandCallback = callback;
  }

  async spinToGrid(grid: Grid, tarotColumns: TarotColumn[] = []): Promise<void> {
    this.isAnimating = true;
    
    // Build a map: col → tarotType for quick lookup
    const tarotColMap = new Map(tarotColumns.map(tc => [tc.col, tc.tarotType]));
    
    // Start all reels spinning — tarot columns get cardback IDs
    this.reelSpinners.forEach((reel, col) => {
      const symbolIds = grid[col].map(cell => cell.symbolId);
      const tarotType = tarotColMap.get(col);
      const isTarot = !!tarotType;
      const cardbackId = tarotType ? this.assetLoader.getCardbackId(tarotType) : undefined;
      reel.startSpin(symbolIds, isTarot, cardbackId);
    });
    
    // Wait until ALL reels have fully settled (stopped + bounce done)
    // This promise resolves regardless of natural or hurried stops
    await new Promise<void>((resolve) => {
      this.spinDoneResolve = resolve;
      
      // Schedule natural stops: left-to-right, 200ms apart
      this.scheduleNaturalStops(1000, 200, 0.7);
      
      // Poll: resolve once every reel is fully settled
      const checkAllDone = () => {
        const allSettled = this.reelSpinners.every(reel => !reel.getIsSpinning());
        if (allSettled) {
          this.spinDoneResolve = null;
          resolve();
        } else {
          requestAnimationFrame(checkAllDone);
        }
      };
      // Start checking after first reel could possibly stop
      setTimeout(checkAllDone, 800);
    });
    
    this.isAnimating = false;
  }

  hurryUp(): void {
    // Cancel pending natural stop timers
    this.pendingStopTimers.forEach(t => clearTimeout(t));
    this.pendingStopTimers = [];
    
    // Rapid-fire stop remaining scrolling reels (60ms apart)
    let delay = 0;
    this.reelSpinners.forEach((reel, col) => {
      if (reel.isStillScrolling()) {
        const timer = setTimeout(() => {
          if (reel.isStillScrolling()) {
            reel.requestStop(0, 0.7);
            if (this.onReelLandCallback) {
              this.onReelLandCallback(col);
            }
          }
        }, delay);
        this.pendingStopTimers.push(timer);
        delay += 60;
      }
    });
    // The spinToGrid() poll will detect settlement and resolve naturally
  }
  
  private scheduleNaturalStops(baseDelay: number, stagger: number, intensity: number): void {
    this.pendingStopTimers.forEach(t => clearTimeout(t));
    this.pendingStopTimers = [];
    
    this.reelSpinners.forEach((reel, col) => {
      const delay = baseDelay + col * stagger;
      const timer = setTimeout(() => {
        reel.requestStop(0, intensity);
        if (this.onReelLandCallback) {
          this.onReelLandCallback(col);
        }
      }, delay);
      this.pendingStopTimers.push(timer);
    });
  }
  
  forceReset(): void {
    this.pendingStopTimers.forEach(t => clearTimeout(t));
    this.pendingStopTimers = [];
    this.isAnimating = false;
    this.reelSpinners.forEach(reel => reel.skipToResult());
    if (this.spinDoneResolve) {
      this.spinDoneResolve();
      this.spinDoneResolve = null;
    }
  }

  updateGrid(grid: Grid, tarotColumns: TarotColumn[] = []): void {
    // Only update if not animating (for initial display)
    if (!this.isAnimating) {
      const tarotColSet = new Set(tarotColumns.map(tc => tc.col));
      for (let col = 0; col < grid.length; col++) {
        const symbolIds = grid[col].map(cell => cell.symbolId);
        this.reelSpinners[col].setSymbols(symbolIds, tarotColSet.has(col));
      }
    }
  }

  /**
   * Update specific columns with new symbols (e.g. after tarot feature transform).
   * Used to visually replace Fool columns with WILDs/PREMIUMs.
   */
  updateColumns(grid: Grid, columns: number[]): void {
    for (const col of columns) {
      if (col < grid.length) {
        const symbolIds = grid[col].map(cell => cell.symbolId);
        this.reelSpinners[col].setSymbols(symbolIds, false); // No longer tarot after transform
      }
    }
  }

  /**
   * 3D card-flip animation: cardbacks → tarot faces.
   * Each column flips with a slight stagger for drama.
   */
  async flipTarotColumns(tarotColumns: TarotColumn[]): Promise<void> {
    const stagger = 150; // ms between column flips
    const sorted = [...tarotColumns].sort((a, b) => a.col - b.col);
    const flipPromises: Promise<void>[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const tc = sorted[i];
      const reel = this.reelSpinners[tc.col];
      const tarotSprite = reel.getTarotSprite();
      if (!tarotSprite) continue;

      const tarotTexture = this.assetLoader.getTexture(tc.tarotType);
      if (!tarotTexture) continue;

      // Stagger each flip
      flipPromises.push(
        new Promise<void>(resolve => setTimeout(resolve, i * stagger))
          .then(() => this.flipSprite(tarotSprite, tarotTexture))
      );
    }

    await Promise.all(flipPromises);
  }

  /**
   * Animate a single sprite's "3D flip": scaleX 1→0 (close), swap texture, scaleX 0→1 (open).
   * Slight Y-scale bulge at midpoint to simulate perspective.
   */
  private flipSprite(sprite: Sprite, newTexture: Texture): Promise<void> {
    return new Promise(resolve => {
      const duration = 500; // ms
      const start = performance.now();
      const targetWidth = sprite.width;
      const targetHeight = sprite.height;
      let textureSwapped = false;

      const animate = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);

        if (t <= 0.5) {
          // Phase 1: close (width → ~0)
          const phase = t / 0.5; // 0 → 1
          const ease = 1 - Math.pow(1 - phase, 2); // easeOutQuad
          sprite.width = Math.max(1, targetWidth * (1 - ease));
          // Slight Y bulge for perspective
          sprite.height = targetHeight * (1 + Math.sin(phase * Math.PI) * 0.06);
        } else {
          // Swap texture at midpoint
          if (!textureSwapped) {
            sprite.texture = newTexture;
            textureSwapped = true;
          }
          // Phase 2: open (width 0 → target)
          const phase = (t - 0.5) / 0.5; // 0 → 1
          const ease = 1 - Math.pow(1 - phase, 3); // easeOutCubic
          sprite.width = Math.max(1, targetWidth * ease);
          sprite.height = targetHeight * (1 + Math.sin((1 - phase) * Math.PI) * 0.06);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          sprite.width = targetWidth;
          sprite.height = targetHeight;
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });
  }

  /**
   * Spin specific columns to new symbols with natural drop animation.
   * Used during Lovers multi-spin for the fresh grid each round.
   * @param grid - Full grid data
   * @param columnsToSpin - Which columns to animate (others left unchanged)
   */
  async spinColumnsToGrid(grid: Grid, columnsToSpin?: number[]): Promise<void> {
    const cols = columnsToSpin ?? Array.from({ length: this.cols }, (_, i) => i);

    this.isAnimating = true;

    // Start spinning the specified columns
    for (const col of cols) {
      const symbolIds = grid[col].map(cell => cell.symbolId);
      this.reelSpinners[col].startSpin(symbolIds, false);
    }

    // Wait for all to settle (same pattern as spinToGrid)
    await new Promise<void>((resolve) => {
      // Schedule natural stops with stagger
      const baseDelay = 600;  // shorter than main spin for snappier feel
      const stagger = 150;
      const timers: ReturnType<typeof setTimeout>[] = [];

      cols.forEach((col, i) => {
        const delay = baseDelay + i * stagger;
        const timer = setTimeout(() => {
          this.reelSpinners[col].requestStop(0, 0.7);
        }, delay);
        timers.push(timer);
      });

      // Poll until all are done
      const checkAllDone = () => {
        const allSettled = cols.every(col => !this.reelSpinners[col].getIsSpinning());
        if (allSettled) {
          resolve();
        } else {
          requestAnimationFrame(checkAllDone);
        }
      };
      setTimeout(checkAllDone, baseDelay);
    });

    this.isAnimating = false;
  }

  update(delta: number): void {
    if (this.isAnimating) {
      this.reelSpinners.forEach(reel => reel.update(delta));
    }
  }

  getIsAnimating(): boolean {
    return this.isAnimating;
  }

  showPlaceholder(): void {
    if (DEBUG.showTarotsOnStart) {
      // Debug mode: show all 5 tarots as full-column stacks
      const tarotIds = ['T_FOOL', 'T_CUPS', 'T_LOVERS', 'T_PRIESTESS', 'T_DEATH'];
      for (let col = 0; col < this.cols; col++) {
        const tarotId = tarotIds[col % tarotIds.length];
        const symbolIds = [tarotId, tarotId, tarotId]; // same tarot fills all 3 rows
        this.reelSpinners[col].setSymbols(symbolIds, true); // isTarotColumn = true
      }
      console.log('🃏 DEBUG: Showing all 5 tarots on initial screen');
      return;
    }

    const placeholders = ['COIN', 'CUP', 'KEY', 'SWORD', 'RING', 'FLEUR'];
    
    for (let col = 0; col < this.cols; col++) {
      const symbolIds = [];
      for (let row = 0; row < this.rows; row++) {
        symbolIds.push(placeholders[Math.floor(Math.random() * placeholders.length)]);
      }
      this.reelSpinners[col].setSymbols(symbolIds);
    }
  }

  /** Returns true if any reel is still actively scrolling (not just bouncing) */
  hasScrollingReels(): boolean {
    return this.reelSpinners.some(reel => reel.isStillScrolling());
  }

  // ── Accessors for FoolRevealAnimation ──
  getReelSpinners(): ReelSpinner[] { return this.reelSpinners; }
  getCellSize(): number { return this.cellSize; }
  getPadding(): number { return this.padding; }
  getCols(): number { return this.cols; }
  getRows(): number { return this.rows; }

  /**
   * Get the grid's center position in screen (CSS pixel) coordinates.
   * The pixi logical resolution is 1040×720 (from app.init). We map from
   * pixi world coords to screen CSS coords via the canvas bounding rect.
   */
  getGridScreenCenter(canvas: HTMLCanvasElement): { x: number; y: number } {
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Grid center in pixi world coords
    const worldPos = this.getGlobalPosition();
    const gridCenterX = worldPos.x + totalWidth / 2;
    const gridCenterY = worldPos.y + totalHeight / 2;

    // Pixi logical resolution (the values passed to app.init)
    const logicalW = 1040;
    const logicalH = 720;

    // Canvas CSS rect on screen
    const canvasRect = canvas.getBoundingClientRect();

    // Map pixi logical coords to CSS screen coords
    const scaleX = canvasRect.width / logicalW;
    const scaleY = canvasRect.height / logicalH;

    return {
      x: canvasRect.left + gridCenterX * scaleX,
      y: canvasRect.top + gridCenterY * scaleY,
    };
  }
  /** Get the centering offset of the reel container (0,0 at base size) */
  getReelContainerOffset(): { x: number; y: number } {
    return {
      x: this.reelContainer ? this.reelContainer.x : 0,
      y: this.reelContainer ? this.reelContainer.y : 0,
    };
  }

  /** Total pixel width of the base grid (fixed, doesn't change on resize) */
  private baseTotalWidth: number = 0;
  /** Total pixel height of the base grid (fixed, doesn't change on resize) */
  private baseTotalHeight: number = 0;

  /**
   * Resize the grid to fit `newCols × newRows` within the same pixel area.
   * Shrinks cell sizes and repositions/creates/removes reel spinners as needed.
   * Centers the smaller grid within the base area and redraws grid lines.
   * Called by Death feature when the grid expands.
   */
  resizeGrid(newCols: number, newRows: number): void {
    // Calculate new cell size and padding to fit within the same base area
    // Keep padding proportional: padding = cellSize * (10/156) ≈ 6.4%
    const paddingRatio = 10 / 156;
    // totalWidth = newCols * cellSize + (newCols - 1) * cellSize * paddingRatio
    // totalWidth = cellSize * (newCols + (newCols - 1) * paddingRatio)
    const cellSizeFromWidth = this.baseTotalWidth / (newCols + (newCols - 1) * paddingRatio);
    const cellSizeFromHeight = this.baseTotalHeight / (newRows + (newRows - 1) * paddingRatio);
    const newCellSize = Math.floor(Math.min(cellSizeFromWidth, cellSizeFromHeight));
    const newPadding = Math.max(2, Math.floor(newCellSize * paddingRatio));

    this.cellSize = newCellSize;
    this.padding = newPadding;

    // Compute actual grid dimensions and centering offsets
    const actualWidth = newCols * (newCellSize + newPadding) - newPadding;
    const actualHeight = newRows * (newCellSize + newPadding) - newPadding;
    const offsetX = Math.floor((this.baseTotalWidth - actualWidth) / 2);
    const offsetY = Math.floor((this.baseTotalHeight - actualHeight) / 2);

    // Remove extra reel spinners if shrinking
    while (this.reelSpinners.length > newCols) {
      const reel = this.reelSpinners.pop()!;
      if (this.reelContainer) {
        this.reelContainer.removeChild(reel);
      }
      reel.destroy({ children: true });
    }

    // Resize existing reel spinners and reposition within container
    for (let col = 0; col < this.reelSpinners.length; col++) {
      this.reelSpinners[col].resizeCells(newCellSize, newRows, newPadding);
      this.reelSpinners[col].position.set(col * (newCellSize + newPadding), 0);
    }

    // Add new reel spinners if expanding
    while (this.reelSpinners.length < newCols) {
      const col = this.reelSpinners.length;
      const reelSpinner = new ReelSpinner(this.assetLoader, newCellSize, newRows, newPadding);
      reelSpinner.position.set(col * (newCellSize + newPadding), 0);
      if (this.reelContainer) {
        this.reelContainer.addChild(reelSpinner);
      } else {
        this.addChild(reelSpinner);
      }
      this.reelSpinners.push(reelSpinner);

      this.sprites[col] = [];
      for (let row = 0; row < newRows; row++) {
        this.sprites[col][row] = new Sprite();
      }
    }

    // Center the reel container within the base area
    if (this.reelContainer) {
      this.reelContainer.position.set(offsetX, offsetY);
    }

    // Redraw grid lines to match new cell sizes and positions
    this.drawGridLines(newCols, newRows, newCellSize, newPadding, actualWidth, actualHeight, offsetX, offsetY);

    this.cols = newCols;
    this.rows = newRows;

    console.log(`🔄 Grid resized to ${newCols}×${newRows}, cellSize=${newCellSize}, padding=${newPadding}, offset=(${offsetX},${offsetY})`);
  }

  /**
   * Restore grid to the default 5×3 layout.
   * Called when Death feature ends.
   */
  restoreDefaultGrid(): void {
    // Use exact original values
    const origCellSize = 156;
    const origPadding = 10;
    const origCols = 5;
    const origRows = 3;

    this.cellSize = origCellSize;
    this.padding = origPadding;

    // Remove extra reel spinners if we have more than 5
    while (this.reelSpinners.length > origCols) {
      const reel = this.reelSpinners.pop()!;
      if (this.reelContainer) {
        this.reelContainer.removeChild(reel);
      }
      reel.destroy({ children: true });
    }

    // Resize and reposition existing spinners
    for (let col = 0; col < this.reelSpinners.length; col++) {
      this.reelSpinners[col].resizeCells(origCellSize, origRows, origPadding);
      this.reelSpinners[col].position.set(col * (origCellSize + origPadding), 0);
    }

    // Reset reel container to origin (no centering offset)
    if (this.reelContainer) {
      this.reelContainer.position.set(0, 0);
    }

    // Redraw grid lines at original dimensions
    const totalWidth = origCols * (origCellSize + origPadding) - origPadding;
    const totalHeight = origRows * (origCellSize + origPadding) - origPadding;
    this.drawGridLines(origCols, origRows, origCellSize, origPadding, totalWidth, totalHeight, 0, 0);

    this.cols = origCols;
    this.rows = origRows;

    console.log('🔄 Grid restored to default 5×3');
  }

  /**
   * Clear all sprites
   */
  clear(): void {
    for (let col = 0; col < this.cols; col++) {
      for (let row = 0; row < this.rows; row++) {
        this.sprites[col][row].visible = false;
      }
    }
  }
}
