/**
 * PriestessRevealAnimation — Handles the High Priestess feature animation.
 *
 * Flow:
 *  1. Tear away Priestess tarot columns
 *  2. Multi-spin loop (6 or 9 spins) — AUTO-SPINS, no button clicks needed:
 *     a. Spin fresh grid with natural drop (hurry-up via spin button)
 *     b. Re-show persistent mystery covers from previous spins
 *     c. Add new mystery covers (1-3 per spin, accumulate)
 *     d. Suspense pause
 *     e. Reveal: all mystery covers flip to show the mystery symbol
 *     f. Show per-spin win via WinDisplay (same as Lovers)
 *  3. Show total payout via WinDisplay with count-up animation
 */

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';
import { FeatureTrigger, Grid, WinLine } from '../Types';
import { PriestessResult, PriestessSpinResult } from '../logic/TarotFeatureProcessor';
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
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class PriestessRevealAnimation {
  private mysteryOverlays: Map<string, Container> = new Map(); // key: "col,row"
  /** All persistent mystery cell positions accumulated across spins */
  private persistentMysteryCells: { col: number; row: number }[] = [];
  /** Whether a hurry-up has been requested for the current reel spin */
  // @ts-ignore -- tracked for potential future use (e.g. skip remaining animation phases)
  private hurryUpRequested: boolean = false;
  /** Whether the reel spin phase is active (hurry-up is allowed) */
  private reelSpinActive: boolean = false;
  /** Spin counter text overlay */
  private spinCounterText: Text | null = null;
  /** Overlay container for spin counter */
  private overlayContainer: Container;

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

  /**
   * Request hurry-up for the current reel spin animation.
   * Called from main.ts when the spin button is pressed during the feature.
   */
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
    priestessResult: PriestessResult,
    onGenerateFreshGrid: () => Grid,
    onApplyPriestessSpin: (
      grid: Grid,
      existingMysteryCells: { col: number; row: number }[]
    ) => {
      spinResult: PriestessSpinResult;
      wins: WinLine[];
      totalWin: number;
      multiplier: number;
    },
    betAmount: number
  ): Promise<number> {
    let totalPayout = 0;

    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Mount overlay for spin counter
    this.parent.addChild(this.overlayContainer);

    try {
      // ── Phase A: Tear away Priestess tarot columns ──
      await this.phaseTearTarots(feature);

      // ── Phase B: Multi-spin loop (auto-spins, no button clicks) ──
      while (priestessResult.spinsRemaining > 0) {
        const spinNum = priestessResult.spinsTotal - priestessResult.spinsRemaining + 1;
        console.log(`🔮 Priestess Spin ${spinNum}/${priestessResult.spinsTotal}`);

        // Show spin counter
        await this.showSpinCounter(spinNum, priestessResult.spinsTotal, totalWidth);

        // B1: Generate fresh grid and determine mystery placements BEFORE spinning
        const freshGrid = onGenerateFreshGrid();

        // Apply mystery logic first — so we know ALL mystery positions before spinning
        const { spinResult, wins, totalWin } = onApplyPriestessSpin(
          freshGrid,
          this.persistentMysteryCells
        );

        // B2: Spin the grid — mystery cells stay hidden throughout (overlay covers them)
        await this.phaseSpinFreshGrid(freshGrid, spinResult.mysteryCells);

        // B4: Animate only NEW mystery covers popping in (persistent ones already have overlays)
        await this.phaseShowNewMysteryCovers(spinResult.newMysteryCells);

        // B4: Suspense pause
        await wait(800);

        // B5: Reveal — flip ALL mystery covers to show the mystery symbol
        await this.phaseRevealMystery(spinResult);

        // B6: Update persistent cells with all mystery cells from this spin
        this.persistentMysteryCells = [...spinResult.mysteryCells];

        // B7: Accumulate payout
        if (wins.length > 0 && totalWin > 0) {
          totalPayout += totalWin;
        }

        // B8: Show per-spin win using WinDisplay (only if win > 10× bet, same as Lovers/Fool)
        const winDisplay = new WinDisplay(this.parent);
        await winDisplay.show(
          wins,
          priestessResult.multiplier,
          totalWin,
          betAmount,
          totalWidth,
          totalHeight
        );

        // B9: Reverse the reveal — flip all revealed symbols back to mystery covers
        await this.phaseUnrevealMystery(spinResult);

        // Brief pause before next spin
        await wait(300);
      }

      // ── Phase C: Show total payout via WinDisplay (only if > 10× bet) ──
      if (totalPayout > 0) {
        const winDisplay = new WinDisplay(this.parent);
        const syntheticWins = [{ payout: totalPayout }];
        await winDisplay.show(
          syntheticWins,
          1, // multiplier already factored into totalPayout
          totalPayout,
          betAmount,
          totalWidth,
          totalHeight,
          10, // standard 10× bet threshold
          2000
        );
      }
    } finally {
      // Final cleanup — restore all reel sprite visibility
      for (let col = 0; col < this.cols; col++) {
        const sprites = this.reelSpinners[col].getVisibleSprites();
        for (const sprite of sprites) {
          sprite.alpha = 1;
        }
      }
      this.clearMysteryOverlays();
      this.cleanupOverlay();
    }

    return totalPayout;
  }

  // ── Phase A: Tear away Priestess tarot columns ──
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

  // ── Phase B1: Spin fresh grid with natural drop (hurry-up supported) ──
  // mysteryCellsToHide: cells where sprites must stay invisible throughout spin+bounce
  private async phaseSpinFreshGrid(freshGrid: Grid, mysteryCellsToHide: { col: number; row: number }[] = []): Promise<void> {
    for (let col = 0; col < this.cols; col++) {
      this.reelSpinners[col].setColumnVisible(true);
    }

    // Mark reel spin as active — hurry-up is allowed during this window
    this.reelSpinActive = true;
    this.hurryUpRequested = false;

    // Continuously hide mystery cell sprites during the entire spin+bounce animation
    let spinDone = false;
    if (mysteryCellsToHide.length > 0) {
      const hideLoop = () => {
        for (const cell of mysteryCellsToHide) {
          const sprites = this.reelSpinners[cell.col].getVisibleSprites();
          const sprite = sprites[cell.row];
          if (sprite) sprite.alpha = 0;
        }
        if (!spinDone) requestAnimationFrame(hideLoop);
      };
      requestAnimationFrame(hideLoop);
    }

    await this.gridView.spinColumnsToGrid(freshGrid);
    spinDone = true;

    // Final ensure hidden after spin settles
    for (const cell of mysteryCellsToHide) {
      const sprites = this.reelSpinners[cell.col].getVisibleSprites();
      const sprite = sprites[cell.row];
      if (sprite) sprite.alpha = 0;
    }

    // Reel spin complete — disable hurry-up
    this.reelSpinActive = false;
    this.hurryUpRequested = false;
  }

  // (Mystery overlays stay visible at all times during the feature — no hide/show needed)

  // ── Phase B4: Animate only new mystery covers ──
  private async phaseShowNewMysteryCovers(
    newCells: { col: number; row: number }[]
  ): Promise<void> {
    if (newCells.length === 0) return;

    const stagger = 120;

    for (let i = 0; i < newCells.length; i++) {
      const cell = newCells[i];
      if (i > 0) await wait(stagger);
      await this.createMysteryOverlay(cell.col, cell.row, true);
    }

    // Wait for last animation to settle
    await wait(200);
  }

  // ── Create mystery cover content (MYSTERY.png sprite — fully covers the cell) ──
  private addMysteryCoverContent(container: Container): void {
    const coverSize = this.cellSize;
    const mysteryTexture = this.assetLoader.getTexture('MYSTERY');
    if (mysteryTexture) {
      const sprite = new Sprite(mysteryTexture);
      sprite.anchor.set(0.5);
      sprite.width = coverSize;
      sprite.height = coverSize;
      container.addChild(sprite);
    } else {
      // Fallback if texture not loaded
      const bg = new Graphics();
      bg.roundRect(-coverSize / 2, -coverSize / 2, coverSize, coverSize, 8);
      bg.fill({ color: 0x2a1050 });
      bg.stroke({ width: 2, color: 0x9a4de6 });
      container.addChild(bg);

      const style = new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: Math.max(11, this.cellSize * 0.11),
        fontWeight: 'bold',
        fill: '#c084fc',
        align: 'center',
        letterSpacing: 1,
      });
      const text = new Text({ text: 'MYSTERY', style });
      text.anchor.set(0.5);
      container.addChild(text);
    }
  }

  // ── Create a single mystery overlay ──
  private createMysteryOverlay(col: number, row: number, animated: boolean): Promise<void> {
    const key = `${col},${row}`;
    // Don't duplicate
    if (this.mysteryOverlays.has(key)) return Promise.resolve();

    const step = this.cellSize + this.padding;

    const cover = new Container();
    cover.x = col * step + this.cellSize / 2;
    cover.y = row * step + this.cellSize / 2;

    this.addMysteryCoverContent(cover);

    this.parent.addChild(cover);
    this.mysteryOverlays.set(key, cover);

    if (animated) {
      cover.scale.set(0);
      cover.alpha = 0;
      return tween(300, (t) => {
        const s = easeOutBack(t);
        cover.scale.set(s);
        cover.alpha = Math.min(1, t * 2);
      });
    } else {
      cover.scale.set(1);
      cover.alpha = 1;
      return Promise.resolve();
    }
  }

  // ── Phase B5: Reveal all mystery covers (flip to show symbol) ──
  private async phaseRevealMystery(spinResult: PriestessSpinResult): Promise<void> {
    const { mysteryCells, mysterySymbolId } = spinResult;
    if (mysteryCells.length === 0) return;

    const symbolSize = this.cellSize - 20;
    const stagger = 60;
    const texture = this.assetLoader.getTexture(mysterySymbolId);

    for (let i = 0; i < mysteryCells.length; i++) {
      const cell = mysteryCells[i];
      const key = `${cell.col},${cell.row}`;
      const overlay = this.mysteryOverlays.get(key);
      if (!overlay) continue;

      if (i > 0) await wait(stagger);

      // Flip animation: shrink X → swap content → expand X
      await tween(150, (t) => {
        overlay.scale.x = 1 - t;
      }, easeOutCubic);

      // Swap content to revealed symbol
      overlay.removeChildren();

      if (texture) {
        const symbolSprite = new Sprite(texture);
        symbolSprite.anchor.set(0.5);
        symbolSprite.width = symbolSize;
        symbolSprite.height = symbolSize;
        overlay.addChild(symbolSprite);
      } else {
        const style = new TextStyle({
          fontFamily: 'CustomFont, Arial, sans-serif',
          fontSize: Math.max(10, this.cellSize * 0.1),
          fontWeight: 'bold',
          fill: '#ffffff',
          align: 'center',
        });
        const text = new Text({ text: mysterySymbolId, style });
        text.anchor.set(0.5);
        overlay.addChild(text);
      }

      // Expand back
      await tween(150, (t) => {
        overlay.scale.x = t;
      }, easeOutCubic);

      // Update the reel spinner cell underneath (keep hidden — overlay shows the symbol)
      const sprites = this.reelSpinners[cell.col].getVisibleSprites();
      const sprite = sprites[cell.row];
      if (sprite && texture) {
        sprite.texture = texture; // Set for payline evaluation
      }
    }

    // Brief hold to admire the reveal
    await wait(400);
  }

  // ── Phase B9: Un-reveal — flip all revealed symbols back to mystery covers ──
  private async phaseUnrevealMystery(spinResult: PriestessSpinResult): Promise<void> {
    const { mysteryCells } = spinResult;
    if (mysteryCells.length === 0) return;

    // Flip all revealed overlays back to mystery covers simultaneously
    // (faster than reveal — all at once, not staggered)
    const flips: Promise<void>[] = [];

    for (const cell of mysteryCells) {
      const key = `${cell.col},${cell.row}`;
      const overlay = this.mysteryOverlays.get(key);
      if (!overlay) continue;

      flips.push((async () => {
        // Shrink X
        await tween(120, (t) => {
          overlay.scale.x = 1 - t;
        }, easeOutCubic);

        // Swap content back to mystery cover
        overlay.removeChildren();
        this.addMysteryCoverContent(overlay);

        // Expand back
        await tween(120, (t) => {
          overlay.scale.x = t;
        }, easeOutCubic);
      })());
    }

    await Promise.all(flips);
  }

  // ── Spin Counter Display ─────────────────────────────────
  private async showSpinCounter(spinNum: number, total: number, totalWidth: number): Promise<void> {
    // Remove any previous counter
    if (this.spinCounterText) {
      this.overlayContainer.removeChild(this.spinCounterText);
      this.spinCounterText.destroy();
    }

    this.spinCounterText = new Text({
      text: `MYSTERY SPINS ${spinNum} / ${total}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 22,
        fill: 0xc084fc,
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

  // ── Cleanup ──
  private clearMysteryOverlays(): void {
    for (const [, overlay] of this.mysteryOverlays) {
      overlay.destroy({ children: true });
    }
    this.mysteryOverlays.clear();
  }

  private cleanupOverlay(): void {
    if (this.spinCounterText) {
      this.spinCounterText.destroy();
      this.spinCounterText = null;
    }
    this.overlayContainer.removeChildren();
    this.parent.removeChild(this.overlayContainer);
  }

  dispose(): void {
    this.clearMysteryOverlays();
    this.cleanupOverlay();
  }
}
