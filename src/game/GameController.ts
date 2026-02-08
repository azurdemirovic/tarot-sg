import { RNG } from './RNG';
import { AssetLoader } from './AssetLoader';
import { SpinGenerator } from './logic/SpinGenerator';
import { PaylineEvaluator } from './logic/PaylineEvaluator';
import { Grid, TarotColumn, GameMode, WinLine } from './Types';

export class GameController {
  private rng: RNG;
  private spinGenerator: SpinGenerator;
  private paylineEvaluator: PaylineEvaluator;
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
  }

  /**
   * Perform a spin
   */
  spin(): { grid: Grid, tarotColumns: TarotColumn[], wins: WinLine[], totalWin: number } {
    if (this.isSpinning) {
      console.warn('Spin already in progress');
      return { 
        grid: this.currentGrid!, 
        tarotColumns: this.lastTarotColumns,
        wins: this.lastWins,
        totalWin: this.lastWin
      };
    }

    if (this.balance < this.betAmount) {
      console.warn('Insufficient balance');
      return { 
        grid: this.currentGrid!, 
        tarotColumns: this.lastTarotColumns,
        wins: this.lastWins,
        totalWin: this.lastWin
      };
    }

    this.isSpinning = true;
    this.balance -= this.betAmount;

    // Generate spin result (tarotChance 0.5 = 50% for testing)
    const { grid, tarotColumns } = this.spinGenerator.generateSpin(5, 3, 0.5);
    this.currentGrid = grid;
    this.lastTarotColumns = tarotColumns;

    // Evaluate all paylines for wins
    const wins = this.paylineEvaluator.evaluateAllPaylines(grid);
    this.lastWins = wins;

    // Calculate total payout
    const totalWin = wins.reduce((sum, win) => sum + win.payout, 0);
    this.lastWin = totalWin;
    this.balance += totalWin;

    // Log wins for debugging
    if (wins.length > 0) {
      console.log(`🎉 ${wins.length} Payline Win(s):`);
      wins.forEach(win => {
        console.log(`  Payline ${win.paylineIndex + 1}: ${win.matchCount} ${win.symbol} = ${win.payout} credits`);
      });
      console.log(`💰 Total Win: ${totalWin} credits`);
    } else {
      console.log('No wins this spin');
    }

    this.isSpinning = false;

    return { grid, tarotColumns, wins, totalWin };
  }

  /**
   * Force a specific tarot configuration (debug)
   */
  forceTarotSpin(tarotType: string, columns: number[]): { grid: Grid, tarotColumns: TarotColumn[], wins: WinLine[], totalWin: number } {
    this.balance -= this.betAmount;
    
    const { grid, tarotColumns } = this.spinGenerator.generateSpinWithTarots(tarotType, columns);
    this.currentGrid = grid;
    this.lastTarotColumns = tarotColumns;

    // Evaluate paylines even for forced spins
    const wins = this.paylineEvaluator.evaluateAllPaylines(grid);
    this.lastWins = wins;

    const totalWin = wins.reduce((sum, win) => sum + win.payout, 0);
    this.lastWin = totalWin;
    this.balance += totalWin;

    this.isSpinning = false;

    return { grid, tarotColumns, wins, totalWin };
  }

  /**
   * Get current seed for debugging
   */
  getSeed(): number {
    return this.rng.getState();
  }

  /**
   * Set RNG seed
   */
  setSeed(seed: number): void {
    this.rng.setState(seed);
  }

  /**
   * Get current game mode
   */
  getMode(): GameMode {
    return this.mode;
  }

  /**
   * Get current grid
   */
  getCurrentGrid(): Grid | null {
    return this.currentGrid;
  }

  /**
   * Get last tarot columns
   */
  getLastTarotColumns(): TarotColumn[] {
    return this.lastTarotColumns;
  }

  /**
   * Get last wins
   */
  getLastWins(): WinLine[] {
    return this.lastWins;
  }

  /**
   * Format tarots for debug display
   */
  formatTarotsDebug(): string {
    if (this.lastTarotColumns.length === 0) return 'None';
    
    const grouped = new Map<string, number[]>();
    for (const tarot of this.lastTarotColumns) {
      if (!grouped.has(tarot.tarotType)) {
        grouped.set(tarot.tarotType, []);
      }
      grouped.get(tarot.tarotType)!.push(tarot.col + 1); // 1-indexed for display
    }

    const parts: string[] = [];
    grouped.forEach((cols, type) => {
      const simpleName = type.replace('T_', '');
      parts.push(`${simpleName} (R${cols.join(',')})`);
    });

    return parts.join(' | ');
  }
}
