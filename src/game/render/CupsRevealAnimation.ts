import { Container, Graphics, Text, TextStyle, Sprite } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';
import { FeatureTrigger } from '../Types';
import { CupsResult } from '../logic/TarotFeatureProcessor';
import { ReelSpinner } from './ReelSpinner';
import { RNG } from '../RNG';
import { ThreeBackground } from '../../threeBackground';
import { playTarotTearEffects } from './TearEffectHelper';
import { tween, wait, easeOutCubic, easeOutBack } from '../utils/AnimationUtils';

// ═══════════════════════════════════════════════════════════════
//  CupsRevealAnimation
//  Orchestrates the Cups multiplier collection feature:
//    Hide Cups → Reveal Initial Multipliers → Collection Loop → Payout
// ═══════════════════════════════════════════════════════════════
export class CupsRevealAnimation {
  private scrollLayer: Container;     // Behind — scrolling filler
  private multiplierLayer: Container; // Front — actual multipliers, lives, win display
  private dimGraphic: Graphics;
  private multiplierContainers: Map<string, Container> = new Map();
  private livesText: Text | null = null;
  private rng: RNG;
  private skipRequested: boolean = false;
  private currentSpinResolve: (() => void) | null = null;

  constructor(
    private parent: Container,
    private reelSpinners: ReelSpinner[],
    private assetLoader: AssetLoader,
    private cellSize: number,
    private padding: number,
    private cols: number,
    private rows: number,
    seed: number,
    private threeBg: ThreeBackground | null = null,
    private pixiCanvas: HTMLCanvasElement | null = null
  ) {
    this.scrollLayer = new Container();
    this.multiplierLayer = new Container();
    this.dimGraphic = new Graphics();
    this.rng = new RNG(seed);
  }

  // ── Get hue color based on multiplier value ─────────────
  private getMultiplierColor(value: number): number {
    if (value < 10) return 0xFFD700;      // Gold (1-10x)
    if (value < 50) return 0xFF8C00;      // Orange (10-50x)
    if (value < 100) return 0xFF1493;     // Pink/Red (50-100x)
    return 0x9400D3;                      // Purple (100-500x)
  }

  // ── Get font size based on multiplier value ─────────────
  private getMultiplierFontSize(value: number): number {
    if (value < 10) return 30;
    if (value < 50) return 35;
    if (value < 100) return 50;
    return 60;
  }

  // ── Public entry point ────────────────────────────────────
  async play(
    feature: FeatureTrigger,
    cupsResult: CupsResult,
    betAmount: number
  ): Promise<number> {
    this.skipRequested = false; // Reset skip flag
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Mount layers: scroll behind, multipliers in front
    this.parent.addChild(this.scrollLayer);
    this.parent.addChild(this.multiplierLayer);

    try {
      // Phase 1 — Hide Cups columns (tear starts immediately)
      // Start tear (don't await — next phase starts scrolling alongside the tear)
      const tearPromise = this.phaseHideCups(feature);

      // Phase 2 — Reveal initial multipliers (runs concurrently with tear)
      await Promise.all([tearPromise, this.phaseRevealInitialMultipliers(cupsResult)]);

      // Phase 3 — Board clear (hide all symbols except multipliers)
      await this.phaseBoardClear(cupsResult);

      // Phase 4 — Multiplier collection loop
      const totalMultiplier = await this.phaseMultiplierLoop(cupsResult, betAmount);

      // Phase 5 — Calculate and display final payout
      const payout = betAmount * totalMultiplier;
      await this.phaseWinDisplay(totalMultiplier, payout, totalWidth, totalHeight);
      await wait(2000); // Hold display
      await this.phaseCleanup(totalWidth, totalHeight);

      return payout;
    } finally {
      this.cleanup();
    }
  }

  // ── Phase 1: Hide Cups Columns (with tear effect) ────────
  private async phaseHideCups(feature: FeatureTrigger): Promise<void> {
    if (this.threeBg && this.pixiCanvas) {
      await playTarotTearEffects(
        this.threeBg,
        feature.columns,
        feature.type,
        this.reelSpinners,
        this.cellSize,
        this.padding,
        this.rows,
        this.pixiCanvas
      );
    } else {
      for (const col of feature.columns) {
        this.reelSpinners[col].setColumnVisible(false);
      }
    }
  }

  // ── Phase 2: Reveal Initial Multipliers ──────────────────
  private async phaseRevealInitialMultipliers(cupsResult: CupsResult): Promise<void> {
    const step = this.cellSize + this.padding;

    // Show empty cells in Cups columns
    for (const col of cupsResult.cupsColumns) {
      this.reelSpinners[col].setColumnVisible(true);
      // Hide symbols in this column
      this.reelSpinners[col].setColumnVisible(false);
    }

    // Reveal multipliers one by one
    const stagger = 150; // ms between each multiplier

    for (let i = 0; i < cupsResult.initialMultipliers.length; i++) {
      await wait(i * stagger);
      const mult = cupsResult.initialMultipliers[i];
      await this.spawnMultiplierText(mult.col, mult.row, mult.value, step);
    }

    await wait(300); // Brief pause after all revealed
  }

  // ── Phase 3: Board Clear ─────────────────────────────────
  private async phaseBoardClear(_cupsResult: CupsResult): Promise<void> {
    // Hide all symbol containers (we'll show multipliers directly)
    for (let col = 0; col < this.cols; col++) {
      this.reelSpinners[col].setColumnVisible(false);
    }
    await wait(200);
  }

  // ── Phase 4: Multiplier Collection Loop ──────────────────
  private async phaseMultiplierLoop(
    cupsResult: CupsResult,
    _betAmount: number
  ): Promise<number> {
    let lives = 3;
    const multiplierGrid: (number | null)[][] = Array(this.cols)
      .fill(null)
      .map(() => Array(this.rows).fill(null));

    // Place initial multipliers
    for (const mult of cupsResult.initialMultipliers) {
      multiplierGrid[mult.col][mult.row] = mult.value;
    }

    // Create lives display
    this.createLivesDisplay(lives);

    const step = this.cellSize + this.padding;
    const multiplierPool = [2, 3, 5, 10];
    const landingChance = 0.50; // 50% chance per cell (for testing - higher chance)

    // Collection loop
    while (lives > 0) {
      // Check if board is full
      const filledCells = multiplierGrid.flat().filter(v => v !== null).length;
      if (filledCells >= this.cols * this.rows) {
        // Double all multipliers
        for (let col = 0; col < this.cols; col++) {
          for (let row = 0; row < this.rows; row++) {
            if (multiplierGrid[col][row] !== null) {
              multiplierGrid[col][row]! *= 2;
              await this.updateMultiplierText(col, row, multiplierGrid[col][row]!, step);
            }
          }
        }
        await wait(1000);
        break;
      }

      // Simulate a spin (show scrolling animation)
      await this.simulateSpin();

      // After spin animation, CALCULATE which multipliers should land
      // Track which cells got NEW multipliers (not replacements)
      let newMultipliersLanded = false;
      const cellsToCheck: { col: number; row: number }[] = [];

      // Build list of all cells
      for (let col = 0; col < this.cols; col++) {
        for (let row = 0; row < this.rows; row++) {
          cellsToCheck.push({ col, row });
        }
      }

      // Shuffle to randomize which cells get checked first
      this.rng.shuffle(cellsToCheck);

      // Limit to checking only a few cells per spin to prevent too many multipliers
      const maxChecks = 5; // Only check 5 random cells per spin
      const cellsThisSpin = cellsToCheck.slice(0, maxChecks);

      // STEP 1: Calculate which multipliers should land (don't spawn yet)
      const multipliersToLand: { col: number; row: number; value: number; isNew: boolean }[] = [];

      for (const cell of cellsThisSpin) {
        const { col, row } = cell;
        
        if (this.rng.nextFloat() < landingChance) {
          const newMultiplier = this.rng.choice(multiplierPool);

          if (multiplierGrid[col][row] === null) {
            // Empty cell: add new multiplier
            multiplierGrid[col][row] = newMultiplier;
            multipliersToLand.push({ col, row, value: newMultiplier, isNew: true });
            newMultipliersLanded = true; // NEW multiplier added
          } else {
            // Existing multiplier: ALWAYS multiply (stack them)
            multiplierGrid[col][row]! *= newMultiplier;
            multipliersToLand.push({ col, row, value: multiplierGrid[col][row]!, isNew: false });
            // Landing on existing cell does NOT count as "landing" for lives
          }
        }
      }

      // STEP 2: Drop calculated multipliers column-by-column
      await this.dropMultipliers(multipliersToLand, step);

      // If no NEW multipliers landed in EMPTY cells, lose a life
      if (!newMultipliersLanded) {
        lives--;
        this.updateLivesDisplay(lives);
        await wait(500);
      }

      await wait(200); // Brief pause between spins
    }

    // Calculate total multiplier
    const totalMultiplier = multiplierGrid.flat().reduce((sum, v) => (sum || 0) + (v || 0), 0) || 0;

    return totalMultiplier;
  }

  // ── Drop multipliers column-by-column like real reels ───
  private async dropMultipliers(
    multipliers: { col: number; row: number; value: number; isNew: boolean }[],
    step: number
  ): Promise<void> {
    // Group by column
    const byColumn: Map<number, { row: number; value: number; isNew: boolean }[]> = new Map();
    
    for (const mult of multipliers) {
      if (!byColumn.has(mult.col)) {
        byColumn.set(mult.col, []);
      }
      byColumn.get(mult.col)!.push({ row: mult.row, value: mult.value, isNew: mult.isNew });
    }

    // Drop each column sequentially (left to right)
    const columnStagger = 100; // ms between each column
    const sortedCols = Array.from(byColumn.keys()).sort((a, b) => a - b);

    for (const col of sortedCols) {
      await wait(columnStagger);
      
      const colMultipliers = byColumn.get(col)!;
      
      // Drop all multipliers in this column simultaneously
      const dropPromises: Promise<void>[] = [];
      
      for (const mult of colMultipliers) {
        if (mult.isNew) {
          // New multiplier: spawn with drop animation
          dropPromises.push(this.spawnMultiplierWithDrop(col, mult.row, mult.value, step));
        } else {
          // Existing multiplier: update with pulse
          dropPromises.push(this.updateMultiplierText(col, mult.row, mult.value, step));
        }
      }
      
      await Promise.all(dropPromises);
    }
  }

  // ── Spawn multiplier with drop animation (cup + text) ──
  private async spawnMultiplierWithDrop(
    col: number,
    row: number,
    value: number,
    step: number
  ): Promise<void> {
    // Calculate grid position
    const cx = col * step + this.cellSize / 2;
    const cy = row * step + this.cellSize / 2;

    // Create container for cup + text
    const container = new Container();
    container.x = cx;
    container.y = cy - step * 2; // Start 2 rows above
    this.multiplierLayer.addChild(container);

    // Create cup sprite
    const cupTexture = this.assetLoader.getTexture('CUP');
    if (cupTexture) {
      const cupSprite = new Sprite(cupTexture);
      cupSprite.anchor.set(0.5);
      cupSprite.width = this.cellSize * 0.8;
      cupSprite.height = this.cellSize * 0.8;
      cupSprite.x = 0;
      cupSprite.y = 0;
      
      // Apply color tint based on multiplier value
      cupSprite.tint = this.getMultiplierColor(value);
      
      container.addChild(cupSprite);
    }

    // Create multiplier text at bottom of cup
    const text = new Text({
      text: `×${value}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: this.getMultiplierFontSize(value),
        fill: this.getMultiplierColor(value),
        stroke: { color: 0x000000, width: 4 },
        dropShadow: {
          color: 0x000000,
          blur: 4,
          distance: 2,
          alpha: 0.9,
        },
      }),
    });
    text.anchor.set(0.5, 0);
    text.x = 0;
    text.y = this.cellSize * 0.25; // Bottom of cup
    container.addChild(text);

    const key = `${col},${row}`;
    this.multiplierContainers.set(key, container);

    // Drop animation with bounce
    await tween(400, (t) => {
      const bounce = easeOutBack(t);
      container.y = (cy - step * 2) + (step * 2) * bounce;
    }, easeOutBack);

    container.y = cy; // Snap to final position
  }

  // ── Spawn multiplier (cup + text) with pop-in animation ──
  private async spawnMultiplierText(
    col: number,
    row: number,
    value: number,
    step: number
  ): Promise<void> {
    const cx = col * step + this.cellSize / 2;
    const cy = row * step + this.cellSize / 2;

    // Create container for cup + text
    const container = new Container();
    container.x = cx;
    container.y = cy;
    container.scale.set(0);
    container.alpha = 0;
    this.multiplierLayer.addChild(container);

    // Create cup sprite
    const cupTexture = this.assetLoader.getTexture('CUP');
    if (cupTexture) {
      const cupSprite = new Sprite(cupTexture);
      cupSprite.anchor.set(0.5);
      cupSprite.width = this.cellSize * 0.8;
      cupSprite.height = this.cellSize * 0.8;
      cupSprite.x = 0;
      cupSprite.y = 0;
      
      // Apply color tint based on multiplier value
      cupSprite.tint = this.getMultiplierColor(value);
      
      container.addChild(cupSprite);
    }

    // Create multiplier text at bottom of cup
    const text = new Text({
      text: `×${value}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: this.getMultiplierFontSize(value),
        fill: this.getMultiplierColor(value),
        stroke: { color: 0x000000, width: 4 },
        dropShadow: {
          color: 0x000000,
          blur: 4,
          distance: 2,
          alpha: 0.9,
        },
      }),
    });
    text.anchor.set(0.5, 0);
    text.x = 0;
    text.y = this.cellSize * 0.25; // Bottom of cup
    container.addChild(text);

    const key = `${col},${row}`;
    this.multiplierContainers.set(key, container);

    // Pop-in animation
    await tween(400, (t) => {
      let s: number;
      if (t < 0.6) {
        s = easeOutBack(t / 0.6) * 1.15;
      } else {
        s = 1.15 - ((t - 0.6) / 0.4) * 0.15;
      }
      container.scale.set(s);
      container.alpha = Math.min(1, t * 3);
    }, easeOutCubic);

    container.scale.set(1);
    container.alpha = 1;
  }

  // ── Update existing multiplier (multiplication animation) ──
  private async updateMultiplierText(
    col: number,
    row: number,
    newValue: number,
    _step: number
  ): Promise<void> {
    const key = `${col},${row}`;
    const container = this.multiplierContainers.get(key);

    if (container) {
      // Find cup sprite and text in container
      const cupSprite = container.children.find(child => child instanceof Sprite) as Sprite | undefined;
      const text = container.children.find(child => child instanceof Text) as Text | undefined;

      // Get old value from text
      const oldValueMatch = text?.text.match(/×(\d+)/);
      const oldValue = oldValueMatch ? parseInt(oldValueMatch[1]) : 0;

      // Phase 1: Fade out cup
      await tween(200, (t) => {
        container.alpha = 1 - t;
      }, easeOutCubic);

      // Phase 2: Show multiplication popup (e.g., "3×9")
      const multiplierUsed = oldValue > 0 ? newValue / oldValue : newValue;
      const popupText = new Text({
        text: `${oldValue}×${multiplierUsed}`,
        style: new TextStyle({
          fontFamily: 'CustomFont, Arial, sans-serif',
          fontSize: 40,
          fill: 0xFFFF00, // Bright yellow
          stroke: { color: 0x000000, width: 3 },
          dropShadow: {
            color: 0x000000,
            blur: 4,
            distance: 2,
            alpha: 0.9,
          },
        }),
      });
      popupText.anchor.set(0.5);
      popupText.x = container.x; 
      popupText.y = container.y;
      popupText.alpha = 0;
      this.multiplierLayer.addChild(popupText);

      // Fade in popup
      await tween(300, (t) => {
        popupText.alpha = t;
        popupText.y = container.y; // Float up slightly
      }, easeOutCubic);

      await wait(400); // Hold popup visible

      // Fade out popup
      tween(300, (t) => {
        popupText.alpha = 1 - t;
      }, easeOutCubic).then(() => {
        this.multiplierLayer.removeChild(popupText);
      });

      // Phase 3: Update cup color, text value, font size and color (while popup is fading)
      if (cupSprite) {
        cupSprite.tint = this.getMultiplierColor(newValue);
      }
      if (text) {
        text.text = `×${newValue}`;
        text.style.fontSize = this.getMultiplierFontSize(newValue);
        text.style.fill = this.getMultiplierColor(newValue);
      }

      // Phase 4: Fade in cup with big pulse
      await tween(600, (t) => {
        const s = 1 + Math.sin(t * Math.PI) * 0.5; // Bigger pulse
        container.scale.set(s);
        container.alpha = t;
      }, easeOutCubic);

      container.scale.set(1);
      container.alpha = 1;
    }
  }

  // ── Create lives display ─────────────────────────────────
  private createLivesDisplay(lives: number): void {
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;

    this.livesText = new Text({
      text: `Lives: ${lives}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 36,
        fill: 0xFFFFFF,
        stroke: { color: 0x000000, width: 4 },
        dropShadow: {
          color: 0x000000,
          blur: 6,
          distance: 2,
          alpha: 0.8,
        },
      }),
    });
    this.livesText.anchor.set(0.5, 0);
    this.livesText.x = totalWidth / 2;
    this.livesText.y = -110;
    this.multiplierLayer.addChild(this.livesText);
  }

  // ── Update lives display ─────────────────────────────────
  private updateLivesDisplay(lives: number): void {
    if (this.livesText) {
      this.livesText.text = `Lives: ${lives}`;

      // Pulse animation on life loss
      tween(300, (t) => {
        const s = 1 + Math.sin(t * Math.PI) * 0.2;
        this.livesText!.scale.set(s);
      }, easeOutCubic).then(() => {
        this.livesText!.scale.set(1);
      });
    }
  }

  // ── Public skip method ───────────────────────────────────
  skipCurrentSpin(): void {
    this.skipRequested = true;
    if (this.currentSpinResolve) {
      this.currentSpinResolve();
      this.currentSpinResolve = null;
    }
  }

  // ── Simulate spin with multiplier drops ──────────────────
  private async simulateSpin(): Promise<void> {
    const step = this.cellSize + this.padding;
    
    // Check if skip was requested
    if (this.skipRequested) {
      this.skipRequested = false;
      return; // Skip entire animation
    }
    
    const fillerCount = 20; // Number of rows scrolling past
    const showMultiplierChance = 0.25; // 40% chance to show multiplier in filler
    
    // Create mask for grid area (same as ReelSpinner mask)
    const maskHeight = this.rows * this.cellSize + (this.rows - 1) * this.padding;
    
    // Phase 1: Create strip per column with weighted empty/multiplier mix
    const scrollingContainers: Container[] = [];
    const masks: Graphics[] = [];
    
    for (let col = 0; col < this.cols; col++) {
      const container = new Container();
      container.x = col * step;
      container.y = 0;
      
      // Create mask for this column (like ReelSpinner does)
      const maskGraphic = new Graphics();
      maskGraphic.rect(col * step, 0, this.cellSize, maskHeight);
      maskGraphic.fill({ color: 0xffffff });
      this.scrollLayer.addChild(maskGraphic);
      masks.push(maskGraphic);
      
      container.mask = maskGraphic;
      this.scrollLayer.addChild(container);
      scrollingContainers.push(container);
      
      // Build vertical strip with EMPTY and CUP+MULTIPLIER cells mixed
      const fillerMultiplierPool = [1, 2, 3, 5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 250, 300, 400, 500];
      
      for (let i = 0; i < fillerCount; i++) {
        // 40% chance to show cup+multiplier, 60% empty
        if (this.rng.nextFloat() < showMultiplierChance) {
          const value = this.rng.choice(fillerMultiplierPool);
          
          // Create container for cup + text (same as real multipliers)
          const cellContainer = new Container();
          cellContainer.x = this.cellSize / 2;
          cellContainer.y = -i * step + this.cellSize / 2;
      
          
          // Cup sprite
          const cupTexture = this.assetLoader.getTexture('CUP');
          if (cupTexture) {
            const cupSprite = new Sprite(cupTexture);
            cupSprite.anchor.set(0.5);
            cupSprite.width = this.cellSize * 0.8;
            cupSprite.height = this.cellSize * 0.8;
            cupSprite.tint = this.getMultiplierColor(value);
            cellContainer.addChild(cupSprite);
          }
          
          // Multiplier text at bottom
          const text = new Text({
            text: `×${value}`,
            style: {
              fontFamily: 'CustomFont, Arial, sans-serif',
              fontSize: this.getMultiplierFontSize(value),
              fill: this.getMultiplierColor(value),
              stroke: { color: 0x000000, width: 4 },
              dropShadow: {
                color: 0x000000,
                blur: 4,
                distance: 2,
                alpha: 0.9,
              },
            },
          });
          text.anchor.set(0.5, 0);
          text.x = 0;
          text.y = this.cellSize * 0.25;
          cellContainer.addChild(text);
          
          container.addChild(cellContainer);
        }
        // Else: empty row (no cup added)
      }
    }
    
    // Phase 2: Fast scroll DOWN (like normal reels falling)
    const scrollDuration = this.skipRequested ? 240 : 1800; // 20% slower
    const targetScroll = fillerCount * step; // Total scroll distance
    
    let scrollOffset = 0;
    const startTime = performance.now();
    
    await new Promise<void>((resolve) => {
      this.currentSpinResolve = resolve;
      
      const animate = (now: number) => {
        if (this.skipRequested) {
          this.currentSpinResolve = null;
          resolve();
          return;
        }
        
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / scrollDuration, 1);
        
        // Scroll DOWN (increasing Y)
        scrollOffset = progress * targetScroll;
        
        scrollingContainers.forEach(container => {
          container.y = scrollOffset;
        });
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.currentSpinResolve = null;
          resolve();
        }
      };
      
      requestAnimationFrame(animate);
    });
    
    // Immediately cleanup scrolling containers (no bounce)
    scrollingContainers.forEach((container, idx) => {
      container.mask = null;
      container.removeChildren();
      this.scrollLayer.removeChild(container);
      
      // Remove mask
      masks[idx].clear();
      this.scrollLayer.removeChild(masks[idx]);
    });
    
    this.skipRequested = false;
  }

  // ── Phase 5: Win Display ─────────────────────────────────
  private async phaseWinDisplay(
    totalMultiplier: number,
    payout: number,
    tw: number,
    th: number
  ): Promise<void> {
    // Dim the grid
    this.dimGraphic.clear();
    this.dimGraphic.rect(0, 0, tw, th);
    this.dimGraphic.fill({ color: 0x000000, alpha: 0.6 });
    this.multiplierLayer.addChild(this.dimGraphic);

    // Create multiplier display
    const multiplierText = new Text({
      text: `Total: ×${totalMultiplier.toFixed(1)}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 56,
        fill: 0xFFD700,
        stroke: { color: 0x000000, width: 6 },
        dropShadow: {
          color: 0x000000,
          blur: 8,
          distance: 3,
          alpha: 0.8,
        },
      }),
    });
    multiplierText.anchor.set(0.5);
    multiplierText.x = tw / 2;
    multiplierText.y = th / 2 - 40;
    multiplierText.alpha = 0;
    this.multiplierLayer.addChild(multiplierText);

    // Create payout display
    const payoutText = new Text({
      text: '0.00 €',
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 64,
        fill: 0xFFFFFF,
        stroke: { color: 0x000000, width: 6 },
        dropShadow: {
          color: 0x000000,
          blur: 10,
          distance: 4,
          alpha: 0.9,
        },
      }),
    });
    payoutText.anchor.set(0.5);
    payoutText.x = tw / 2;
    payoutText.y = th / 2 + 40;
    payoutText.alpha = 0;
    payoutText.scale.set(0.8);
    this.multiplierLayer.addChild(payoutText);

    // Fade in multiplier
    await tween(900, (t) => {
      multiplierText.alpha = t;
    }, easeOutCubic);

    // Count up payout
    const countDuration = 1200;
    const start = performance.now();

    await new Promise<void>(resolve => {
      const frame = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / countDuration, 1);
        const ease = easeOutCubic(t);

        const currentValue = payout * ease;
        payoutText.text = `${currentValue.toFixed(2)} €`;

        const scale = 0.8 + ease * 0.4;
        payoutText.scale.set(scale);
        payoutText.alpha = Math.min(1, t * 2);

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          payoutText.text = `${payout.toFixed(2)} €`;
          payoutText.scale.set(1.2);
          payoutText.alpha = 1;
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  // ── Phase 6: Cleanup ─────────────────────────────────────
  private async phaseCleanup(tw: number, th: number): Promise<void> {
    await tween(400, (t) => {
      this.dimGraphic.clear();
      this.dimGraphic.rect(0, 0, tw, th);
      this.dimGraphic.fill({ color: 0x000000, alpha: 0.6 * (1 - t) });

      this.multiplierLayer.children.forEach((child) => {
        if (child instanceof Text) {
          child.alpha = 1 - t;
        }
      });
    }, easeOutCubic);
  }

  // ── Tear down all temporary display objects ──────────────
  private cleanup(): void {
    this.parent.removeChild(this.scrollLayer);
    this.parent.removeChild(this.multiplierLayer);
    this.scrollLayer.removeChildren();
    this.multiplierLayer.removeChildren();
    this.dimGraphic.clear();
    this.multiplierContainers.clear();

    if (this.livesText) {
      this.livesText.destroy();
      this.livesText = null;
    }
  }
}
