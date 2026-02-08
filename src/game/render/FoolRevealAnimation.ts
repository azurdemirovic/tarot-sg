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
    multiplier: number
  ): Promise<void> {
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Mount overlay layers onto parent (GridView)
    this.parent.addChild(this.overlay);
    this.overlay.addChild(this.glowContainer);
    this.overlay.addChild(this.particleContainer);

    try {
      // Phase A — Hide Fool columns and prepare for reveal
      await this.phaseHideFools(feature);

      // Phase B — Sequential cell reveal  (~120 ms × cells)
      await this.phaseReveal(feature, foolResult, finalGrid);

      await wait(250);

      // Phase E — Multiplier banner  (600 ms appear + 700 ms hold)
      await this.phaseMultiplier(multiplier, totalWidth, totalHeight);
      await wait(700);

      // Phase F — Fade out + cleanup  (400 ms)
      await this.phaseCleanup(totalWidth, totalHeight);
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
    
    // Brief pause before reveal
    await wait(200);
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

    // 3. Staggered reveal
    const stagger = 120;  // ms between each cell
    const popDuration = 350; // ms per cell pop-in

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

  // ── Phase E: Multiplier Banner ───────────────────────────
  private async phaseMultiplier(
    multiplier: number,
    tw: number,
    th: number
  ): Promise<void> {
    this.multiplierText = new Text({
      text: `×${multiplier}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 108,
        fill: 0xFFD700,
        stroke: { color: 0x000000, width: 8 },
        dropShadow: {
          color: 0x000000,
          blur: 12,
          distance: 4,
          alpha: 0.85,
        },
      }),
    });

    this.multiplierText.anchor.set(0.5);
    this.multiplierText.x = tw / 2;
    this.multiplierText.y = th / 2;
    this.multiplierText.scale.set(0);
    this.multiplierText.alpha = 0;
    this.overlay.addChild(this.multiplierText);

    // Scale-bounce: 0 → 1.35 → 1.0
    const text = this.multiplierText;
    await tween(600, (t) => {
      let s: number;
      if (t < 0.45) {
        s = easeOutBack(t / 0.45) * 1.35;
      } else {
        s = 1.35 - ((t - 0.45) / 0.55) * 0.35;
      }
      text.scale.set(s);
      text.alpha = Math.min(1, t * 4);
    }, easeOutCubic);

    text.scale.set(1);
    text.alpha = 1;
  }

  // ── Phase F: Fade Out ────────────────────────────────────
  private async phaseCleanup(tw: number, th: number): Promise<void> {
    await tween(400, (t) => {
      // Multiplier fades
      if (this.multiplierText) {
        this.multiplierText.alpha = 1 - t;
        this.multiplierText.scale.set(1 + t * 0.15); // Slight grow as it fades
      }

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
