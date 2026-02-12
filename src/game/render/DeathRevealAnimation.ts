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
      // Start tear (don't await — reels start scrolling immediately alongside the tear)
      const tearPromise = this.phaseTearTarots(feature);

      // ── Phase A2: Show reap bar ──
      this.createReapBar(totalWidth, deathResult);

      // ── Phase B: Multi-spin loop ──
      let isFirstSpin = true;
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
        // On first spin, run concurrently with the tear; otherwise just spin
        if (isFirstSpin) {
          await Promise.all([tearPromise, this.phaseSpinFreshGrid(freshGrid, deathResult.stickyWilds)]);
          isFirstSpin = false;
        } else {
          await this.phaseSpinFreshGrid(freshGrid, deathResult.stickyWilds);
        }

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

        // B8: If grid expanded, animate the grid growing and show expansion notification
        if (spinResult.expanded) {
          this.clearStickyWildOverlays();

          // Capture old grid dimensions for scale animation
          const oldCols = this.cols;
          const oldRows = this.rows;
          const oldCellSize = this.cellSize;
          const oldPadding = this.padding;
          const oldWidth = oldCols * (oldCellSize + oldPadding) - oldPadding;
          const oldHeight = oldRows * (oldCellSize + oldPadding) - oldPadding;

          // Resize the grid data immediately (but we'll animate the visual)
          this.gridView.resizeGrid(deathResult.gridCols, deathResult.gridRows);
          // Update our local references after resize
          this.cellSize = this.gridView.getCellSize();
          this.padding = this.gridView.getPadding();
          this.cols = this.gridView.getCols();
          this.rows = this.gridView.getRows();
          this.reelSpinners = this.gridView.getReelSpinners();

          // Show the new grid with current symbols
          this.gridView.updateGrid(spinResult.transformedGrid);

          // Calculate new grid dimensions
          const newWidth = this.cols * (this.cellSize + this.padding) - this.padding;
          const newHeight = this.rows * (this.cellSize + this.padding) - this.padding;

          // Start the grid at old scale and animate to new scale
          const scaleX = oldWidth / newWidth;
          const scaleY = oldHeight / newHeight;
          this.gridView.scale.set(scaleX, scaleY);

          // Re-show sticky WILDs at new positions/sizes
          this.showStickyWildOverlays(deathResult.stickyWilds);

          // Animate grid growth alongside the expansion notification
          await this.phaseExpansionAnimation(deathResult, totalWidth, scaleX, scaleY);
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

        // Pause before next spin (slower transitions)
        await wait(800);
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

        // WILD sprite from asset loader (no background — symbol only)
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

  // ── Highlight clusters (replaced with slash trail — no-op) ──
  private async phaseHighlightClusters(_spinResult: DeathSpinResult): Promise<void> {
    // Intentionally empty — slash trail handles the visual
  }

  // ── Slash animation (glowy red trail effect) ──
  private async phaseSlashAnimation(spinResult: DeathSpinResult): Promise<void> {
    const step = this.cellSize + this.padding;
    const offset = this.getOffset();
    const halfCell = this.cellSize / 2;

    // Animate each slash as a glowing red trail from first to last cell
    for (const slash of spinResult.slashes) {
      if (slash.cells.length === 0) continue;

      // Build waypoints: center of each cell in order
      const points = slash.cells.map(cell => ({
        x: offset.x + cell.col * step + halfCell,
        y: offset.y + cell.row * step + halfCell,
      }));

      // Calculate total path length for even speed
      let totalLength = 0;
      const segments: number[] = [0];
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        totalLength += Math.sqrt(dx * dx + dy * dy);
        segments.push(totalLength);
      }

      // Many glow layers for an intense, wide, glowy trail
      const trailLayers: Graphics[] = [];
      const layerCount = 10;
      for (let l = 0; l < layerCount; l++) {
        const g = new Graphics();
        this.parent.addChild(g);
        trailLayers.push(g);
      }

      // Slash trail animates fast
      const slashDuration = 180 + slash.cells.length * 35;
      const trailFadeDuration = 500;

      // Helper: get point at distance along path
      const getPointAtDist = (dist: number) => {
        for (let i = 1; i < segments.length; i++) {
          if (dist <= segments[i]) {
            const segStart = segments[i - 1];
            const segLen = segments[i] - segStart;
            const localT = segLen > 0 ? (dist - segStart) / segLen : 0;
            return {
              x: points[i - 1].x + (points[i].x - points[i - 1].x) * localT,
              y: points[i - 1].y + (points[i].y - points[i - 1].y) * localT,
            };
          }
        }
        return points[points.length - 1];
      };

      // Build intermediate path points helper
      const buildPath = (g: Graphics, tailDist: number, headDist: number) => {
        const tail = getPointAtDist(tailDist);
        const head = getPointAtDist(headDist);
        g.moveTo(tail.x, tail.y);
        for (let i = 1; i < points.length; i++) {
          if (segments[i] > tailDist && segments[i] < headDist) {
            g.lineTo(points[i].x, points[i].y);
          }
        }
        g.lineTo(head.x, head.y);
      };

      // Phase 1: Trail races through cells — dark demonic slash
      await tween(slashDuration, (t) => {
        for (const g of trailLayers) g.clear();

        const headDist = t * totalLength;
        const trailLength = totalLength * 0.7;
        const tailDist = Math.max(0, headDist - trailLength);
        const head = getPointAtDist(headDist);

        // Flicker factor — irregular pulsing for organic, fire-like feel
        const flicker = 0.85 + 0.15 * Math.sin(t * 47) * Math.cos(t * 31);

        // Layer 0: Wide dark shadow — the slash tears darkness into the scene
        buildPath(trailLayers[0], tailDist, headDist);
        trailLayers[0].stroke({ width: 110, color: 0x000000, alpha: 0.15 * flicker, cap: 'round', join: 'round' });

        // Layer 1: Dark crimson outer haze
        buildPath(trailLayers[1], tailDist, headDist);
        trailLayers[1].stroke({ width: 80, color: 0x330000, alpha: 0.18 * flicker, cap: 'round', join: 'round' });

        // Layer 2: Deep blood-red smoke
        buildPath(trailLayers[2], tailDist, headDist);
        trailLayers[2].stroke({ width: 56, color: 0x550000, alpha: 0.22 * flicker, cap: 'round', join: 'round' });

        // Layer 3: Dark red glow
        buildPath(trailLayers[3], tailDist, headDist);
        trailLayers[3].stroke({ width: 38, color: 0x880000, alpha: 0.3 * flicker, cap: 'round', join: 'round' });

        // Layer 4: Crimson fire
        buildPath(trailLayers[4], tailDist, headDist);
        trailLayers[4].stroke({ width: 26, color: 0xaa0000, alpha: 0.35 * flicker, cap: 'round', join: 'round' });

        // Layer 5: Hot ember red
        buildPath(trailLayers[5], tailDist, headDist);
        trailLayers[5].stroke({ width: 18, color: 0xcc1100, alpha: 0.4 * flicker, cap: 'round', join: 'round' });

        // Layer 6: Bright ember
        buildPath(trailLayers[6], tailDist, headDist);
        trailLayers[6].stroke({ width: 10, color: 0xdd2200, alpha: 0.5 * flicker, cap: 'round', join: 'round' });

        // Layer 7: Orange-red fire edge
        buildPath(trailLayers[7], tailDist, headDist);
        trailLayers[7].stroke({ width: 5, color: 0xee3300, alpha: 0.55 * flicker, cap: 'round', join: 'round' });

        // Layer 8: Dark core — the wound itself is dark, not bright
        buildPath(trailLayers[8], tailDist, headDist);
        trailLayers[8].stroke({ width: 3, color: 0x220000, alpha: 0.7, cap: 'round', join: 'round' });

        // Layer 9: Thin black scar center
        buildPath(trailLayers[9], tailDist, headDist);
        trailLayers[9].stroke({ width: 1.5, color: 0x110000, alpha: 0.8, cap: 'round', join: 'round' });

        // Dark ember orb at head — smoldering, not shining
        trailLayers[9].circle(head.x, head.y, 30);
        trailLayers[9].fill({ color: 0x000000, alpha: 0.12 * flicker });
        trailLayers[9].circle(head.x, head.y, 20);
        trailLayers[9].fill({ color: 0x440000, alpha: 0.2 * flicker });
        trailLayers[9].circle(head.x, head.y, 12);
        trailLayers[9].fill({ color: 0x881100, alpha: 0.35 * flicker });
        trailLayers[9].circle(head.x, head.y, 6);
        trailLayers[9].fill({ color: 0xcc2200, alpha: 0.5 * flicker });
        trailLayers[9].circle(head.x, head.y, 2);
        trailLayers[9].fill({ color: 0xdd3300, alpha: 0.7 });
      }, easeOutCubic);

      // Dim slashed cell sprites as the trail completes
      for (const cell of slash.cells) {
        const sprites = this.reelSpinners[cell.col]?.getVisibleSprites();
        const sprite = sprites?.[cell.row];
        if (sprite) sprite.alpha = 0.3;
      }

      // Phase 2: Trail fades out, sprites fade out
      await tween(trailFadeDuration, (t) => {
        for (const g of trailLayers) g.alpha = 1 - t;
        for (const cell of slash.cells) {
          const sprites = this.reelSpinners[cell.col]?.getVisibleSprites();
          const sprite = sprites?.[cell.row];
          if (sprite) sprite.alpha = 0.3 * (1 - t);
        }
      }, easeOutCubic);

      // Cleanup trail layers
      for (const g of trailLayers) g.destroy();
    }

    await wait(100);
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

  // ── Reap Bar (vertical, left side) ──
  private reapBarHeight: number = 0; // stored for updates

  private createReapBar(_totalWidth: number, deathResult: DeathResult): void {
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;
    const barWidth = 40;
    const barHeight = totalHeight;
    this.reapBarHeight = barHeight;

    this.reapBarContainer = new Container();
    // Position on the left side, just outside the grid area (inside the frame border)
    this.reapBarContainer.x = -barWidth - 70;
    this.reapBarContainer.y = 0;

    // Background track
    const bg = new Graphics();
    bg.roundRect(0, 0, barWidth, barHeight, 6);
    bg.fill({ color: 0x1a0000, alpha: 0.8 });
    bg.stroke({ width: 1, color: 0x661111 });
    this.reapBarContainer.addChild(bg);

    // Threshold tick marks
    const maxThreshold = deathResult.reapThresholds[deathResult.reapThresholds.length - 1];
    for (const threshold of deathResult.reapThresholds) {
      const tickY = barHeight * (1 - threshold / maxThreshold);
      const tick = new Graphics();
      tick.moveTo(-3, tickY);
      tick.lineTo(barWidth + 3, tickY);
      tick.stroke({ width: 1.5, color: 0xff4444, alpha: 0.6 });
      this.reapBarContainer.addChild(tick);
    }

    // Fill (grows from bottom up)
    this.reapBarFill = new Graphics();
    this.reapBarContainer.addChild(this.reapBarFill);

    // Text label (rotated, alongside the bar)
    this.reapBarText = new Text({
      text: `REAP 0/${deathResult.reapThresholds[0]}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 13,
        fill: 0xff6666,
        stroke: { color: 0x000000, width: 2 },
      }),
    });
    this.reapBarText.anchor.set(0.5, 0.5);
    this.reapBarText.rotation = -Math.PI / 2;
    this.reapBarText.x = barWidth / 2;
    this.reapBarText.y = barHeight / 2;
    this.reapBarContainer.addChild(this.reapBarText);

    this.overlayContainer.addChild(this.reapBarContainer);
  }

  private updateReapBar(deathResult: DeathResult): void {
    if (!this.reapBarFill || !this.reapBarText) return;

    const barWidth = 40;
    const barHeight = this.reapBarHeight;
    const maxThreshold = deathResult.reapThresholds[deathResult.reapThresholds.length - 1];

    // Overall progress across all thresholds
    const overallProgress = Math.min(deathResult.reapBar / maxThreshold, 1);
    const fillHeight = barHeight * Math.max(0, overallProgress);

    this.reapBarFill.clear();
    if (fillHeight > 0) {
      // Fill grows from bottom up
      this.reapBarFill.roundRect(0, barHeight - fillHeight, barWidth, fillHeight, 6);
      this.reapBarFill.fill({ color: 0xcc2222, alpha: 0.9 });
    }

    // Determine current threshold for label
    const nextThresholdIdx = deathResult.currentExpansion;
    const currentThreshold = nextThresholdIdx < deathResult.reapThresholds.length
      ? deathResult.reapThresholds[nextThresholdIdx]
      : maxThreshold;

    const label = nextThresholdIdx >= deathResult.reapThresholds.length
      ? `REAP ${deathResult.reapBar} MAX`
      : `REAP ${deathResult.reapBar}/${currentThreshold}`;
    this.reapBarText.text = label;

    // Pulse animation on reap bar
    tween(300, (t) => {
      if (this.reapBarContainer) {
        this.reapBarContainer.scale.set(1 + 0.05 * Math.sin(t * Math.PI));
      }
    }, easeOutCubic);
  }

  // ── Expansion animation (with grid growth) ──
  private async phaseExpansionAnimation(
    deathResult: DeathResult,
    totalWidth: number,
    startScaleX: number = 1,
    startScaleY: number = 1
  ): Promise<void> {
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Flash the entire grid with a red pulse
    const flash = new Graphics();
    flash.rect(0, 0, totalWidth, totalHeight);
    flash.fill({ color: 0xff2222, alpha: 0.5 });
    this.parent.addChild(flash);

    // Show expansion text — large and prominent
    const expandText = new Text({
      text: `GRID EXPANDED\n${deathResult.gridCols}×${deathResult.gridRows}\n+1 BONUS SPIN!`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 56,
        fill: 0xff4444,
        stroke: { color: 0x000000, width: 6 },
        letterSpacing: 3,
        align: 'center',
      }),
    });
    expandText.anchor.set(0.5);
    expandText.x = totalWidth / 2;
    expandText.y = totalHeight / 2;
    expandText.alpha = 0;
    this.parent.addChild(expandText);

    // Animate text pop-in + grid scale growth together
    await tween(800, (t) => {
      // Flash fades
      flash.alpha = 0.5 * (1 - t * 0.5);
      // Text fades in and scales up
      expandText.alpha = Math.min(1, t * 2.5);
      expandText.scale.set(0.3 + 0.7 * easeOutCubic(t));
      // Grid grows from old size to new size
      const scaleX = startScaleX + (1 - startScaleX) * easeOutCubic(t);
      const scaleY = startScaleY + (1 - startScaleY) * easeOutCubic(t);
      this.gridView.scale.set(scaleX, scaleY);
    }, easeOutCubic);

    // Ensure grid is at full scale
    this.gridView.scale.set(1, 1);

    await wait(800);

    // Fade out text and flash
    await tween(400, (t) => {
      expandText.alpha = 1 - t;
      flash.alpha = 0.25 * (1 - t);
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
  private showStickyWildOverlays(_stickyWilds: { col: number; row: number }[]): void {
    // No overlay — sticky WILDs are just left as-is on the grid
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
