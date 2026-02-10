import { Container, Graphics, Sprite } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';
import { FeatureTrigger, Grid } from '../Types';
import { FoolResult } from '../logic/TarotFeatureProcessor';
import { ReelSpinner } from './ReelSpinner';
import { WinDisplay } from './WinDisplay';
import { ThreeBackground } from '../../threeBackground';
import { playTarotTearEffects } from './TearEffectHelper';

// ─── Easing helpers ───────────────────────────────────────────
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function linear(t: number): number {
  return t;
}

// ─── Tween utility (requestAnimationFrame based) ─────────────
function tween(
  duration: number,
  onUpdate: (t: number) => void,
  easing: (t: number) => number = easeInOutQuad
): Promise<void> {
  return new Promise(resolve => {
    const start = performance.now();
    function frame(now: number) {
      const elapsed = now - start;
      const raw = Math.min(elapsed / duration, 1);
      const t = easing(raw);
      onUpdate(t);
      if (raw < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
//  FoolRevealAnimation
//  Orchestrates the Fool-feature reveal:
//    Hide Fools → Cell Reveal → Multiplier
// ═══════════════════════════════════════════════════════════════
export class FoolRevealAnimation {
  private overlay: Container;
  private dimGraphic: Graphics;
  private particleContainer: Container;
  private glowContainer: Container;
  

  constructor(
    private parent: Container,
    private reelSpinners: ReelSpinner[],
    private assetLoader: AssetLoader,
    private cellSize: number,
    private padding: number,
    private cols: number,
    private rows: number,
    private threeBg: ThreeBackground | null = null,
    private pixiCanvas: HTMLCanvasElement | null = null
  ) {
    this.overlay = new Container();
    this.dimGraphic = new Graphics();
    this.particleContainer = new Container();
    this.glowContainer = new Container();
  }

  // ── Public entry point ────────────────────────────────────
  async play(
    feature: FeatureTrigger,
    foolResult: FoolResult,
    finalGrid: Grid,
    multiplier: number,
    wins: any[],
    totalWin: number,
    betAmount: number
  ): Promise<void> {
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Mount overlay layers onto parent (GridView)
    this.parent.addChild(this.overlay);
    this.overlay.addChild(this.glowContainer);
    this.overlay.addChild(this.particleContainer);

    try {
      // Phase A — Tear away tarot cards (symbols already visible underneath)
      await this.phaseHideFools(feature, finalGrid);

      // Phase B — Sequential cell reveal with pop-in animations
      await this.phaseReveal(feature, foolResult, finalGrid);

      // Phase C — Show win display (only if win > bet × 10)
      const winDisplay = new WinDisplay(this.parent);
      await winDisplay.show(wins, multiplier, totalWin, betAmount, totalWidth, totalHeight);
    } finally {
      this.cleanup();
    }
  }

  // ── Phase A: Screen Dim ──────────────────────────────────
  private async phaseDim(tw: number, th: number): Promise<void> {
    await tween(300, (t) => {
      this.dimGraphic.clear();
      this.dimGraphic.rect(-40, -40, tw + 80, th + 80);
      this.dimGraphic.fill({ color: 0x000000, alpha: t * 0.45 });
    }, easeInOutQuad);
  }

  // ── Phase B: Shake Fool Columns ──────────────────────────
  private async phaseShake(columns: number[]): Promise<void> {
    // Store originals
    const origins = columns.map(col => ({
      col,
      x: this.reelSpinners[col].x,
      y: this.reelSpinners[col].y,
    }));

    const startTime = performance.now();

    await tween(700, (_t) => {
      // Use real clock for smooth, rapid oscillation
      const now = performance.now();
      const elapsed = (now - startTime) / 1000; // seconds

      // Intensity ramps up then spikes at the end
      let intensity: number;
      if (_t < 0.7) {
        intensity = (_t / 0.7) * 6;          // 0 → 6 px
      } else {
        intensity = 6 + ((_t - 0.7) / 0.3) * 6; // 6 → 12 px (building to burst)
      }

      for (const o of origins) {
        const reel = this.reelSpinners[o.col];
        // Two different frequencies make the shake feel organic
        reel.x = o.x + Math.sin(elapsed * 55) * intensity * (0.7 + Math.random() * 0.3);
        reel.y = o.y + Math.cos(elapsed * 43) * intensity * 0.35;
      }
    }, linear);

    // Snap back
    for (const o of origins) {
      this.reelSpinners[o.col].x = o.x;
      this.reelSpinners[o.col].y = o.y;
    }
  }

  // ── Phase A: Hide Fool Columns (with tear effect) ────────
  private async phaseHideFools(feature: FeatureTrigger, finalGrid: Grid): Promise<void> {
    // Build map of final symbols for each tarot column so they're visible under the tear
    const finalSymbolIds = new Map<number, string[]>();
    for (const col of feature.columns) {
      finalSymbolIds.set(col, finalGrid[col].map(cell => cell.symbolId));
    }

    if (this.threeBg && this.pixiCanvas) {
      await playTarotTearEffects(
        this.threeBg,
        feature.columns,
        feature.type,
        this.reelSpinners,
        this.cellSize,
        this.padding,
        this.rows,
        this.pixiCanvas,
        finalSymbolIds
      );
    } else {
      // Fallback: set symbols directly
      for (const col of feature.columns) {
        this.reelSpinners[col].setSymbols(finalSymbolIds.get(col)!, false);
        this.reelSpinners[col].setColumnVisible(true);
      }
    }
  }

  // ── Phase D: Post-tear effects (WILD glows only) ─────────
  // Symbols are already visible from the tear — no pop-in needed.
  private async phaseReveal(
    feature: FeatureTrigger,
    foolResult: FoolResult,
    _finalGrid: Grid
  ): Promise<void> {
    const step = this.cellSize + this.padding;

    // Ensure columns are visible
    for (const col of feature.columns) {
      this.reelSpinners[col].setColumnVisible(true);
    }

    // Spawn WILD glow effects with stagger
    const sortedCols = [...feature.columns].sort((a, b) => a - b);
    const stagger = 100; // ms between glow spawns
    const allDone: Promise<void>[] = [];
    let idx = 0;

    for (const col of sortedCols) {
      for (let row = 0; row < this.rows; row++) {
        const isWild = foolResult.wildPlacements.some(
          wp => wp.col === col && wp.row === row
        );
        if (isWild) {
          const delayMs = idx * stagger;
          allDone.push(
            wait(delayMs).then(() => {
              this.spawnWildGlow(col, row, step);
            })
          );
          idx++;
        }
      }
    }

    await Promise.all(allDone);
    // Small pause after glows for visual clarity
    if (allDone.length > 0) await wait(300);
  }

  // ── Spawn golden glow ring behind a WILD cell ────────────
  private spawnWildGlow(col: number, row: number, step: number): void {
    const cx = col * step + this.cellSize / 2;
    const cy = row * step + this.cellSize / 2;

    const glow = new Graphics();
    glow.x = cx;
    glow.y = cy;
    this.glowContainer.addChild(glow);

    // Animate glow: expand ring with fading alpha
    tween(500, (t) => {
      glow.clear();
      const radius = this.cellSize * 0.35 * (0.6 + t * 0.4);
      const alpha = t < 0.3 ? (t / 0.3) * 0.55 : 0.55 * (1 - (t - 0.3) / 0.7) + 0.08;
      glow.circle(0, 0, radius);
      glow.fill({ color: 0xFFD700, alpha });
    }, easeOutCubic);
  }

  // ── Tear down all temporary display objects ──────────────
  private cleanup(): void {
    this.parent.removeChild(this.overlay);
    this.overlay.removeChildren();
    this.dimGraphic.clear();

    // Destroy children in sub-containers
    while (this.particleContainer.children.length) {
      this.particleContainer.children[0].destroy();
    }
    while (this.glowContainer.children.length) {
      this.glowContainer.children[0].destroy();
    }

    
  }
}
