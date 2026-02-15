import { Container, Sprite, Graphics } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';
import { soundManager } from '../utils/SoundManager';

export class ReelSpinner extends Container {
  private strip: Sprite[] = [];
  private symbolContainer: Container;
  private isSpinning: boolean = false;
  private scrollOffset: number = 0;
  private targetOffset: number = 0;
  private velocity: number = 60;
  private cellSize: number;
  private rows: number;
  private finalSymbols: string[] = [];
  private isTarotColumn: boolean = false;
  private actualTarotId: string | null = null;

  private bouncing: boolean = false;
  private bounceOffset: number = 0;
  private bounceVelocity: number = 0;
  private bounceTime: number = 0;

  // Deceleration landing
  private decelerating: boolean = false;
  private decelResolve: (() => void) | null = null;
  private decelIntensity: number = 0.8;

  // Anticipation mode
  private baseVelocity: number = 60;
  private wasInAnticipation: boolean = false;

  /** @deprecated No longer needed — sounds are preloaded via SoundManager. */
  static async loadLandSound(): Promise<void> {}

  private playLandSound(): void {
    soundManager.play('land-normal', 1.0);
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
    this.actualTarotId = isTarotColumn ? finalSymbols[0] : null;
    const displayCardbackId = cardbackId || null;
    this.updateMask();
    this.isSpinning = true;
    this.bouncing = false;
    this.velocity = 60; // Fast constant speed
    
    // Build strip: final symbols FIRST, then filler AFTER
    // This way scrollOffset goes from negative (showing filler) to 0 (showing final)
    // Use enough filler so we never run out during long anticipation waits
    const fillerCount = 200;
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
    
    const displaySymbols = [...finalSymbols];
    if (isTarotColumn && displayCardbackId) {
      displaySymbols[0] = displayCardbackId;
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
        // Only stop if still actively scrolling — avoid re-triggering bounce/sound
        if (!this.isSpinning) {
          resolve();
          return;
        }

        if (this.wasInAnticipation) {
          // Anticipation reels: smooth deceleration into final position
          this.isSpinning = false;
          this.decelerating = true;
          this.decelIntensity = intensity;
          this.decelResolve = resolve;

          // Snap the offset to within a few steps of target — the reel will
          // scroll fast through the remaining filler then slow into the final symbols
          const remainingDistance = this.targetOffset - this.scrollOffset;
          const maxDecelDistance = 5 * this.step; // 5 cells of slow-down room
          if (remainingDistance > maxDecelDistance) {
            this.scrollOffset = this.targetOffset - maxDecelDistance;
          }

          // Clear any tarot cardback teasers from the deceleration zone so that
          // no partial cardback is visible during the slow landing.
          // The decel zone spans from scrollOffset to targetOffset, which maps to
          // strip indices around 0..maxDecelCells (filler starts at index `rows`).
          this.clearTeasersInDecelZone();

          // Start decel at a high speed — the update loop will ease it down
          this.velocity = 45;
        } else {
          // Normal reels: instant stop + bounce (original behavior)
          this.scrollOffset = this.targetOffset;
          this.isSpinning = false;
          this.playLandSound();
          this.startBounce(intensity);

          const checkBounce = () => {
            if (!this.bouncing) {
              resolve();
            } else {
              requestAnimationFrame(checkBounce);
            }
          };
          checkBounce();
        }

        this.wasInAnticipation = false;
      }, delay);
    });
  }

  skipToResult(): void {
    // Fast-forward to target position without bounce
    if (this.isSpinning || this.decelerating) {
      this.scrollOffset = this.targetOffset;
      this.isSpinning = false;
      this.decelerating = false;
      this.bouncing = false;
      if (this.decelResolve) {
        this.decelResolve();
        this.decelResolve = null;
      }
      this.updateStripPositions();
    }
  }
  
  triggerBounce(intensity: number = 1.0): void {
    if (!this.bouncing) {
      
      this.startBounce(intensity);
    }
  }

  private startBounce(intensity: number = 1.0): void {
    this.bouncing = true;
    this.bounceOffset = 0;
    this.bounceVelocity = 8 * intensity; // Overshoot downward
    this.bounceTime = 0;
  }

  /**
   * Enter anticipation mode — slow down the reel and show tarot cardbacks in the strip.
   * level 1 = first tarot landed (moderate slowdown), level 2 = second tarot (dramatic slowdown)
   */
  enterAnticipation(level: number, cardbackIds: string[]): void {
    this.wasInAnticipation = true;
    const tarotChance = level === 1 ? 0.08 : 0.12; // chance per group of 3

    // Keep spinning fast — the slowdown happens only during deceleration landing
    // Just slightly slower than normal to give time to see teasers
    if (level === 1) {
      this.velocity = 40;
    } else {
      this.velocity = 30;
    }

    // Inject tarot cardback sprites into the filler portion of the strip
    // Each tarot teaser spans 3 cells (like real tarot columns), so we process
    // filler in groups of `this.rows` (3) and make the first sprite tall, hiding the rest
    const fillerStart = this.rows;
    const totalColumnHeight = this.rows * this.cellSize + (this.rows - 1) * this.padding;

    for (let i = fillerStart; i + this.rows - 1 < this.strip.length; i += this.rows) {
      if (Math.random() < tarotChance && cardbackIds.length > 0) {
        const cardbackId = cardbackIds[Math.floor(Math.random() * cardbackIds.length)];
        const texture = this.assetLoader.getTexture(cardbackId);
        if (texture) {
          // Make the first sprite of the group tall (spanning all 3 rows)
          this.strip[i].texture = texture;
          this.strip[i].width = this.cellSize + this.padding;
          this.strip[i].height = totalColumnHeight;
          this.strip[i].alpha = 0.7;
          // Hide the other sprites in this group (covered by the tall one)
          for (let j = 1; j < this.rows && (i + j) < this.strip.length; j++) {
            this.strip[i + j].alpha = 0;
          }
        }
      }
    }
  }

  /**
   * Restore filler sprites in the deceleration zone (near the final symbols)
   * back to normal size so no partial tarot cardback teaser is visible
   * during the slow landing animation.
   */
  private clearTeasersInDecelZone(): void {
    // The decel zone is the last few filler cells before the final symbols.
    // After the snap, scrollOffset is at most 5*step behind targetOffset (0).
    // The visible area during decel spans strip indices rows..rows+decelCells+rows
    // (rows = final symbols, then filler starts).
    // To be safe, clear all filler in the first ~8 cells (more than the 5-cell decel window
    // plus the 3 visible rows).
    const safeCells = 10;
    const fillerStart = this.rows;
    const fillerEnd = Math.min(fillerStart + safeCells, this.strip.length);

    for (let i = fillerStart; i < fillerEnd; i++) {
      const sprite = this.strip[i];
      sprite.width = this.cellSize - 20;
      sprite.height = this.cellSize - 20;
      sprite.alpha = 1;
    }
  }

  /** Exit anticipation mode — restore filler sprites to normal size */
  exitAnticipation(): void {
    this.velocity = this.baseVelocity;

    // Restore any filler sprites that were resized to tall cardback teasers
    const fillerStart = this.rows;
    for (let i = fillerStart; i < this.strip.length; i++) {
      const sprite = this.strip[i];
      sprite.width = this.cellSize - 20;
      sprite.height = this.cellSize - 20;
      sprite.alpha = 1;
    }
  }

  update(delta: number): void {
    if (this.isSpinning) {
      // Scroll downward: scrollOffset increases from negative toward 0
      this.scrollOffset += this.velocity * delta;
      
      // Loop scroll: if we've scrolled past all filler, wrap back to the start
      // so the reel never runs out during long anticipation waits.
      // The filler starts after the first `rows` final symbols.
      const fillerLength = (this.strip.length - this.rows) * this.step;
      if (this.scrollOffset > this.targetOffset) {
        this.scrollOffset -= fillerLength;
      }
      
      this.updateStripPositions();
    }
    else if (this.decelerating) {
      // Smooth deceleration: fast scroll then slow ease into final position
      const remaining = this.targetOffset - this.scrollOffset;
      const totalDecelDistance = 5 * this.step;
      // t goes from 1 (far) to 0 (arrived) 
      const t = Math.min(remaining / totalDecelDistance, 1);

      if (remaining <= 0.5) {
        // Close enough — snap, land, and bounce
        this.scrollOffset = this.targetOffset;
        this.decelerating = false;
        this.playLandSound();
        this.startBounce(this.decelIntensity);

        // Wait for bounce to finish then resolve
        const resolve = this.decelResolve;
        this.decelResolve = null;
        if (resolve) {
          const checkBounce = () => {
            if (!this.bouncing) {
              resolve();
            } else {
              requestAnimationFrame(checkBounce);
            }
          };
          checkBounce();
        }
      } else {
        // Exponential ease-out: fast at start (t≈1), very slow near end (t≈0)
        // velocity = minSpeed + (maxSpeed - minSpeed) * t^2
        const maxSpeed = 50;
        const minSpeed = 2;
        const easeVelocity = minSpeed + (maxSpeed - minSpeed) * t * t;
        this.scrollOffset += easeVelocity * delta;
      }

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

      // 'EMPTY' cells render as invisible (used for sticky WILD positions in Death feature)
      if (symbolId === 'EMPTY') {
        sprite.anchor.set(0.5);
        sprite.x = this.cellSize / 2;
        sprite.width = this.cellSize - 20;
        sprite.height = this.cellSize - 20;
        sprite.alpha = 0;
        this.symbolContainer.addChild(sprite);
        this.strip.push(sprite);
        return;
      }

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

  /** Returns true if still scrolling, decelerating, OR bouncing (not fully settled) */
  getIsSpinning(): boolean {
    return this.isSpinning || this.decelerating || this.bouncing;
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
