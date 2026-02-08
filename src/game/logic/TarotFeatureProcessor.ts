import { RNG } from '../RNG';
import { AssetLoader } from '../AssetLoader';
import { Grid, TarotColumn, FeatureTrigger } from '../Types';

export interface FoolResult {
  transformedGrid: Grid;
  multiplier: number;
  wildPlacements: { col: number; row: number }[];
  premiumPlacements: { col: number; row: number; symbolId: string }[];
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
}
