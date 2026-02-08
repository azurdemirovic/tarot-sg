import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';
import { FeatureTrigger, Grid } from '../Types';
import { FoolResult } from '../logic/TarotFeatureProcessor';
import { ReelSpinner } from './ReelSpinner';

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
  private multiplierText: Text | null = null;

  constructor(
    private parent: Container,
    private reelSpinners: ReelSpinner[],
    private assetLoader: AssetLoader,
    private cellSize: number,
    private padding: number,
    private cols: number,
    private rows: number
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
      // Phase A — Hide Fool columns
      await this.phaseHideFools(feature);

      // Phase B — Sequential cell reveal  (~120 ms × cells)
      await this.phaseReveal(feature, foolResult, finalGrid);

      // Phase C — Show win display (only if win > bet × 10)
      if (wins.length > 0 && totalWin > betAmount * 10) {
        await this.phaseWinDisplay(wins, multiplier, totalWin, totalWidth, totalHeight);
        await wait(1500); // Hold display
        await this.phaseCleanup(totalWidth, totalHeight);
      }
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

  // ── Phase A: Hide Fool Columns ───────────────────────────
  private async phaseHideFools(feature: FeatureTrigger): Promise<void> {
    // Simply hide the Fool tarot columns
    for (const col of feature.columns) {
      this.reelSpinners[col].setColumnVisible(false);
    }
  }

  // ── Phase D: Sequential Cell Reveal ──────────────────────
  private async phaseReveal(
    feature: FeatureTrigger,
    foolResult: FoolResult,
    finalGrid: Grid
  ): Promise<void> {
    const step = this.cellSize + this.padding;

    // 1. Set the new symbols on each Fool column (still invisible)
    const colSpriteData: {
      col: number;
      sprites: Sprite[];
      targetScales: { x: number; y: number }[];
    }[] = [];

    for (const col of feature.columns) {
      const symbolIds = finalGrid[col].map(cell => cell.symbolId);
      this.reelSpinners[col].setSymbols(symbolIds, false);
      this.reelSpinners[col].setColumnVisible(true);

      const sprites = this.reelSpinners[col].getVisibleSprites();
      const targetScales = sprites.map(s => ({ x: s.scale.x, y: s.scale.y }));

      // Start hidden
      for (const s of sprites) {
        s.scale.set(0);
        s.alpha = 0;
      }

      colSpriteData.push({ col, sprites, targetScales });
    }

    // 2. Build reveal order: columns left→right, rows top→bottom
    const sortedCols = [...feature.columns].sort((a, b) => a - b);
    const cellQueue: { col: number; row: number; isWild: boolean }[] = [];

    for (const col of sortedCols) {
      for (let row = 0; row < this.rows; row++) {
        const isWild = foolResult.wildPlacements.some(
          wp => wp.col === col && wp.row === row
        );
        cellQueue.push({ col, row, isWild });
      }
    }

    // 3. Staggered reveal (20% slower)
    const stagger = 144;  // ms between each cell (was 120, now 20% slower)
    const popDuration = 420; // ms per cell pop-in (was 350, now 20% slower)

    const allDone: Promise<void>[] = [];

    for (let i = 0; i < cellQueue.length; i++) {
      const cell = cellQueue[i];
      const delayMs = i * stagger;

      allDone.push(
        wait(delayMs).then(async () => {
          const data = colSpriteData.find(d => d.col === cell.col)!;
          const sprite = data.sprites[cell.row];
          const target = data.targetScales[cell.row];
          if (!sprite || !target) return;

          // WILD glow ring
          if (cell.isWild) {
            this.spawnWildGlow(cell.col, cell.row, step);
          }

          // Pop-in: scale 0 → 1.15 → 1.0 + quick alpha fade-in
          await tween(popDuration, (t) => {
            let s: number;
            if (t < 0.55) {
              s = easeOutBack(t / 0.55) * 1.12;
            } else {
              s = 1.12 - ((t - 0.55) / 0.45) * 0.12;
            }

            sprite.scale.set(target.x * s, target.y * s);
            sprite.alpha = Math.min(1, t * 3);
          }, easeOutCubic);

          // Ensure exact target
          sprite.scale.set(target.x, target.y);
          sprite.alpha = 1;
        })
      );
    }

    await Promise.all(allDone);
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

  // ── Phase C: Win Display (Grid Dim + Payout + Multiplier + Total) ──
  private async phaseWinDisplay(
    wins: any[],
    multiplier: number,
    totalWin: number,
    tw: number,
    th: number
  ): Promise<void> {
    // 1. Dim only the grid area (not full screen)
    this.dimGraphic.clear();
    this.dimGraphic.rect(0, 0, tw, th);
    this.dimGraphic.fill({ color: 0x000000, alpha: 0.6 });
    this.overlay.addChild(this.dimGraphic);

    // 2. Calculate base payline payout (before multiplier)
    const basePayout = wins.reduce((sum, win) => sum + win.payout, 0);

    // 3. Create payline payout text (center)
    const payoutText = new Text({
      text: `${basePayout.toFixed(2)} €`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 64,
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
    payoutText.anchor.set(0.5);
    payoutText.x = tw / 2 - 60; // Slightly left of center
    payoutText.y = th / 2 - 40; // Above center
    payoutText.alpha = 0;
    this.overlay.addChild(payoutText);

    // 4. Create multiplier text (next to payout)
    const multiplierText = new Text({
      text: `×${multiplier}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 64,
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
    multiplierText.x = tw / 2 + 60; // Slightly right of center
    multiplierText.y = th / 2 - 40; // Same height as payout
    multiplierText.alpha = 0;
    this.overlay.addChild(multiplierText);

    // 5. Create total win text (below, counting up, growing)
    const totalText = new Text({
      text: '0.00 €',
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 48,
        fill: 0xFFFFFF,
        stroke: { color: 0x000000, width: 5 },
        dropShadow: {
          color: 0x000000,
          blur: 10,
          distance: 4,
          alpha: 0.9,
        },
      }),
    });
    totalText.anchor.set(0.5);
    totalText.x = tw / 2;
    totalText.y = th / 2 + 30; // Below payout/multiplier
    totalText.alpha = 0;
    totalText.scale.set(0.8);
    this.overlay.addChild(totalText);
    this.multiplierText = totalText; // Store for cleanup

    // 6. Animate: fade in payout + multiplier, then count up total
    await tween(400, (t) => {
      payoutText.alpha = t;
      multiplierText.alpha = t;
    }, easeOutCubic);

    // 7. Count up total win while growing in size
    const countDuration = 1000;
    const start = performance.now();
    const startScale = 0.8;
    const endScale = 1.2;

    await new Promise<void>(resolve => {
      const frame = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / countDuration, 1);
        const ease = easeOutCubic(t);

        // Count up
        const currentValue = totalWin * ease;
        totalText.text = `${currentValue.toFixed(2)} €`;

        // Grow in size
        const scale = startScale + (endScale - startScale) * ease;
        totalText.scale.set(scale);

        // Fade in
        totalText.alpha = Math.min(1, t * 2);

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          totalText.text = `${totalWin.toFixed(2)} €`;
          totalText.scale.set(endScale);
          totalText.alpha = 1;
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  // ── Phase F: Fade Out ────────────────────────────────────
  private async phaseCleanup(tw: number, th: number): Promise<void> {
    await tween(400, (t) => {
      // Dim fades out
      this.dimGraphic.clear();
      this.dimGraphic.rect(0, 0, tw, th);
      this.dimGraphic.fill({ color: 0x000000, alpha: 0.6 * (1 - t) });

      // All text elements fade
      this.overlay.children.forEach((child) => {
        if (child instanceof Text) {
          child.alpha = 1 - t;
        }
      });

      // Glows fade
      this.glowContainer.alpha = 1 - t;
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

    if (this.multiplierText) {
      this.multiplierText.destroy();
      this.multiplierText = null;
    }
  }
}
