import { Container } from 'pixi.js';
import { FeatureTrigger, Grid } from '../Types';
import { FoolResult } from '../logic/TarotFeatureProcessor';
import { ReelSpinner } from './ReelSpinner';
import { ThreeBackground } from '../../threeBackground';
import { playTarotTearEffects } from './TearEffectHelper';
import { wait, spawnDarkParticleGlow } from '../utils/AnimationUtils';
import { soundManager } from '../utils/SoundManager';

// ═══════════════════════════════════════════════════════════════
//  FoolRevealAnimation
//  Orchestrates the Fool-feature reveal:
//    Hide Fools → Cell Reveal → Multiplier
// ═══════════════════════════════════════════════════════════════
export class FoolRevealAnimation {
  private overlay: Container;
  private particleContainer: Container;
  private glowContainer: Container;
  

  constructor(
    private parent: Container,
    private reelSpinners: ReelSpinner[],
    _assetLoader: unknown,
    private cellSize: number,
    private padding: number,
    _cols: number,
    private rows: number,
    private threeBg: ThreeBackground | null = null,
    private pixiCanvas: HTMLCanvasElement | null = null,
  ) {
    this.overlay = new Container();
    this.particleContainer = new Container();
    this.glowContainer = new Container();
  }

  // ── Public entry point ────────────────────────────────────
  async play(
    feature: FeatureTrigger,
    foolResult: FoolResult,
    finalGrid: Grid,
    _multiplier: number,
    _wins: any[],
    _totalWin: number,
    _betAmount: number
  ): Promise<void> {

    // Mount overlay layers onto parent (GridView)
    this.parent.addChild(this.overlay);
    this.overlay.addChild(this.glowContainer);
    this.overlay.addChild(this.particleContainer);

    try {
      // Phase A — Tear away tarot cards (symbols already visible underneath)
      await this.phaseHideFools(feature, finalGrid);

      // Phase B — Sequential cell reveal with pop-in animations
      await this.phaseReveal(feature, foolResult, finalGrid);

      // Win display is handled by Phase 2.9 in main.ts (outline first, then win screen)
    } finally {
      this.cleanup();
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

  private spawnWildGlow(col: number, row: number, _step: number): void {
    soundManager.play('symbol-glow', 0.4);
    spawnDarkParticleGlow(this.glowContainer, col, row, this.cellSize, this.padding);
  }

  // ── Tear down all temporary display objects ──────────────
  private cleanup(): void {
    this.parent.removeChild(this.overlay);
    this.overlay.removeChildren();

    // Destroy children in sub-containers
    while (this.particleContainer.children.length) {
      this.particleContainer.children[0].destroy();
    }
    while (this.glowContainer.children.length) {
      this.glowContainer.children[0].destroy();
    }

    
  }
}
