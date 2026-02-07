import { Container, Sprite, Graphics } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';

export class ReelSpinner extends Container {
  private strip: Sprite[] = [];
  private symbolContainer: Container;
  private isSpinning: boolean = false;
  private scrollOffset: number = 0;
  private targetOffset: number = 0;
  private velocity: number = 60; // Fast!
  private readonly cellSize: number;
  private readonly rows: number;
  private finalSymbols: string[] = [];
  
  // Bounce state
  private bouncing: boolean = false;
  private bounceOffset: number = 0;
  private bounceVelocity: number = 0;
  private bounceTime: number = 0;

  private readonly padding: number;
  private readonly step: number; // cellSize + padding

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
    const maskHeight = rows * cellSize + (rows - 1) * padding;
    const mask = new Graphics();
    mask.rect(0, 0, cellSize, maskHeight);
    mask.fill({ color: 0xffffff });
    this.addChild(mask);
    this.symbolContainer.mask = mask;
  }

  startSpin(finalSymbols: string[]): void {
    this.finalSymbols = finalSymbols;
    this.isSpinning = true;
    this.bouncing = false;
    this.velocity = 60; // Fast constant speed
    
    // Build strip: final symbols FIRST, then filler AFTER
    // This way scrollOffset goes from negative (showing filler) to 0 (showing final)
    // Use enough filler so we never need to loop (avoids visual glitch)
    const fillerCount = 50;
    const fillerSymbols: string[] = [];
    
    const normalSymbols = this.assetLoader.getNormalSymbols();
    const premiumSymbols = this.assetLoader.getSymbolsByTier('PREMIUM');
    
    for (let i = 0; i < fillerCount; i++) {
      if (Math.random() < 0.3) {
        const premium = premiumSymbols[Math.floor(Math.random() * premiumSymbols.length)];
        fillerSymbols.push(premium.id);
      } else {
        const random = normalSymbols[Math.floor(Math.random() * normalSymbols.length)];
        fillerSymbols.push(random.id);
      }
    }
    
    // Strip = [final0, final1, final2, filler0, ..., filler19]
    const stripSymbols = [...finalSymbols, ...fillerSymbols];
    
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
  }

  private rebuildStrip(symbolIds: string[]): void {
    this.strip.forEach(s => s.destroy());
    this.strip = [];
    this.symbolContainer.removeChildren();
    
    symbolIds.forEach((symbolId) => {
      const sprite = new Sprite();
      const texture = this.assetLoader.getTexture(symbolId);
      if (texture) sprite.texture = texture;
      
      sprite.anchor.set(0.5);
      sprite.width = this.cellSize - 20;
      sprite.height = this.cellSize - 20;
      sprite.x = this.cellSize / 2;
      
      this.symbolContainer.addChild(sprite);
      this.strip.push(sprite);
    });
  }

  setSymbols(symbolIds: string[]): void {
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
}
