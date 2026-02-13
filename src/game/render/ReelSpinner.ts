import { Container, Sprite, Graphics } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';

export class ReelSpinner extends Container {
  private strip: Sprite[] = [];
  private symbolContainer: Container;
  private isSpinning: boolean = false;
  private scrollOffset: number = 0;
  private targetOffset: number = 0;
  private velocity: number = 60; // Fast!
  private cellSize: number;
  private rows: number;
  private finalSymbols: string[] = [];
  private isTarotColumn: boolean = false;
  private cardbackId: string | null = null;       // cardback texture ID shown during spin
  private actualTarotId: string | null = null;     // real tarot texture ID for flip reveal
  
  // Bounce state
  private bouncing: boolean = false;
  private bounceOffset: number = 0;
  private bounceVelocity: number = 0;
  private bounceTime: number = 0;

  // Landing sound — shared across all reel spinners
  private static landAudioContext: AudioContext | null = null;
  private static landAudioBuffer: AudioBuffer | null = null;
  private static landSoundLoaded: boolean = false;

  static async loadLandSound(): Promise<void> {
    if (ReelSpinner.landSoundLoaded) return;
    try {
      ReelSpinner.landAudioContext = new AudioContext();
      const response = await fetch('/assets/sound/land-normal.wav');
      const arrayBuffer = await response.arrayBuffer();
      ReelSpinner.landAudioBuffer = await ReelSpinner.landAudioContext.decodeAudioData(arrayBuffer);
      ReelSpinner.landSoundLoaded = true;
      console.log('🔊 Reel land sound loaded');
    } catch (e) {
      console.warn('🔊 Could not load land sound:', e);
    }
  }

  private playLandSound(): void {
    if (!ReelSpinner.landAudioContext || !ReelSpinner.landAudioBuffer) return;
    // Resume context if suspended (browser autoplay policy)
    if (ReelSpinner.landAudioContext.state === 'suspended') {
      ReelSpinner.landAudioContext.resume();
    }
    const source = ReelSpinner.landAudioContext.createBufferSource();
    source.buffer = ReelSpinner.landAudioBuffer;
    const gain = ReelSpinner.landAudioContext.createGain();
    gain.gain.value = 1.0;
    source.connect(gain);
    gain.connect(ReelSpinner.landAudioContext.destination);
    source.start(0);
  }

  private padding: number;
  private step: number; // cellSize + padding
  private maskGraphic: Graphics;
  private maskHeight: number;

  constructor(
    private assetLoader: AssetLoader,
    cellSize: number,
    rows: number = 3,
    padding: number = 0
  ) {
    super();
    this.cellSize = cellSize;
    this.rows = rows;
    this.padding = padding;
    this.step = cellSize + padding;
    
    this.symbolContainer = new Container();
    this.addChild(this.symbolContainer);
    
    // Mask covers the full grid height including padding between rows
    this.maskHeight = rows * cellSize + (rows - 1) * padding;
    this.maskGraphic = new Graphics();
    this.maskGraphic.rect(0, 0, cellSize, this.maskHeight);
    this.maskGraphic.fill({ color: 0xffffff });
    this.addChild(this.maskGraphic);
    this.symbolContainer.mask = this.maskGraphic;
  }

  private updateMask(): void {
    this.maskGraphic.clear();
    if (this.isTarotColumn) {
      // Extend mask into padding gaps on both sides so tarot bleeds edge-to-edge
      this.maskGraphic.rect(-this.padding / 2, 0, this.cellSize + this.padding, this.maskHeight);
    } else {
      this.maskGraphic.rect(0, 0, this.cellSize, this.maskHeight);
    }
    this.maskGraphic.fill({ color: 0xffffff });
  }

  startSpin(finalSymbols: string[], isTarotColumn: boolean = false, cardbackId?: string): void {
    this.finalSymbols = finalSymbols;
    this.isTarotColumn = isTarotColumn;
    this.cardbackId = cardbackId || null;
    this.actualTarotId = isTarotColumn ? finalSymbols[0] : null;
    this.updateMask();
    this.isSpinning = true;
    this.bouncing = false;
    this.velocity = 60; // Fast constant speed
    
    // Build strip: final symbols FIRST, then filler AFTER
    // This way scrollOffset goes from negative (showing filler) to 0 (showing final)
    // Use enough filler so we never need to loop (avoids visual glitch)
    const fillerCount = 50;
    const fillerSymbols: string[] = [];
    
    const normalSymbols = this.assetLoader.getNormalSymbols();
    const premiumSymbols = this.assetLoader.getSymbolsByTier('PREMIUM')
      .filter(s => s.id !== 'MALE' && s.id !== 'FEMALE');
    
    for (let i = 0; i < fillerCount; i++) {
      if (Math.random() < 0.3) {
        const premium = premiumSymbols[Math.floor(Math.random() * premiumSymbols.length)];
        fillerSymbols.push(premium.id);
      } else {
        const random = normalSymbols[Math.floor(Math.random() * normalSymbols.length)];
        fillerSymbols.push(random.id);
      }
    }
    
    // If tarot column with cardback, use cardback ID for the tall display sprite
    const displaySymbols = [...finalSymbols];
    if (isTarotColumn && cardbackId) {
      displaySymbols[0] = cardbackId; // Show cardback instead of tarot face
    }
    
    // Strip = [display0, display1, display2, filler0, ..., filler49]
    const stripSymbols = [...displaySymbols, ...fillerSymbols];
    
    this.rebuildStrip(stripSymbols);
    this.scrollOffset = -fillerCount * this.step; // Start showing filler
    this.targetOffset = 0; // End showing final symbols
    
    this.updateStripPositions();
  }

  requestStop(delay: number = 0, intensity: number = 0.8): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Instant stop + bounce
        this.scrollOffset = this.targetOffset;
        this.isSpinning = false;
        this.playLandSound();
        this.startBounce(intensity);
        
        // Wait for bounce to finish
        const checkBounce = () => {
          if (!this.bouncing) {
            resolve();
          } else {
            requestAnimationFrame(checkBounce);
          }
        };
        checkBounce();
      }, delay);
    });
  }

  skipToResult(): void {
    // Fast-forward to target position without bounce
    if (this.isSpinning) {
      console.log('⚡ ReelSpinner: Snapping to result position');
      this.scrollOffset = this.targetOffset;
      this.isSpinning = false;
      this.bouncing = false;
      this.updateStripPositions();
    }
  }
  
  triggerBounce(intensity: number = 1.0): void {
    if (!this.bouncing) {
      console.log('🎪 ReelSpinner: Starting bounce with intensity', intensity);
      this.startBounce(intensity);
    }
  }

  private startBounce(intensity: number = 1.0): void {
    this.bouncing = true;
    this.bounceOffset = 0;
    this.bounceVelocity = 8 * intensity; // Overshoot downward
    this.bounceTime = 0;
  }

  update(delta: number): void {
    if (this.isSpinning) {
      // Scroll downward: scrollOffset increases from negative toward 0
      this.scrollOffset += this.velocity * delta;
      
      this.updateStripPositions();
    } 
    else if (this.bouncing) {
      // Bounce physics: overshoot down, spring back up
      this.bounceTime += delta;
      this.bounceVelocity -= 1.2 * delta; // Spring pull back up
      this.bounceOffset += this.bounceVelocity * delta;
      
      // Settle
      if (Math.abs(this.bounceOffset) < 1 && Math.abs(this.bounceVelocity) < 1 && this.bounceTime > 10) {
        this.bounceOffset = 0;
        this.bouncing = false;
      }
      
      // Clamp: don't go above rest position
      if (this.bounceOffset < 0) {
        this.bounceOffset = 0;
        this.bounceVelocity *= -0.5; // Damping
      }
      
      this.updateStripPositions();
    }
  }

  private updateStripPositions(): void {
    this.strip.forEach((sprite, index) => {
      // Downward scroll: use step (cellSize + padding) for proper grid alignment
      sprite.y = (index * this.step + this.scrollOffset + this.bounceOffset) + this.cellSize / 2;
    });
    
    // For tarot columns: center the tall sprite across all 3 cell positions
    if (this.isTarotColumn && this.strip.length > 0) {
      // Normal index-0 center = cellSize/2; we need it at (3*cellSize + 2*padding)/2
      // Difference = step (= cellSize + padding)
      this.strip[0].y += this.step;
    }
  }

  private rebuildStrip(symbolIds: string[]): void {
    this.strip.forEach(s => s.destroy());
    this.strip = [];
    this.symbolContainer.removeChildren();
    
    const totalColumnHeight = this.rows * this.cellSize + (this.rows - 1) * this.padding;
    
    symbolIds.forEach((symbolId, index) => {
      const sprite = new Sprite();
      const texture = this.assetLoader.getTexture(symbolId);
      if (texture) sprite.texture = texture;
      
      sprite.anchor.set(0.5);
      sprite.x = this.cellSize / 2;
      
      if (this.isTarotColumn && index === 0) {
        // First final symbol: tall image spanning all 3 cells, bleeds into padding gaps
        sprite.width = this.cellSize + this.padding;
        sprite.height = totalColumnHeight;
      } else if (this.isTarotColumn && index > 0 && index < this.rows) {
        // Other final tarot slots: hide them (tall sprite covers their area)
        sprite.width = this.cellSize - 20;
        sprite.height = this.cellSize - 20;
        sprite.alpha = 0;
      } else {
        // Normal symbol or filler
        sprite.width = this.cellSize - 20;
        sprite.height = this.cellSize - 20;
      }
      
      this.symbolContainer.addChild(sprite);
      this.strip.push(sprite);
    });
  }

  setSymbols(symbolIds: string[], isTarotColumn: boolean = false): void {
    this.isTarotColumn = isTarotColumn;
    this.updateMask();
    this.finalSymbols = symbolIds;
    this.rebuildStrip(symbolIds);
    this.scrollOffset = 0;
    this.bounceOffset = 0;
    this.updateStripPositions();
  }

  /** Returns true if still scrolling OR bouncing (not fully settled) */
  getIsSpinning(): boolean {
    return this.isSpinning || this.bouncing;
  }
  
  /** Returns true only if still scrolling (hasn't been told to stop yet) */
  isStillScrolling(): boolean {
    return this.isSpinning;
  }

  /** Hide/show the symbol container (used during Fool reveal animation) */
  setColumnVisible(visible: boolean): void {
    this.symbolContainer.alpha = visible ? 1 : 0;
  }

  /** Get the first `rows` sprites (the visible final symbols) for external animation */
  getVisibleSprites(): Sprite[] {
    return this.strip.slice(0, this.rows);
  }

  /** Get the tall tarot/cardback sprite (index 0) if this is a tarot column */
  getTarotSprite(): Sprite | null {
    if (this.isTarotColumn && this.strip.length > 0) {
      return this.strip[0];
    }
    return null;
  }

  /** Get the actual tarot symbol ID (used for texture swap during flip) */
  getActualTarotId(): string | null {
    return this.actualTarotId;
  }

  /**
   * Resize this reel spinner to a new cell size, rows, and padding.
   * Rebuilds the mask and re-renders current symbols at the new size.
   */
  resizeCells(newCellSize: number, newRows: number, newPadding: number): void {
    this.cellSize = newCellSize;
    this.rows = newRows;
    this.padding = newPadding;
    this.step = newCellSize + newPadding;
    this.maskHeight = newRows * newCellSize + (newRows - 1) * newPadding;

    // Rebuild mask
    this.maskGraphic.clear();
    this.maskGraphic.rect(0, 0, this.cellSize, this.maskHeight);
    this.maskGraphic.fill({ color: 0xffffff });

    // Re-render current symbols if we have any
    if (this.finalSymbols.length > 0) {
      this.rebuildStrip(this.finalSymbols);
      this.scrollOffset = 0;
      this.bounceOffset = 0;
      this.updateStripPositions();
    }
  }

  /** Get the current cell size */
  getCellSize(): number { return this.cellSize; }

  /** Get the current row count */
  getRowCount(): number { return this.rows; }
}
