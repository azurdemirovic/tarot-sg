/**
 * DeathRevealAnimation — Handles the Death feature animation.
 *
 * Flow:
 *  1. Tear away Death tarot columns
 *  2. Multi-spin loop (10 spins) — AUTO-SPINS:
 *     a. Spin fresh grid with natural drop (hurry-up via spin button)
 *     b. Highlight clusters briefly
 *     c. Slash animation — slashed cells flash red and disappear
 *     d. Refill animation — new symbols drop into empty cells
 *     e. Update reap bar display
 *     f. If grid expands, show expansion animation
 *     g. Evaluate wins and show per-spin win via WinDisplay
 *  3. Show total payout via WinDisplay
 */

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';
import { FeatureTrigger, Grid } from '../Types';
import { DeathResult, DeathSpinResult } from '../logic/TarotFeatureProcessor';
import { ReelSpinner } from './ReelSpinner';
import { GridView } from './GridView';
import { WinDisplay } from './WinDisplay';
import { ThreeBackground } from '../../threeBackground';
import { playTarotTearEffects } from './TearEffectHelper';

// ── Helpers ──────────────────────────────────────────────────────
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tween(
  duration: number,
  onUpdate: (t: number) => void,
  easeFn: (t: number) => number = t => t
): Promise<void> {
  return new Promise(resolve => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const raw = Math.min(elapsed / duration, 1);
      onUpdate(easeFn(raw));
      if (raw < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

export class DeathRevealAnimation {
  // @ts-ignore -- tracked for potential future use
  private hurryUpRequested: boolean = false;
  private reelSpinActive: boolean = false;
  private spinCounterText: Text | null = null;
  private reapBarContainer: Container | null = null;
  private reapBarFill: Graphics | null = null;
  private reapBarText: Text | null = null;
  private overlayContainer: Container;
  private stickyWildOverlays: Graphics[] = [];

  constructor(
    private parent: Container,
    private reelSpinners: ReelSpinner[],
    private assetLoader: AssetLoader,
    private cellSize: number,
    private padding: number,
    private cols: number,
    private rows: number,
    private gridView: GridView,
    private threeBg: ThreeBackground | null = null,
    private pixiCanvas: HTMLCanvasElement | null = null
  ) {
    this.overlayContainer = new Container();
  }

  /** Request hurry-up for the current reel spin animation. */
  requestHurryUp(): void {
    if (this.reelSpinActive) {
      this.hurryUpRequested = true;
      this.gridView.hurryUp();
    }
  }

  /** Whether reels are currently spinning (hurry-up is valid) */
  isReelSpinActive(): boolean {
    return this.reelSpinActive;
  }

  async play(
    feature: FeatureTrigger,
    deathResult: DeathResult,
    onGenerateFreshGrid: (cols: number, rows: number, stickyWilds: { col: number; row: number }[]) => Grid,
    onApplyDeathSpin: (
      grid: Grid,
      deathResult: DeathResult
    ) => {
      spinResult: DeathSpinResult;
      totalWin: number;
    },
    betAmount: number
  ): Promise<number> {
    let totalPayout = 0;

    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Mount overlay for UI elements
    this.parent.addChild(this.overlayContainer);

    try {
      // ── Phase A: Tear away Death tarot columns ──
      await this.phaseTearTarots(feature);

      // ── Phase A2: Show reap bar ──
      this.createReapBar(totalWidth, deathResult);

      // ── Phase B: Multi-spin loop ──
      while (deathResult.spinsRemaining > 0) {
        const spinNum = deathResult.spinsTotal - deathResult.spinsRemaining + 1;
        console.log(`💀 Death Spin ${spinNum}/${deathResult.spinsTotal}`);

        // Show spin counter
        await this.showSpinCounter(spinNum, deathResult.spinsTotal, totalWidth);

        // Clear previous sticky WILD overlays before spinning
        this.clearStickyWildOverlays();

        // B1: Generate fresh grid at current size (with sticky WILDs preserved)
        const freshGrid = onGenerateFreshGrid(deathResult.gridCols, deathResult.gridRows, deathResult.stickyWilds);

        // B2: Spin the grid (sticky WILDs stay in place visually)
        await this.phaseSpinFreshGrid(freshGrid, deathResult.stickyWilds);

        // B2.5: Show sticky WILD glow overlays after grid lands
        this.showStickyWildOverlays(deathResult.stickyWilds);

        // B3: Apply Death spin logic (cluster detect, slash, refill, expansion)
        const { spinResult, totalWin } = onApplyDeathSpin(freshGrid, deathResult);

        // B4: Animate cluster highlights
        if (spinResult.clusters.length > 0) {
          await this.phaseHighlightClusters(spinResult);
        }

        // B5: Animate slashes (removed WILDs flash differently)
        if (spinResult.slashedCells.length > 0) {
          await this.phaseSlashAnimation(spinResult);
        }

        // B5.5: Remove consumed WILD overlays
        if (spinResult.removedWilds.length > 0) {
          this.clearStickyWildOverlays();
        }

        // B6: Animate refill (new sticky WILDs get a special glow)
        if (spinResult.refillCells.length > 0) {
          await this.phaseRefillAnimation(spinResult);
        }

        // B6.5: Update sticky WILD overlays with current state
        this.clearStickyWildOverlays();
        this.showStickyWildOverlays(deathResult.stickyWilds);

        // B7: Update reap bar
        this.updateReapBar(deathResult);

        // B8: If grid expanded, resize the grid view and show expansion flash
        if (spinResult.expanded) {
          this.clearStickyWildOverlays();
          this.gridView.resizeGrid(deathResult.gridCols, deathResult.gridRows);
          // Update our local references after resize
          this.cellSize = this.gridView.getCellSize();
          this.padding = this.gridView.getPadding();
          this.cols = this.gridView.getCols();
          this.rows = this.gridView.getRows();
          this.reelSpinners = this.gridView.getReelSpinners();

          // Show the new grid with current symbols
          this.gridView.updateGrid(spinResult.transformedGrid);

          // Re-show sticky WILDs at new positions/sizes
          this.showStickyWildOverlays(deathResult.stickyWilds);

          await this.phaseExpansionAnimation(deathResult, totalWidth);
        }

        // B9: Accumulate payout
        if (totalWin > 0) {
          totalPayout += totalWin;
        }

        // B10: Show per-spin win (use cluster wins as synthetic win entries)
        if (spinResult.clusterWins.length > 0 && totalWin > 0) {
          const syntheticWins = spinResult.clusterWins.map(cw => ({
            payout: cw.payout,
            symbol: cw.symbolId,
            matchCount: cw.clusterSize,
          }));
          const winDisplay = new WinDisplay(this.parent);
          await winDisplay.show(
            syntheticWins,
            1,
            totalWin,
            betAmount,
            totalWidth,
            totalHeight
          );
        }

        // Brief pause before next spin
        await wait(300);
      }

      // Total win display is handled by Phase 2.9 in main.ts (outline first, then win screen)
    } finally {
      // Cleanup
      this.cleanupOverlay();
    }

    return totalPayout;
  }

  // ── Phase A: Tear away Death tarot columns ──
  private async phaseTearTarots(feature: FeatureTrigger): Promise<void> {
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

    for (let col = 0; col < this.cols; col++) {
      this.reelSpinners[col].setColumnVisible(true);
    }
  }

  // ── Spin fresh grid ──
  private stickyWildSprites: Container[] = [];

  private async phaseSpinFreshGrid(freshGrid: Grid, stickyWilds: { col: number; row: number }[] = []): Promise<void> {
    for (let col = 0; col < this.cols; col++) {
      this.reelSpinners[col].setColumnVisible(true);
    }

    // Place static WILD sprites on top of sticky positions BEFORE spin starts
    // These float above the scrolling reels so the WILDs appear locked in place
    this.clearStickySprites();
    if (stickyWilds.length > 0) {
      const step = this.cellSize + this.padding;
      const offset = this.getOffset();

      for (const wild of stickyWilds) {
        if (wild.col >= this.cols || wild.row >= this.rows) continue;

        const container = new Container();
        container.x = offset.x + wild.col * step;
        container.y = offset.y + wild.row * step;

        // Dark background to hide scrolling underneath
        const bg = new Graphics();
        bg.roundRect(0, 0, this.cellSize, this.cellSize, 0);
        bg.fill({ color: 0x111111, alpha: 0.95 });
        container.addChild(bg);

        // WILD sprite from asset loader
        const wildTexture = this.assetLoader.getTexture('WILD');
        const sprite = new Sprite();
        if (wildTexture) {
          sprite.texture = wildTexture;
        }
        sprite.anchor.set(0.5);
        sprite.x = this.cellSize / 2;
        sprite.y = this.cellSize / 2;
        sprite.width = this.cellSize - 20;
        sprite.height = this.cellSize - 20;
        container.addChild(sprite);

        this.parent.addChild(container);
        this.stickyWildSprites.push(container);
      }
    }

    this.reelSpinActive = true;
    this.hurryUpRequested = false;

    await this.gridView.spinColumnsToGrid(freshGrid);

    this.reelSpinActive = false;
    this.hurryUpRequested = false;

    // Remove the static overlays now that the grid has landed
    this.clearStickySprites();
  }

  private clearStickySprites(): void {
    for (const c of this.stickyWildSprites) {
      c.destroy({ children: true });
    }
    this.stickyWildSprites = [];
  }

  /** Get the current reel container offset for overlay positioning */
  private getOffset(): { x: number; y: number } {
    return this.gridView.getReelContainerOffset();
  }

  // ── Highlight clusters ──
  private async phaseHighlightClusters(spinResult: DeathSpinResult): Promise<void> {
    const step = this.cellSize + this.padding;
    const offset = this.getOffset();
    const highlightOverlays: Graphics[] = [];

    // Only highlight cells that will be slashed
    for (const slash of spinResult.slashes) {
      for (const cell of slash.cells) {
        const g = new Graphics();
        g.roundRect(
          offset.x + cell.col * step,
          offset.y + cell.row * step,
          this.cellSize,
          this.cellSize,
          4
        );
        g.fill({ color: 0xff2222, alpha: 0.35 });
        g.stroke({ width: 2, color: 0xff4444 });
        g.alpha = 0;
        this.parent.addChild(g);
        highlightOverlays.push(g);
      }
    }

    // Fade in
    await tween(200, (t) => {
      for (const g of highlightOverlays) g.alpha = t;
    }, easeOutCubic);

    await wait(400);

    // Cleanup
    for (const g of highlightOverlays) {
      g.destroy();
    }
  }

  // ── Slash animation ──
  private async phaseSlashAnimation(spinResult: DeathSpinResult): Promise<void> {
    const step = this.cellSize + this.padding;
    const offset = this.getOffset();

    // Flash slashed cells red, then fade out
    const slashOverlays: Graphics[] = [];
    for (const cell of spinResult.slashedCells) {
      const g = new Graphics();
      g.roundRect(
        offset.x + cell.col * step,
        offset.y + cell.row * step,
        this.cellSize,
        this.cellSize,
        4
      );
      g.fill({ color: 0xff0000, alpha: 0.7 });
      this.parent.addChild(g);
      slashOverlays.push(g);

      // Also dim the sprite underneath
      const sprites = this.reelSpinners[cell.col]?.getVisibleSprites();
      const sprite = sprites?.[cell.row];
      if (sprite) sprite.alpha = 0.3;
    }

    // Flash effect
    await wait(150);

    // Fade out slashed cells
    await tween(300, (t) => {
      for (const g of slashOverlays) {
        g.alpha = 0.7 * (1 - t);
      }
      // Fade out sprites
      for (const cell of spinResult.slashedCells) {
        const sprites = this.reelSpinners[cell.col]?.getVisibleSprites();
        const sprite = sprites?.[cell.row];
        if (sprite) sprite.alpha = 0.3 * (1 - t);
      }
    }, easeOutCubic);

    // Remove overlays
    for (const g of slashOverlays) g.destroy();

    await wait(200);
  }

  // ── Refill animation ──
  private async phaseRefillAnimation(spinResult: DeathSpinResult): Promise<void> {
    // Use setSymbols to properly update the reel spinners cell-by-cell
    // First, rebuild the full column symbols from the transformed grid
    for (let col = 0; col < this.cols; col++) {
      if (!spinResult.transformedGrid[col]) continue;
      const symbolIds = spinResult.transformedGrid[col].map(cell => cell.symbolId);
      this.reelSpinners[col].setSymbols(symbolIds, false);
    }

    // Now hide the refill cells and animate them appearing
    for (const cell of spinResult.refillCells) {
      const sprites = this.reelSpinners[cell.col]?.getVisibleSprites();
      const sprite = sprites?.[cell.row];
      if (sprite) {
        sprite.alpha = 0;
      }
    }

    // Staggered fade-in of new symbols
    const stagger = 40;
    const fadePromises: Promise<void>[] = [];
    for (let i = 0; i < spinResult.refillCells.length; i++) {
      const cell = spinResult.refillCells[i];
      const delayMs = i * stagger;

      fadePromises.push(
        wait(delayMs).then(() => {
          const sprites = this.reelSpinners[cell.col]?.getVisibleSprites();
          const sprite = sprites?.[cell.row];
          if (sprite) {
            return tween(200, (t) => {
              sprite.alpha = t;
            }, easeOutCubic);
          }
        })
      );
    }

    await Promise.all(fadePromises);

    // Ensure all sprites are fully visible
    for (const cell of spinResult.refillCells) {
      const sprites = this.reelSpinners[cell.col]?.getVisibleSprites();
      const sprite = sprites?.[cell.row];
      if (sprite) {
        sprite.alpha = 1;
      }
    }
  }

  // ── Reap Bar ──
  private createReapBar(totalWidth: number, deathResult: DeathResult): void {
    this.reapBarContainer = new Container();
    this.reapBarContainer.y = -35;

    const barWidth = 200;
    const barHeight = 16;
    const barX = totalWidth - barWidth - 10;

    // Background
    const bg = new Graphics();
    bg.roundRect(barX, 0, barWidth, barHeight, 4);
    bg.fill({ color: 0x1a0000, alpha: 0.8 });
    bg.stroke({ width: 1, color: 0x661111 });
    this.reapBarContainer.addChild(bg);

    // Fill
    this.reapBarFill = new Graphics();
    this.reapBarContainer.addChild(this.reapBarFill);
    // Store barX in userData for updates
    this.reapBarFill.x = barX;

    // Text label
    this.reapBarText = new Text({
      text: `REAP: 0 / ${deathResult.reapThresholds[0]}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 14,
        fill: 0xff6666,
        stroke: { color: 0x000000, width: 2 },
      }),
    });
    this.reapBarText.anchor.set(1, 0.5);
    this.reapBarText.x = barX - 8;
    this.reapBarText.y = barHeight / 2;
    this.reapBarContainer.addChild(this.reapBarText);

    this.overlayContainer.addChild(this.reapBarContainer);
  }

  private updateReapBar(deathResult: DeathResult): void {
    if (!this.reapBarFill || !this.reapBarText) return;

    const barWidth = 200;
    const barHeight = 16;
    const barX = 0; // relative to the fill container

    // Determine current threshold
    const nextThresholdIdx = deathResult.currentExpansion;
    const currentThreshold = nextThresholdIdx < deathResult.reapThresholds.length
      ? deathResult.reapThresholds[nextThresholdIdx]
      : deathResult.reapThresholds[deathResult.reapThresholds.length - 1];
    const prevThreshold = nextThresholdIdx > 0
      ? deathResult.reapThresholds[nextThresholdIdx - 1]
      : 0;

    const progress = Math.min(
      (deathResult.reapBar - prevThreshold) / (currentThreshold - prevThreshold),
      1
    );
    const fillWidth = barWidth * Math.max(0, progress);

    this.reapBarFill.clear();
    if (fillWidth > 0) {
      this.reapBarFill.roundRect(barX, 0, fillWidth, barHeight, 4);
      this.reapBarFill.fill({ color: 0xcc2222, alpha: 0.9 });
    }

    const label = nextThresholdIdx >= deathResult.reapThresholds.length
      ? `REAP: ${deathResult.reapBar} (MAX)`
      : `REAP: ${deathResult.reapBar} / ${currentThreshold}`;
    this.reapBarText.text = label;

    // Pulse animation on reap bar
    tween(300, (t) => {
      if (this.reapBarContainer) {
        this.reapBarContainer.scale.set(1 + 0.05 * Math.sin(t * Math.PI));
      }
    }, easeOutCubic);
  }

  // ── Expansion animation ──
  private async phaseExpansionAnimation(deathResult: DeathResult, totalWidth: number): Promise<void> {
    // Flash the entire grid with a red pulse
    const flash = new Graphics();
    flash.rect(0, 0, totalWidth, this.rows * (this.cellSize + this.padding) - this.padding);
    flash.fill({ color: 0xff2222, alpha: 0.4 });
    this.parent.addChild(flash);

    // Show expansion text
    const expandText = new Text({
      text: `GRID EXPANDED: ${deathResult.gridCols}×${deathResult.gridRows}\n+1 BONUS SPIN!`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 28,
        fill: 0xff4444,
        stroke: { color: 0x000000, width: 4 },
        letterSpacing: 2,
      }),
    });
    expandText.anchor.set(0.5);
    expandText.x = totalWidth / 2;
    expandText.y = (this.rows * (this.cellSize + this.padding) - this.padding) / 2;
    expandText.alpha = 0;
    this.parent.addChild(expandText);

    // Animate
    await tween(400, (t) => {
      flash.alpha = 0.4 * (1 - t);
      expandText.alpha = Math.min(1, t * 2);
      expandText.scale.set(0.5 + 0.5 * easeOutCubic(t));
    }, easeOutCubic);

    await wait(800);

    // Fade out
    await tween(300, (t) => {
      expandText.alpha = 1 - t;
    }, easeOutCubic);

    flash.destroy();
    expandText.destroy();
  }

  // ── Spin Counter Display ──
  private async showSpinCounter(spinNum: number, total: number, totalWidth: number): Promise<void> {
    if (this.spinCounterText) {
      this.overlayContainer.removeChild(this.spinCounterText);
      this.spinCounterText.destroy();
    }

    this.spinCounterText = new Text({
      text: `DEATH SPINS ${spinNum} / ${total}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 22,
        fill: 0xff4444,
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    this.spinCounterText.anchor.set(0.5, 0);
    this.spinCounterText.x = totalWidth / 2;
    this.spinCounterText.y = -40;
    this.overlayContainer.addChild(this.spinCounterText);

    // Brief flash animation
    await tween(300, (t) => {
      this.spinCounterText!.alpha = t;
      this.spinCounterText!.scale.set(0.8 + 0.2 * t);
    }, easeOutCubic);
  }

  // ── Sticky WILD overlays ──
  private showStickyWildOverlays(stickyWilds: { col: number; row: number }[]): void {
    const step = this.cellSize + this.padding;
    const offset = this.getOffset();

    for (const wild of stickyWilds) {
      if (wild.col >= this.cols || wild.row >= this.rows) continue;

      const g = new Graphics();
      const x = offset.x + wild.col * step;
      const y = offset.y + wild.row * step;

      // Golden glow border around sticky WILD cells
      g.roundRect(x - 2, y - 2, this.cellSize + 4, this.cellSize + 4, 6);
      g.stroke({ width: 3, color: 0xffdd00 });
      g.fill({ color: 0xffdd00, alpha: 0.12 });

      // Small lock indicator in the corner
      const label = new Text({
        text: '🔒',
        style: new TextStyle({
          fontSize: Math.max(10, Math.floor(this.cellSize * 0.14)),
        }),
      });
      label.anchor.set(1, 0);
      label.x = x + this.cellSize - 2;
      label.y = y + 2;
      g.addChild(label);

      this.parent.addChild(g);
      this.stickyWildOverlays.push(g);
    }
  }

  private clearStickyWildOverlays(): void {
    for (const g of this.stickyWildOverlays) {
      g.destroy({ children: true });
    }
    this.stickyWildOverlays = [];
  }

  // ── Cleanup ──
  private cleanupOverlay(): void {
    if (this.spinCounterText) {
      this.spinCounterText.destroy();
      this.spinCounterText = null;
    }
    if (this.reapBarContainer) {
      this.reapBarContainer.destroy({ children: true });
      this.reapBarContainer = null;
      this.reapBarFill = null;
      this.reapBarText = null;
    }
    this.clearStickyWildOverlays();
    this.clearStickySprites();
    this.overlayContainer.removeChildren();
    this.parent.removeChild(this.overlayContainer);

    // Restore all sprite visibility
    for (let col = 0; col < this.cols; col++) {
      const sprites = this.reelSpinners[col].getVisibleSprites();
      for (const sprite of sprites) {
        sprite.alpha = 1;
      }
    }
  }

  dispose(): void {
    this.cleanupOverlay();
  }
}
