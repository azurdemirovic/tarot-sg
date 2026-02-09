import { RNG } from './RNG';
import { AssetLoader } from './AssetLoader';
import { SpinGenerator } from './logic/SpinGenerator';
import { PaylineEvaluator } from './logic/PaylineEvaluator';
import { TarotFeatureProcessor, FoolResult, CupsResult } from './logic/TarotFeatureProcessor';
import { Grid, TarotColumn, FeatureTrigger, GameMode, WinLine } from './Types';

export interface SpinOutput {
  /** The initial grid as landed (before feature transformation) */
  initialGrid: Grid;
  tarotColumns: TarotColumn[];
  /** Non-null when 2+ same-type tarots trigger a feature */
  feature: FeatureTrigger | null;
  /** If Fool triggered, details of the transformation */
  foolResult: FoolResult | null;
  /** If Cups triggered, details of the initial multipliers */
  cupsResult: CupsResult | null;
  /** The final grid used for payline evaluation (after feature, if any) */
  finalGrid: Grid;
  wins: WinLine[];
  totalWin: number;
  multiplier: number;
}

export class GameController {
  private rng: RNG;
  private spinGenerator: SpinGenerator;
  private paylineEvaluator: PaylineEvaluator;
  private featureProcessor: TarotFeatureProcessor;
  private mode: GameMode = 'BASE';
  private currentGrid: Grid | null = null;
  private lastTarotColumns: TarotColumn[] = [];
  private lastWins: WinLine[] = [];

  // Game state
  public balance: number = 100.00; // EUR
  public betAmount: number = 0.20; // EUR (0.008 per line × 25 paylines)
  public lastWin: number = 0;
  public isSpinning: boolean = false;

  constructor(
    private assetLoader: AssetLoader,
    seed: number = Date.now()
  ) {
    this.rng = new RNG(seed);
    this.spinGenerator = new SpinGenerator(this.rng, this.assetLoader);
    this.paylineEvaluator = new PaylineEvaluator(this.assetLoader);
    this.featureProcessor = new TarotFeatureProcessor(this.rng, this.assetLoader);
  }

  /**
   * Perform a spin — returns everything main.ts needs for the two-phase animation.
   */
  spin(): SpinOutput {
    if (this.isSpinning) {
      console.warn('Spin already in progress');
      return this.buildEmptyOutput();
    }

    if (this.balance < this.betAmount) {
      console.warn('Insufficient balance');
      return this.buildEmptyOutput();
    }

    this.isSpinning = true;
    this.balance -= this.betAmount;

    // ── Phase 1: generate raw grid (with possible tarot columns) ──
    const { grid: initialGrid, tarotColumns } = this.spinGenerator.generateSpin(5, 3, 0.8);
    this.currentGrid = initialGrid;
    this.lastTarotColumns = tarotColumns;

    // Deep-clone grid so the initial version stays untouched
    const finalGrid: Grid = initialGrid.map(col =>
      col.map(cell => ({ ...cell }))
    );

    // ── Phase 2: detect & apply tarot feature ──
    const feature = this.featureProcessor.detectTrigger(tarotColumns);
    let foolResult: FoolResult | null = null;
    let cupsResult: CupsResult | null = null;
    let multiplier = 1;

    if (feature) {
      console.log(`🃏 Tarot Feature Detected: ${feature.type} ×${feature.count} (cols ${feature.columns.join(',')})`);

      if (feature.type === 'T_FOOL') {
        foolResult = this.featureProcessor.applyFool(finalGrid, feature);
        multiplier = foolResult.multiplier;
      } else if (feature.type === 'T_CUPS') {
        cupsResult = this.featureProcessor.applyCups(finalGrid, feature);
        // Cups feature doesn't apply multiplier during initial spin
        // The multiplier collection loop will be handled in the animation
      }
      // Other features (Lovers, Priestess, Death) → future implementation
    }

    // ── Phase 3: evaluate paylines on the *final* grid ──
    const wins = this.paylineEvaluator.evaluateAllPaylines(finalGrid);
    this.lastWins = wins;

    const baseWin = wins.reduce((sum, win) => sum + win.payout, 0);
    const totalWin = baseWin * multiplier;
    this.lastWin = totalWin;
    this.balance += totalWin;

    // Logging
    if (wins.length > 0) {
      console.log(`🎉 ${wins.length} Payline Win(s):`);
      wins.forEach(win => {
        console.log(`  Payline ${win.paylineIndex + 1}: ${win.matchCount}× ${win.symbol} = ${win.payout.toFixed(4)} EUR`);
      });
      if (multiplier > 1) {
        console.log(`  💫 Base win: ${baseWin.toFixed(4)} × ${multiplier} = ${totalWin.toFixed(4)} EUR`);
      }
      console.log(`💰 Total Win: ${totalWin.toFixed(4)} EUR`);
    } else {
      console.log('No wins this spin');
    }

    this.isSpinning = false;

    return {
      initialGrid,
      tarotColumns,
      feature,
      foolResult,
      cupsResult,
      finalGrid,
      wins,
      totalWin,
      multiplier,
    };
  }

  private buildEmptyOutput(): SpinOutput {
    return {
      initialGrid: this.currentGrid!,
      tarotColumns: this.lastTarotColumns,
      feature: null,
      foolResult: null,
      cupsResult: null,
      finalGrid: this.currentGrid!,
      wins: this.lastWins,
      totalWin: this.lastWin,
      multiplier: 1,
    };
  }

  /**
   * Force a specific tarot configuration (debug)
   */
  forceTarotSpin(tarotType: string, columns: number[]): SpinOutput {
    this.balance -= this.betAmount;

    const { grid: initialGrid, tarotColumns } = this.spinGenerator.generateSpinWithTarots(tarotType, columns);
    this.currentGrid = initialGrid;
    this.lastTarotColumns = tarotColumns;

    const finalGrid: Grid = initialGrid.map(col => col.map(cell => ({ ...cell })));

    const feature = this.featureProcessor.detectTrigger(tarotColumns);
    let foolResult: FoolResult | null = null;
    let cupsResult: CupsResult | null = null;
    let multiplier = 1;

    if (feature && feature.type === 'T_FOOL') {
      foolResult = this.featureProcessor.applyFool(finalGrid, feature);
      multiplier = foolResult.multiplier;
    } else if (feature && feature.type === 'T_CUPS') {
      cupsResult = this.featureProcessor.applyCups(finalGrid, feature);
    }

    const wins = this.paylineEvaluator.evaluateAllPaylines(finalGrid);
    this.lastWins = wins;

    const baseWin = wins.reduce((sum, win) => sum + win.payout, 0);
    const totalWin = baseWin * multiplier;
    this.lastWin = totalWin;
    this.balance += totalWin;

    this.isSpinning = false;

    return { initialGrid, tarotColumns, feature, foolResult, cupsResult, finalGrid, wins, totalWin, multiplier };
  }

  getSeed(): number { return this.rng.getState(); }
  setSeed(seed: number): void { this.rng.setState(seed); }
  getMode(): GameMode { return this.mode; }
  getCurrentGrid(): Grid | null { return this.currentGrid; }
  getLastTarotColumns(): TarotColumn[] { return this.lastTarotColumns; }
  getLastWins(): WinLine[] { return this.lastWins; }

  formatTarotsDebug(): string {
    if (this.lastTarotColumns.length === 0) return 'None';
    const grouped = new Map<string, number[]>();
    for (const tarot of this.lastTarotColumns) {
      if (!grouped.has(tarot.tarotType)) grouped.set(tarot.tarotType, []);
      grouped.get(tarot.tarotType)!.push(tarot.col + 1);
    }
    const parts: string[] = [];
    grouped.forEach((cols, type) => {
      const simpleName = type.replace('T_', '');
      parts.push(`${simpleName} (R${cols.join(',')})`);
    });
    return parts.join(' | ');
  }

  getCurrentSeed(): number {
    return this.rng.getState();
  }

  getGrid(): Grid {
    return this.currentGrid!;
  }
}
