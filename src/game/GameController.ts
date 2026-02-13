import { RNG } from './RNG';
import { AssetLoader } from './AssetLoader';
import { SpinGenerator } from './logic/SpinGenerator';
import { PaylineEvaluator } from './logic/PaylineEvaluator';
import { TarotFeatureProcessor, FoolResult, CupsResult, LoversResult, LoversSpinResult, PriestessResult, PriestessSpinResult, DeathResult, DeathSpinResult } from './logic/TarotFeatureProcessor';
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
  /** If Lovers triggered, details of the bond fill */
  loversResult: LoversResult | null;
  /** If Priestess triggered, details of the mystery mode */
  priestessResult: PriestessResult | null;
  /** If Death triggered, details of the reaping mode */
  deathResult: DeathResult | null;
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
    this.paylineEvaluator.currentBetAmount = this.betAmount;

    // ── Phase 1: generate raw grid (with possible tarot columns) ──
    const { grid: initialGrid, tarotColumns } = this.spinGenerator.generateSpin(5, 3, 0.05);
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
    let loversResult: LoversResult | null = null;
    let priestessResult: PriestessResult | null = null;
    let deathResult: DeathResult | null = null;
    let multiplier = 1;

    if (feature) {
      console.log(`🃏 Tarot Feature Detected: ${feature.type} ×${feature.count} (cols ${feature.columns.join(',')})`);

      if (feature.type === 'T_FOOL') {
        foolResult = this.featureProcessor.applyFool(finalGrid, feature);
        multiplier = foolResult.multiplier;
      } else if (feature.type === 'T_CUPS') {
        cupsResult = this.featureProcessor.applyCups(finalGrid, feature);
      } else if (feature.type === 'T_LOVERS') {
        loversResult = this.featureProcessor.applyLovers(finalGrid, feature);
        multiplier = loversResult.multiplier;
        // Grid is NOT filled yet — deferred until player picks a card
      } else if (feature.type === 'T_PRIESTESS') {
        priestessResult = this.featureProcessor.applyPriestess(finalGrid, feature);
        multiplier = priestessResult.multiplier;
        // Grid is NOT transformed yet — deferred to per-spin mystery reveal
      } else if (feature.type === 'T_DEATH') {
        deathResult = this.featureProcessor.applyDeath(finalGrid, feature);
        // Grid transforms are deferred to per-spin slash/refill
      }
    }

    // ── Phase 3: evaluate paylines on the *final* grid ──
    // Skip evaluation for Lovers/Priestess/Death — grid transforms are deferred
    const deferredFeatures = ['T_LOVERS', 'T_PRIESTESS', 'T_DEATH'];
    const wins = (feature && deferredFeatures.includes(feature.type))
      ? []
      : this.paylineEvaluator.evaluateAllPaylines(finalGrid);
    this.lastWins = wins;

    const baseWin = wins.reduce((sum, win) => sum + win.payout, 0);
    const totalWin = baseWin * multiplier;
    this.lastWin = totalWin;
    if (feature && !deferredFeatures.includes(feature.type)) {
      this.balance += totalWin;
    } else if (!feature) {
      this.balance += totalWin;
    }

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
      loversResult,
      priestessResult,
      deathResult,
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
      loversResult: null,
      priestessResult: null,
      deathResult: null,
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
    this.paylineEvaluator.currentBetAmount = this.betAmount;

    const { grid: initialGrid, tarotColumns } = this.spinGenerator.generateSpinWithTarots(tarotType, columns);
    this.currentGrid = initialGrid;
    this.lastTarotColumns = tarotColumns;

    const finalGrid: Grid = initialGrid.map(col => col.map(cell => ({ ...cell })));

    const feature = this.featureProcessor.detectTrigger(tarotColumns);
    let foolResult: FoolResult | null = null;
    let cupsResult: CupsResult | null = null;
    let loversResult: LoversResult | null = null;
    let priestessResult: PriestessResult | null = null;
    let deathResult: DeathResult | null = null;
    let multiplier = 1;

    if (feature && feature.type === 'T_FOOL') {
      foolResult = this.featureProcessor.applyFool(finalGrid, feature);
      multiplier = foolResult.multiplier;
    } else if (feature && feature.type === 'T_CUPS') {
      cupsResult = this.featureProcessor.applyCups(finalGrid, feature);
    } else if (feature && feature.type === 'T_LOVERS') {
      loversResult = this.featureProcessor.applyLovers(finalGrid, feature);
      multiplier = loversResult.multiplier;
    } else if (feature && feature.type === 'T_PRIESTESS') {
      priestessResult = this.featureProcessor.applyPriestess(finalGrid, feature);
      multiplier = priestessResult.multiplier;
    } else if (feature && feature.type === 'T_DEATH') {
      deathResult = this.featureProcessor.applyDeath(finalGrid, feature);
    }

    // Skip evaluation for deferred features
    const deferredFeatures = ['T_LOVERS', 'T_PRIESTESS', 'T_DEATH'];
    const wins = (feature && deferredFeatures.includes(feature.type))
      ? []
      : this.paylineEvaluator.evaluateAllPaylines(finalGrid);
    this.lastWins = wins;

    const baseWin = wins.reduce((sum, win) => sum + win.payout, 0);
    const totalWin = baseWin * multiplier;
    this.lastWin = totalWin;
    if (!feature || !deferredFeatures.includes(feature.type)) {
      this.balance += totalWin;
    }

    this.isSpinning = false;

    return { initialGrid, tarotColumns, feature, foolResult, cupsResult, loversResult, priestessResult, deathResult, finalGrid, wins, totalWin, multiplier };
  }

  /**
   * Generate 3 candidate bond symbols for a Lovers spin.
   */
  generateLoversCandidates(): string[] {
    return this.featureProcessor.generateLoversCandidates();
  }

  /**
   * Apply a single Lovers spin selection (after player picks a card).
   * Places MALE and FEMALE anchors, fills the bounding area with bond symbol.
   * Re-evaluates paylines and returns updated results.
   */
  applyLoversSpinSelection(
    finalGrid: Grid,
    loversResult: LoversResult,
    candidateSymbols: string[],
    selectedIndex: number
  ): { spinResult: LoversSpinResult; wins: WinLine[]; totalWin: number; multiplier: number } {
    // Ensure bet amount is current for payline evaluation
    this.paylineEvaluator.currentBetAmount = this.betAmount;

    // Apply the selection to the grid
    const spinResult = this.featureProcessor.applyLoversSpinSelection(
      finalGrid, loversResult, candidateSymbols, selectedIndex
    );

    // Re-evaluate paylines on the updated grid
    const wins = this.paylineEvaluator.evaluateAllPaylines(finalGrid);
    const baseWin = wins.reduce((sum, win) => sum + win.payout, 0);
    const multiplier = loversResult.multiplier;
    const totalWin = baseWin * multiplier;

    // Update game state
    this.lastWins = wins;
    this.lastWin = totalWin;
    this.balance += totalWin;

    if (wins.length > 0) {
      console.log(`🎉 Lovers Spin ${loversResult.spinsTotal - loversResult.spinsRemaining}/${loversResult.spinsTotal}: ${wins.length} Payline Win(s), Total: ${totalWin.toFixed(4)} EUR`);
    }

    return { spinResult, wins, totalWin, multiplier };
  }

  /**
   * Apply a Lovers spin selection — called from main.ts after player picks a card.
   * Wraps applyLoversSpinSelection with the signature main.ts expects.
   */
  applyLoversSelection(
    finalGrid: Grid,
    _feature: FeatureTrigger,
    loversResult: LoversResult,
    selectedIndex: number
  ): { spinResult: LoversSpinResult; finalGrid: Grid; wins: WinLine[]; totalWin: number; multiplier: number } {
    const candidates = loversResult.currentSpin?.candidateSymbols
      ?? this.featureProcessor.generateLoversCandidates();
    const result = this.applyLoversSpinSelection(finalGrid, loversResult, candidates, selectedIndex);
    return {
      spinResult: result.spinResult,
      finalGrid: finalGrid,
      wins: result.wins,
      totalWin: result.totalWin,
      multiplier: result.multiplier,
    };
  }

  /**
   * Generate a fresh random grid (no tarot columns) for Lovers multi-spin.
   * Each spin starts on a completely new board.
   */
  generateFreshGrid(): Grid {
    const { grid } = this.spinGenerator.generateSpin(5, 3, 0); // 0 tarot chance
    this.currentGrid = grid;
    return grid.map(col => col.map(cell => ({ ...cell }))); // deep clone
  }

  /**
   * Apply a single Priestess spin: place mystery covers, pick symbol, reveal.
   * Called per-spin during the Priestess multi-spin feature.
   * Balance is NOT updated here — only tracked. Total payout is applied at the end in main.ts.
   */
  applyPriestessSpin(
    grid: Grid,
    priestessResult: PriestessResult,
    existingMysteryCells?: { col: number; row: number }[]
  ): { spinResult: PriestessSpinResult; wins: WinLine[]; totalWin: number; multiplier: number } {
    this.paylineEvaluator.currentBetAmount = this.betAmount;

    const spinResult = this.featureProcessor.applyPriestessSpin(grid, priestessResult, existingMysteryCells);

    // Evaluate paylines on the transformed grid
    const wins = this.paylineEvaluator.evaluateAllPaylines(grid);
    const baseWin = wins.reduce((sum, win) => sum + win.payout, 0);
    const multiplier = priestessResult.multiplier;
    const totalWin = baseWin * multiplier;

    this.lastWins = wins;
    this.lastWin = totalWin;
    // NOTE: Balance is NOT updated here — total payout applied at feature end

    if (wins.length > 0) {
      console.log(`🔮 Priestess Spin ${priestessResult.spinsTotal - priestessResult.spinsRemaining}/${priestessResult.spinsTotal}: ${wins.length} Win(s), Total: ${totalWin.toFixed(4)} EUR`);
    }

    return { spinResult, wins, totalWin, multiplier };
  }

  /**
   * Generate a fresh random grid for Death multi-spin (variable size).
   * Sticky WILDs are placed first, then remaining cells are filled randomly.
   */
  generateDeathGrid(cols: number, rows: number, stickyWilds: { col: number; row: number }[] = []): Grid {
    const { grid } = this.spinGenerator.generateSpin(cols, rows, 0); // 0 tarot chance

    // Overwrite sticky WILD positions — these persist across spins
    for (const wild of stickyWilds) {
      if (wild.col < cols && wild.row < rows && grid[wild.col]) {
        grid[wild.col][wild.row] = { col: wild.col, row: wild.row, symbolId: 'WILD' };
      }
    }

    this.currentGrid = grid;
    return grid.map(col => col.map(cell => ({ ...cell }))); // deep clone
  }

  /**
   * Apply a single Death spin: detect clusters, slash, refill, check expansion.
   * Uses cluster-based payouts (not paylines).
   * Called per-spin during the Death multi-spin feature.
   */
  applyDeathSpin(
    grid: Grid,
    deathResult: DeathResult
  ): { spinResult: DeathSpinResult; totalWin: number } {
    const spinResult = this.featureProcessor.applyDeathSpin(grid, deathResult, this.betAmount);

    // Sum cluster-based payouts (no paylines for Death)
    const totalWin = spinResult.clusterWins.reduce((sum, cw) => sum + cw.payout, 0);

    this.lastWins = [];
    this.lastWin = totalWin;

    if (spinResult.clusterWins.length > 0) {
      console.log(`💀 Death Spin ${deathResult.spinsTotal - deathResult.spinsRemaining}/${deathResult.spinsTotal}: ${spinResult.clusterWins.length} Cluster Win(s), Total: ${totalWin.toFixed(4)} EUR`);
    }

    return { spinResult, totalWin };
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
