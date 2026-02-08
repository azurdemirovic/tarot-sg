import { Container, Sprite, Graphics, Assets, BlurFilter } from 'pixi.js';
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

  constructor(
    private assetLoader: AssetLoader,
    private cols: number = 5,
    private rows: number = 3
  ) {
    super();
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
      
      // Add frame on top of everything
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
    
    // Placeholder white bg (replaced once BACKGROUND.jpg loads)
    this.bgPlaceholder = new Graphics();
    this.bgPlaceholder.rect(0, 0, totalWidth, totalHeight);
    this.bgPlaceholder.fill({ color: 0xffffff, alpha: 1.0 });
    this.addChild(this.bgPlaceholder);

    // Grid border: outer border + internal grid lines (BEHIND symbols)
    const gridLines = new Graphics();
    // Outer border
    gridLines.rect(0, 0, totalWidth, totalHeight);
    gridLines.stroke({ color: 0xdddddd, width: 2 });
    // Vertical internal lines
    for (let col = 1; col < this.cols; col++) {
      const x = col * (this.cellSize + this.padding) - this.padding / 2;
      gridLines.moveTo(x, 0);
      gridLines.lineTo(x, totalHeight);
      gridLines.stroke({ color: 0xdddddd, width: 1 });
    }
    // Horizontal internal lines
    for (let row = 1; row < this.rows; row++) {
      const y = row * (this.cellSize + this.padding) - this.padding / 2;
      gridLines.moveTo(0, y);
      gridLines.lineTo(totalWidth, y);
      gridLines.stroke({ color: 0xdddddd, width: 1 });
    }
    // Apply blur filter to soften the lines
    gridLines.filters = [new BlurFilter({ strength: 1.76 })];
    this.addChild(gridLines);

    // Create reel spinners (ON TOP of grid lines)
    for (let col = 0; col < this.cols; col++) {
      const reelSpinner = new ReelSpinner(this.assetLoader, this.cellSize, this.rows, this.padding);
      reelSpinner.position.set(col * (this.cellSize + this.padding), 0);
      this.addChild(reelSpinner);
      this.reelSpinners.push(reelSpinner);
      
      this.sprites[col] = [];
      for (let row = 0; row < this.rows; row++) {
        this.sprites[col][row] = new Sprite();
      }
    }
  }

  private pendingStopTimers: ReturnType<typeof setTimeout>[] = [];
  private spinDoneResolve: (() => void) | null = null;

  async spinToGrid(grid: Grid, tarotColumns: TarotColumn[] = []): Promise<void> {
    this.isAnimating = true;
    
    // Determine which columns are tarot
    const tarotColSet = new Set(tarotColumns.map(tc => tc.col));
    
    // Start all reels spinning
    this.reelSpinners.forEach((reel, col) => {
      const symbolIds = grid[col].map(cell => cell.symbolId);
      reel.startSpin(symbolIds, tarotColSet.has(col));
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
    this.reelSpinners.forEach((reel) => {
      if (reel.isStillScrolling()) {
        const timer = setTimeout(() => {
          if (reel.isStillScrolling()) {
            reel.requestStop(0, 0.7);
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
