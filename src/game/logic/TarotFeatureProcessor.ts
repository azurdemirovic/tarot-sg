import { RNG } from '../RNG';
import { AssetLoader } from '../AssetLoader';
import { Grid, TarotColumn, FeatureTrigger } from '../Types';

export interface FoolResult {
  transformedGrid: Grid;
  multiplier: number;
  wildPlacements: { col: number; row: number }[];
  premiumPlacements: { col: number; row: number; symbolId: string }[];
}

export interface CupsResult {
  initialMultipliers: { col: number; row: number; value: number }[];
  cupsColumns: number[];
}

export interface LoversSpinResult {
  bondSymbolId: string;
  candidateSymbols: string[];   // 3 bond symbol options for player to pick from
  selectedIndex: number;        // index into candidateSymbols chosen by player (-1 = not yet selected)
  malePos: { col: number; row: number };
  femalePos: { col: number; row: number };
  filledCells: { col: number; row: number }[];
  boundingRect: { minCol: number; minRow: number; maxCol: number; maxRow: number };
  transformedGrid: Grid;
}

export interface LoversResult {
  spinsTotal: number;            // 3 (2 Lovers) or 6 (3 Lovers)
  spinsRemaining: number;
  multiplier: number;
  columns: number[];             // freed Lovers columns
  currentSpin: LoversSpinResult | null;  // result of the current spin's selection
}

export class TarotFeatureProcessor {
  constructor(
    private rng: RNG,
    private assetLoader: AssetLoader
  ) {}

  /**
   * Detect if 2+ same-type tarot columns landed → feature trigger.
   * Priority: DEATH > PRIESTESS > LOVERS > FOOL > CUPS
   */
  detectTrigger(tarotColumns: TarotColumn[]): FeatureTrigger | null {
    if (tarotColumns.length < 2) return null;

    // Group by type
    const grouped = new Map<string, number[]>();
    for (const tc of tarotColumns) {
      if (!grouped.has(tc.tarotType)) grouped.set(tc.tarotType, []);
      grouped.get(tc.tarotType)!.push(tc.col);
    }

    // Priority order (highest first)
    const priority = ['T_DEATH', 'T_PRIESTESS', 'T_LOVERS', 'T_FOOL', 'T_CUPS'];

    for (const type of priority) {
      const cols = grouped.get(type);
      if (cols && cols.length >= 2) {
        return { type, count: cols.length, columns: cols.sort((a, b) => a - b) };
      }
    }

    return null;
  }

  /**
   * Apply the Fool feature to the grid.
   *
   * 2 Fools → 1-3 wilds per column (equal weight), ×3 multiplier
   * 3+ Fools → 1-3 wilds per column (bias 2-3), ×5 multiplier
   * Wild cap: 9 total
   */
  applyFool(grid: Grid, trigger: FeatureTrigger): FoolResult {
    const rows = grid[0].length; // 3
    const premiumPool = this.assetLoader.getSymbolsByTier('PREMIUM');

    // 1. Roll wild count per column
    const perColWilds: number[] = [];
    for (let i = 0; i < trigger.columns.length; i++) {
      if (trigger.count === 2) {
        // Equal weight 1, 2, or 3
        perColWilds.push(this.rng.nextInt(1, 3));
      } else {
        // 3+ Fools: bias toward 2-3 (1=20%, 2=40%, 3=40%)
        const roll = this.rng.nextFloat();
        if (roll < 0.20) perColWilds.push(1);
        else if (roll < 0.60) perColWilds.push(2);
        else perColWilds.push(3);
      }
    }

    // 2. Enforce 9-wild cap
    let totalWilds = perColWilds.reduce((s, v) => s + v, 0);
    if (totalWilds > 9) {
      // Trim excess from last columns
      let excess = totalWilds - 9;
      for (let i = perColWilds.length - 1; i >= 0 && excess > 0; i--) {
        const reduce = Math.min(excess, perColWilds[i] - 1); // Keep at least 1
        perColWilds[i] -= reduce;
        excess -= reduce;
      }
      totalWilds = 9;
    }

    // 3. Place wilds + premiums in each Fool column
    const wildPlacements: { col: number; row: number }[] = [];
    const premiumPlacements: { col: number; row: number; symbolId: string }[] = [];

    trigger.columns.forEach((col, idx) => {
      const wildCount = perColWilds[idx];

      // Pick random rows to be WILD
      const rowIndices = Array.from({ length: rows }, (_, i) => i);
      this.rng.shuffle(rowIndices);
      const wildRows = new Set(rowIndices.slice(0, wildCount));

      for (let row = 0; row < rows; row++) {
        if (wildRows.has(row)) {
          grid[col][row] = { col, row, symbolId: 'WILD' };
          wildPlacements.push({ col, row });
        } else {
          const premium = this.rng.choice(premiumPool);
          grid[col][row] = { col, row, symbolId: premium.id };
          premiumPlacements.push({ col, row, symbolId: premium.id });
        }
      }
    });

    // 4. Multiplier
    const multiplier = trigger.count >= 3 ? 5 : 3;

    console.log(`🃏 Fool Feature: ${trigger.count} Fools → ${totalWilds} WILDs, ×${multiplier} multiplier`);

    return { transformedGrid: grid, multiplier, wildPlacements, premiumPlacements };
  }

  /**
   * Apply the Cups feature to the grid.
   * 
   * 2 Cups → 2-4 initial multiplier cells (1-2 per column)
   * 3 Cups → 6-9 initial multiplier cells (2-3 per column)
   * 
   * Initial multiplier values:
   * - 2 Cups: Lower range (2x, 3x)
   * - 3 Cups: Higher range (3x, 5x, 10x)
   */
  applyCups(grid: Grid, trigger: FeatureTrigger): CupsResult {
    const rows = grid[0].length; // 3

    // 1. Roll multiplier count per column
    const perColMultipliers: number[] = [];
    const multiplierPool2Cups = [2, 3];
    const multiplierPool3Cups = [3, 5, 10];

    for (let i = 0; i < trigger.columns.length; i++) {
      if (trigger.count === 2) {
        // 2 Cups: 1-2 multipliers per column
        perColMultipliers.push(this.rng.nextInt(1, 2));
      } else {
        // 3 Cups: 2-3 multipliers per column
        perColMultipliers.push(this.rng.nextInt(2, 3));
      }
    }

    // 2. Place initial multipliers in each Cups column
    const initialMultipliers: { col: number; row: number; value: number }[] = [];
    const pool = trigger.count === 2 ? multiplierPool2Cups : multiplierPool3Cups;

    trigger.columns.forEach((col, idx) => {
      const multiplierCount = perColMultipliers[idx];

      // Pick random rows to place multipliers
      const rowIndices = Array.from({ length: rows }, (_, i) => i);
      this.rng.shuffle(rowIndices);
      const multiplierRows = rowIndices.slice(0, multiplierCount);

      for (const row of multiplierRows) {
        const value = this.rng.choice(pool);
        initialMultipliers.push({ col, row, value });
      }
    });

    const totalMultipliers = initialMultipliers.length;
    console.log(`☕ Cups Feature: ${trigger.count} Cups → ${totalMultipliers} initial multipliers`);

    return { initialMultipliers, cupsColumns: trigger.columns };
  }

  /** Symbols that are anchors only and must never appear as bond candidates */
  private static readonly ANCHOR_SYMBOLS = new Set(['MALE', 'FEMALE']);

  /**
   * Generate a single candidate bond symbol (premium-biased).
   * ~60% PREMIUM, ~30% LOW, ~10% WILD
   * Excludes anchor-only symbols (MALE, FEMALE).
   */
  private generateCandidateSymbol(): string {
    const premiumPool = this.assetLoader.getSymbolsByTier('PREMIUM')
      .filter(s => !TarotFeatureProcessor.ANCHOR_SYMBOLS.has(s.id));
    const lowPool = this.assetLoader.getSymbolsByTier('LOW')
      .filter(s => !TarotFeatureProcessor.ANCHOR_SYMBOLS.has(s.id));
    const roll = this.rng.nextFloat();
    if (roll < 0.60) {
      return this.rng.choice(premiumPool).id;
    } else if (roll < 0.90) {
      return this.rng.choice(lowPool).id;
    } else {
      return 'WILD';
    }
  }

  /**
   * Apply the Lovers feature (initial trigger).
   * Determines spin count and multiplier. Does NOT fill anything yet.
   * 
   * 2 Lovers → 3 spins, ×2 multiplier
   * 3+ Lovers → 6 spins, ×1 multiplier
   */
  applyLovers(_grid: Grid, trigger: FeatureTrigger): LoversResult {
    const spinsTotal = trigger.count >= 3 ? 6 : 3;
    const multiplier = trigger.count === 2 ? 2 : 1;

    console.log(`❤️ Lovers Feature: ${trigger.count} Lovers → ${spinsTotal} spins, ×${multiplier}`);

    return {
      spinsTotal,
      spinsRemaining: spinsTotal,
      multiplier,
      columns: [...trigger.columns],
      currentSpin: null,
    };
  }

  /**
   * Generate candidates for a Lovers spin (before player picks).
   * Returns 3 candidate bond symbols.
   */
  generateLoversCandidates(): string[] {
    const candidates: string[] = [];
    for (let i = 0; i < 3; i++) {
      candidates.push(this.generateCandidateSymbol());
    }
    return candidates;
  }

  /**
   * Roll MALE and FEMALE anchor positions with weighted area size.
   * Area ranges from 1×1 to 5×3, biased toward middle-ground for testing.
   * 
   * Rarity tiers (area = width × height):
   *   Tiny (1×1):        5%
   *   Small (2×1, 1×2):  10%
   *   Medium (2×2, 3×2): 35%
   *   Large (3×3, 4×2):  30%
   *   Huge (4×3, 5×2):   15%
   *   Full (5×3):        5%
   */
  private rollAnchorPositions(cols: number, rows: number): { malePos: { col: number; row: number }; femalePos: { col: number; row: number } } {
    // Roll area tier
    const roll = this.rng.nextFloat();
    let targetWidth: number;
    let targetHeight: number;

    if (roll < 0.05) {
      // Tiny: 1×1
      targetWidth = 1; targetHeight = 1;
    } else if (roll < 0.15) {
      // Small: 2×1 or 1×2
      if (this.rng.nextFloat() < 0.5) { targetWidth = 2; targetHeight = 1; }
      else { targetWidth = 1; targetHeight = 2; }
    } else if (roll < 0.50) {
      // Medium: 2×2 or 3×2
      if (this.rng.nextFloat() < 0.5) { targetWidth = 2; targetHeight = 2; }
      else { targetWidth = 3; targetHeight = 2; }
    } else if (roll < 0.80) {
      // Large: 3×3 or 4×2
      if (this.rng.nextFloat() < 0.5) { targetWidth = 3; targetHeight = 3; }
      else { targetWidth = 4; targetHeight = 2; }
    } else if (roll < 0.95) {
      // Huge: 4×3 or 5×2
      if (this.rng.nextFloat() < 0.5) { targetWidth = 4; targetHeight = 3; }
      else { targetWidth = 5; targetHeight = 2; }
    } else {
      // Full: 5×3
      targetWidth = 5; targetHeight = 3;
    }

    // Clamp to grid bounds
    targetWidth = Math.min(targetWidth, cols);
    targetHeight = Math.min(targetHeight, rows);

    // Pick a random top-left corner for the area
    const startCol = this.rng.nextInt(0, cols - targetWidth);
    const startRow = this.rng.nextInt(0, rows - targetHeight);

    // MALE at top-left corner, FEMALE at bottom-right corner of the area
    const malePos = { col: startCol, row: startRow };
    const femalePos = { col: startCol + targetWidth - 1, row: startRow + targetHeight - 1 };

    return { malePos, femalePos };
  }

  /**
   * Apply a Lovers per-spin selection (after player picks a card).
   * Places MALE and FEMALE anchors, fills the bounding rectangle with bond symbol.
   * MALE and FEMALE are also overridden by the bond symbol for full fill.
   */
  applyLoversSpinSelection(
    grid: Grid,
    loversResult: LoversResult,
    candidateSymbols: string[],
    selectedIndex: number
  ): LoversSpinResult {
    const rows = grid[0].length;
    const cols = grid.length;

    const bondSymbolId = candidateSymbols[selectedIndex];

    // Roll anchor positions with weighted area size
    const { malePos, femalePos } = this.rollAnchorPositions(cols, rows);

    // Calculate bounding rectangle from anchors
    const minCol = Math.min(malePos.col, femalePos.col);
    const maxCol = Math.max(malePos.col, femalePos.col);
    const minRow = Math.min(malePos.row, femalePos.row);
    const maxRow = Math.max(malePos.row, femalePos.row);

    // Fill bounding rectangle with bond symbol (including anchor positions)
    const filledCells: { col: number; row: number }[] = [];
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        grid[c][r] = { col: c, row: r, symbolId: bondSymbolId };
        filledCells.push({ col: c, row: r });
      }
    }

    // Decrement spins remaining
    loversResult.spinsRemaining--;

    const rectSize = (maxCol - minCol + 1) * (maxRow - minRow + 1);
    console.log(`❤️ Lovers Spin: Player picked "${bondSymbolId}" → MALE(${malePos.col},${malePos.row}) FEMALE(${femalePos.col},${femalePos.row}) → ${rectSize} cells filled, ${loversResult.spinsRemaining} spins left`);

    const spinResult: LoversSpinResult = {
      bondSymbolId,
      candidateSymbols,
      selectedIndex,
      malePos,
      femalePos,
      filledCells,
      boundingRect: { minCol, minRow, maxCol, maxRow },
      transformedGrid: grid,
    };

    loversResult.currentSpin = spinResult;
    return spinResult;
  }
}
