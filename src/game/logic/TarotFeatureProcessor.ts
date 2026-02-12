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

export interface PriestessResult {
  spinsTotal: number;            // 6 (2 Priestess) or 9 (3+ Priestess)
  spinsRemaining: number;
  multiplier: number;            // 1 (2 Priestess) or 2 (3+ Priestess)
  columns: number[];             // triggering Priestess columns
}

export interface PriestessSpinResult {
  mysteryCells: { col: number; row: number }[];      // ALL mystery cells (new + persistent)
  newMysteryCells: { col: number; row: number }[];   // only the NEW cells added this spin
  mysterySymbolId: string;                            // the symbol all mysteries resolve to
  transformedGrid: Grid;                              // grid after mystery reveal
}

export interface DeathResult {
  spinsTotal: number;            // always 10
  spinsRemaining: number;
  columns: number[];             // triggering Death columns
  reapBar: number;               // accumulated reaped symbols
  reapThresholds: number[];      // [10, 20, 30] — expansion triggers
  currentExpansion: number;      // 0, 1, 2, or 3 (how many expansions done)
  gridCols: number;              // current grid width (starts 5)
  gridRows: number;              // current grid height (starts 3)
  stickyWilds: { col: number; row: number }[];  // positions of sticky WILDs that persist across spins
}

export interface DeathCluster {
  symbolId: string;
  cells: { col: number; row: number }[];
}

export interface DeathSlash {
  cells: { col: number; row: number }[];
  symbolId: string;
}

export interface DeathClusterWin {
  symbolId: string;
  clusterSize: number;
  payMultiplier: number;        // multiplier of bet (e.g., 0.5, 2, 10)
  payout: number;               // payMultiplier × betAmount
}

export interface DeathSpinResult {
  clusters: DeathCluster[];
  slashes: DeathSlash[];
  slashedCells: { col: number; row: number }[];
  refillCells: { col: number; row: number; symbolId: string }[];
  newStickyWilds: { col: number; row: number }[];  // WILDs left behind after slash this spin
  removedWilds: { col: number; row: number }[];     // sticky WILDs consumed by being slashed
  clusterWins: DeathClusterWin[];  // cluster-based payouts for this spin
  reaped: number;                // symbols reaped this spin
  totalReaped: number;           // total reap bar after this spin
  expanded: boolean;             // whether grid expanded this spin
  newGridCols: number;           // grid cols after expansion (if any)
  newGridRows: number;           // grid rows after expansion (if any)
  transformedGrid: Grid;         // final grid after slash + refill
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

  // ─── HIGH PRIESTESS ──────────────────────────────────────────────

  /**
   * Apply the Priestess feature (initial trigger).
   * Determines spin count and multiplier. Does NOT reveal anything yet.
   *
   * 2 Priestess → 6 spins, ×1 multiplier
   * 3+ Priestess → 9 spins, ×2 multiplier
   */
  applyPriestess(_grid: Grid, trigger: FeatureTrigger): PriestessResult {
    const spinsTotal = trigger.count >= 3 ? 9 : 6;
    const multiplier = trigger.count >= 3 ? 2 : 1;

    console.log(`🔮 Priestess Feature: ${trigger.count} Priestess → ${spinsTotal} spins, ×${multiplier}`);

    return {
      spinsTotal,
      spinsRemaining: spinsTotal,
      multiplier,
      columns: [...trigger.columns],
    };
  }

  /**
   * Apply a single Priestess spin: place mystery covers, pick mystery symbol, reveal.
   *
   * 1. Roll mystery cover count: 1 (common), 2 (rare), 3 (very rare)
   * 2. Place covers on random cells not already occupied by persistent mysteries
   * 3. Roll one Mystery Symbol (weighted from all normal symbols)
   * 4. All covered cells become the mystery symbol
   * 5. Return result with positions + symbol for animation
   */
  applyPriestessSpin(
    grid: Grid,
    priestessResult: PriestessResult,
    existingMysteryCells?: { col: number; row: number }[]
  ): PriestessSpinResult {
    const rows = grid[0].length;
    const cols = grid.length;

    // 1. Roll mystery cover count — weighted: 1 common, 2 rare, 3 very rare
    // Weights: 1→70%, 2→22%, 3→8%
    const countRoll = this.rng.nextFloat();
    let coverCount: number;
    if (countRoll < 0.70) coverCount = 1;
    else if (countRoll < 0.92) coverCount = 2;
    else coverCount = 3;

    // 2. Select random cells that aren't already persistent mystery cells
    const occupiedSet = new Set(
      (existingMysteryCells ?? []).map(c => `${c.col},${c.row}`)
    );
    const availableCells: { col: number; row: number }[] = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!occupiedSet.has(`${c},${r}`)) {
          availableCells.push({ col: c, row: r });
        }
      }
    }
    this.rng.shuffle(availableCells);
    const newMysteryCells = availableCells.slice(0, Math.min(coverCount, availableCells.length));

    // Combine new + existing mystery cells
    const allMysteryCells = [...(existingMysteryCells ?? []), ...newMysteryCells];

    // 3. Roll mystery symbol from weighted table (all normal symbols eligible)
    const normalSymbols = this.assetLoader.getNormalSymbols();
    const weights = normalSymbols.map(s => s.baseWeight);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let symbolRoll = this.rng.nextFloat() * totalWeight;
    let mysterySymbolId = normalSymbols[0].id;
    for (let i = 0; i < normalSymbols.length; i++) {
      symbolRoll -= weights[i];
      if (symbolRoll <= 0) {
        mysterySymbolId = normalSymbols[i].id;
        break;
      }
    }

    // 4. Set ALL mystery cells (new + persistent) to the chosen symbol
    for (const cell of allMysteryCells) {
      grid[cell.col][cell.row] = { col: cell.col, row: cell.row, symbolId: mysterySymbolId };
    }

    // 5. Decrement spins
    priestessResult.spinsRemaining--;

    console.log(`🔮 Priestess Spin: +${newMysteryCells.length} new mystery (${allMysteryCells.length} total) → all reveal "${mysterySymbolId}", ${priestessResult.spinsRemaining} spins left`);

    return {
      mysteryCells: allMysteryCells,
      newMysteryCells,
      mysterySymbolId,
      transformedGrid: grid,
    };
  }

  // ── DEATH ─────────────────────────────────────────────────────

  /**
   * Apply the Death feature (initial trigger).
   * Determines spin count and initializes the reap bar.
   * Duration: always 10 spins.
   */
  applyDeath(_grid: Grid, trigger: FeatureTrigger): DeathResult {
    const spinsTotal = 10;

    console.log(`💀 Death Feature: ${trigger.count} Death → ${spinsTotal} spins`);

    return {
      spinsTotal,
      spinsRemaining: spinsTotal,
      columns: [...trigger.columns],
      reapBar: 0,
      reapThresholds: [10, 20, 30],
      currentExpansion: 0,
      gridCols: 5,
      gridRows: 3,
      stickyWilds: [],
    };
  }

  /**
   * Find all clusters of adjacent matching symbols.
   * Adjacency: horizontal, vertical, AND diagonal (8-connected).
   * WILD symbols count as matching ANY symbol — they can seed clusters
   * and join any adjacent cluster. A group of pure WILDs also forms a cluster.
   * Minimum cluster size scales with expansion: 3 → 4 → 5 → 6.
   */
  private findClusters(grid: Grid, cols: number, rows: number, minSize: number): DeathCluster[] {
    const visited = new Set<string>();
    const clusters: DeathCluster[] = [];

    const key = (c: number, r: number) => `${c},${r}`;
    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1],
    ];

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const k = key(c, r);
        if (visited.has(k)) continue;
        if (!grid[c] || !grid[c][r]) continue;

        const symbolId = grid[c][r].symbolId;
        // Skip tarots for clustering
        if (symbolId.startsWith('T_')) continue;

        // BFS to find all connected cells.
        // For non-WILD seeds: match same symbol OR WILD neighbors.
        // For WILD seeds: match any non-tarot neighbor (WILD matches everything).
        const clusterCells: { col: number; row: number }[] = [];
        const queue: { col: number; row: number }[] = [{ col: c, row: r }];
        visited.add(k);

        // Track the "dominant" symbol of the cluster (first non-WILD, or WILD if all WILDs)
        let dominantSymbol = symbolId;

        while (queue.length > 0) {
          const cell = queue.shift()!;
          clusterCells.push(cell);

          const cellSymbol = grid[cell.col][cell.row].symbolId;

          // If this cell is non-WILD, adopt it as the dominant symbol
          if (cellSymbol !== 'WILD' && dominantSymbol === 'WILD') {
            dominantSymbol = cellSymbol;
          }

          for (const [dc, dr] of directions) {
            const nc = cell.col + dc;
            const nr = cell.row + dr;
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
            const nk = key(nc, nr);
            if (visited.has(nk)) continue;
            if (!grid[nc] || !grid[nc][nr]) continue;
            const neighborId = grid[nc][nr].symbolId;
            if (neighborId.startsWith('T_')) continue;

            // WILD matches everything; non-WILD cells match same symbol or WILD
            const matches =
              neighborId === 'WILD' ||
              cellSymbol === 'WILD' ||
              neighborId === dominantSymbol ||
              (dominantSymbol === 'WILD'); // pure WILD cluster absorbs anything

            if (matches) {
              visited.add(nk);
              queue.push({ col: nc, row: nr });

              // Update dominant if we found a non-WILD in what was a pure WILD cluster
              if (neighborId !== 'WILD' && dominantSymbol === 'WILD') {
                dominantSymbol = neighborId;
              }
            }
          }
        }

        // Only keep clusters that meet the minimum size
        if (clusterCells.length >= minSize) {
          clusters.push({ symbolId: dominantSymbol, cells: clusterCells });
        }
      }
    }

    return clusters;
  }

  /**
   * Select the best cluster to slash according to priority:
   * 1. Largest cluster size
   * 2. Higher-paying symbol type
   * 3. Leftmost position
   * 4. Topmost position
   */
  private selectBestCluster(clusters: DeathCluster[]): DeathCluster | null {
    if (clusters.length === 0) return null;

    const getSymbolPayValue = (symbolId: string): number => {
      const sym = this.assetLoader.getSymbol(symbolId);
      return sym ? (sym.payValues[4] || sym.payValues[3] || 0) : 0;
    };

    clusters.sort((a, b) => {
      // 1. Largest cluster
      if (b.cells.length !== a.cells.length) return b.cells.length - a.cells.length;
      // 2. Higher paying symbol
      const payA = getSymbolPayValue(a.symbolId);
      const payB = getSymbolPayValue(b.symbolId);
      if (payB !== payA) return payB - payA;
      // 3. Leftmost
      const minColA = Math.min(...a.cells.map(c => c.col));
      const minColB = Math.min(...b.cells.map(c => c.col));
      if (minColA !== minColB) return minColA - minColB;
      // 4. Topmost
      const minRowA = Math.min(...a.cells.map(c => c.row));
      const minRowB = Math.min(...b.cells.map(c => c.row));
      return minRowA - minRowB;
    });

    return clusters[0];
  }

  /**
   * Select a slash line within a cluster:
   * 1. Longest horizontal run of ≥2
   * 2. Else longest vertical run
   * 3. Else longest diagonal run
   * 4. Else any valid 2+ symbols in cluster
   */
  private selectSlashLine(cluster: DeathCluster): { col: number; row: number }[] {
    // Helper: find longest consecutive run in a direction
    const findRuns = (
      sortFn: (a: { col: number; row: number }, b: { col: number; row: number }) => number,
      groupKey: (c: { col: number; row: number }) => string,
      nextKey: (c: { col: number; row: number }) => string
    ): { col: number; row: number }[] => {
      const sorted = [...cluster.cells].sort(sortFn);
      const groups = new Map<string, { col: number; row: number }[]>();
      for (const cell of sorted) {
        const gk = groupKey(cell);
        if (!groups.has(gk)) groups.set(gk, []);
        groups.get(gk)!.push(cell);
      }

      let bestRun: { col: number; row: number }[] = [];
      for (const [, cells] of groups) {
        let currentRun: { col: number; row: number }[] = [cells[0]];
        for (let i = 1; i < cells.length; i++) {
          if (nextKey(cells[i]) === nextKey(cells[i - 1])) {
            // Same position in the varying axis — skip
            continue;
          }
          const prevNk = nextKey(cells[i - 1]);
          const currNk = nextKey(cells[i]);
          if (parseInt(currNk) - parseInt(prevNk) === 1) {
            currentRun.push(cells[i]);
          } else {
            if (currentRun.length >= 2 && currentRun.length > bestRun.length) {
              bestRun = [...currentRun];
            }
            currentRun = [cells[i]];
          }
        }
        if (currentRun.length >= 2 && currentRun.length > bestRun.length) {
          bestRun = [...currentRun];
        }
      }
      return bestRun;
    };

    // 1. Horizontal runs (same row, consecutive cols)
    const hRun = findRuns(
      (a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col,
      c => `${c.row}`,
      c => `${c.col}`
    );
    if (hRun.length >= 2) return hRun;

    // 2. Vertical runs (same col, consecutive rows)
    const vRun = findRuns(
      (a, b) => a.col !== b.col ? a.col - b.col : a.row - b.row,
      c => `${c.col}`,
      c => `${c.row}`
    );
    if (vRun.length >= 2) return vRun;

    // 3. Diagonal runs — check both directions
    // Diagonal ↘: same (col - row), sorted by col
    const diagA = findRuns(
      (a, b) => {
        const da = a.col - a.row;
        const db = b.col - b.row;
        return da !== db ? da - db : a.col - b.col;
      },
      c => `${c.col - c.row}`,
      c => `${c.col}`
    );
    if (diagA.length >= 2) return diagA;

    // Diagonal ↗: same (col + row), sorted by col
    const diagB = findRuns(
      (a, b) => {
        const da = a.col + a.row;
        const db = b.col + b.row;
        return da !== db ? da - db : a.col - b.col;
      },
      c => `${c.col + c.row}`,
      c => `${c.col}`
    );
    if (diagB.length >= 2) return diagB;

    // 4. Fallback: take any 2 cells from the cluster
    return cluster.cells.slice(0, Math.min(2, cluster.cells.length));
  }

  /**
   * Calculate cluster-based payout for a slashed cluster.
   * Payout scales with cluster size and symbol tier:
   *   LOW:     3=×0.5  4=×2   5=×5   6+=×10
   *   PREMIUM: 3=×1    4=×5   5=×15  6+=×30
   *   WILD:    3=×2    4=×10  5=×25  6+=×50
   */
  private calculateClusterPayout(symbolId: string, clusterSize: number, betAmount: number): DeathClusterWin {
    const sym = this.assetLoader.getSymbol(symbolId);
    const tier = sym?.tier || 'LOW';

    let payMultiplier: number;

    if (tier === 'PREMIUM') {
      if (clusterSize >= 6) payMultiplier = 30;
      else if (clusterSize === 5) payMultiplier = 15;
      else if (clusterSize === 4) payMultiplier = 5;
      else payMultiplier = 1;
    } else if (tier === 'WILD') {
      if (clusterSize >= 6) payMultiplier = 50;
      else if (clusterSize === 5) payMultiplier = 25;
      else if (clusterSize === 4) payMultiplier = 10;
      else payMultiplier = 2;
    } else {
      // LOW and anything else
      if (clusterSize >= 6) payMultiplier = 10;
      else if (clusterSize === 5) payMultiplier = 5;
      else if (clusterSize === 4) payMultiplier = 2;
      else payMultiplier = 0.5;
    }

    return {
      symbolId,
      clusterSize,
      payMultiplier,
      payout: payMultiplier * betAmount,
    };
  }

  /**
   * Apply a single Death spin: detect clusters, slash, maybe leave sticky WILDs,
   * refill, check expansion. Sticky WILDs persist across spins.
   *
   * Cluster minimum size scales: 3 (base) → 4 (1st expansion) → 5 → 6.
   * Slashed cells have ~15% chance to leave a sticky WILD behind.
   * If a sticky WILD is part of a slashed cluster, it gets consumed (removed).
   */
  applyDeathSpin(
    grid: Grid,
    deathResult: DeathResult,
    betAmount: number = 0.20
  ): DeathSpinResult {
    const cols = deathResult.gridCols;
    const rows = deathResult.gridRows;

    // Min cluster size scales with expansion: 3, 4, 5, 6
    const minClusterSize = 3 + deathResult.currentExpansion;

    // 1. Find clusters meeting the minimum size requirement
    const clusters = this.findClusters(grid, cols, rows, minClusterSize);

    // 2. Perform 1-3 slashes
    const slashCount = Math.min(
      clusters.length > 0 ? this.rng.nextInt(1, Math.min(3, clusters.length)) : 0,
      3
    );

    const slashes: DeathSlash[] = [];
    const allSlashedCells: { col: number; row: number }[] = [];
    const slashedSet = new Set<string>();

    // Copy clusters so we can modify them as we slash
    let remainingClusters = clusters.map(c => ({
      symbolId: c.symbolId,
      cells: [...c.cells],
    }));

    for (let s = 0; s < slashCount; s++) {
      // Re-sort and pick best remaining cluster
      const best = this.selectBestCluster(
        remainingClusters.filter(c => c.cells.length >= minClusterSize)
      );
      if (!best) break;

      // Select slash line within cluster
      const slashCells = this.selectSlashLine(best);

      slashes.push({ cells: slashCells, symbolId: best.symbolId });

      for (const cell of slashCells) {
        const k = `${cell.col},${cell.row}`;
        if (!slashedSet.has(k)) {
          slashedSet.add(k);
          allSlashedCells.push(cell);
        }
      }

      // Remove slashed cells from the cluster for subsequent slashes
      const slashedKeys = new Set(slashCells.map(c => `${c.col},${c.row}`));
      best.cells = best.cells.filter(c => !slashedKeys.has(`${c.col},${c.row}`));
      remainingClusters = remainingClusters.map(c => ({
        symbolId: c.symbolId,
        cells: c.cells.filter(cell => !slashedKeys.has(`${cell.col},${cell.row}`)),
      })).filter(c => c.cells.length >= minClusterSize);
    }

    // 3. Calculate cluster-based payouts for each slash
    const clusterWins: DeathClusterWin[] = [];
    for (const slash of slashes) {
      const win = this.calculateClusterPayout(slash.symbolId, slash.cells.length, betAmount);
      clusterWins.push(win);
      console.log(`💀 Cluster Win: ${slash.cells.length}× ${slash.symbolId} → ×${win.payMultiplier} = ${win.payout.toFixed(4)} EUR`);
    }

    // 4. Track which sticky WILDs were consumed (slashed)
    const stickyWildSet = new Set(deathResult.stickyWilds.map(w => `${w.col},${w.row}`));
    const removedWilds: { col: number; row: number }[] = [];
    for (const cell of allSlashedCells) {
      const k = `${cell.col},${cell.row}`;
      if (stickyWildSet.has(k)) {
        removedWilds.push(cell);
        stickyWildSet.delete(k);
      }
    }

    // 5. Update reap bar
    const reaped = allSlashedCells.length;
    deathResult.reapBar += reaped;

    // 6. Determine which slashed cells leave a sticky WILD behind (~15% chance)
    const WILD_CHANCE = 0.15;
    const newStickyWilds: { col: number; row: number }[] = [];
    const normalSymbols = this.assetLoader.getNormalSymbols();
    const normalWeights = normalSymbols.map(s => s.baseWeight);
    const refillCells: { col: number; row: number; symbolId: string }[] = [];

    for (const cell of allSlashedCells) {
      const k = `${cell.col},${cell.row}`;
      if (this.rng.nextFloat() < WILD_CHANCE) {
        // Leave a sticky WILD in this cell
        grid[cell.col][cell.row] = { col: cell.col, row: cell.row, symbolId: 'WILD' };
        refillCells.push({ col: cell.col, row: cell.row, symbolId: 'WILD' });
        newStickyWilds.push(cell);
        stickyWildSet.add(k);
      } else {
        // Refill with a normal random symbol
        const newSymbol = this.rng.weightedChoice(normalSymbols, normalWeights);
        grid[cell.col][cell.row] = { col: cell.col, row: cell.row, symbolId: newSymbol.id };
        refillCells.push({ col: cell.col, row: cell.row, symbolId: newSymbol.id });
      }
    }

    // 6. Update the persistent sticky WILDs list
    deathResult.stickyWilds = Array.from(stickyWildSet).map(k => {
      const [c, r] = k.split(',').map(Number);
      return { col: c, row: r };
    });

    // 7. Check for grid expansion
    let expanded = false;
    const maxCols = 8;
    const maxRows = 6;

    while (
      deathResult.currentExpansion < deathResult.reapThresholds.length &&
      deathResult.reapBar >= deathResult.reapThresholds[deathResult.currentExpansion] &&
      deathResult.gridCols < maxCols &&
      deathResult.gridRows < maxRows
    ) {
      deathResult.currentExpansion++;
      deathResult.gridCols++;
      deathResult.gridRows++;
      expanded = true;

      // Add new column
      const newCol = deathResult.gridCols - 1;
      grid[newCol] = [];
      for (let r = 0; r < deathResult.gridRows; r++) {
        const sym = this.rng.weightedChoice(normalSymbols, normalWeights);
        grid[newCol][r] = { col: newCol, row: r, symbolId: sym.id };
      }

      // Add new row to all columns
      const newRow = deathResult.gridRows - 1;
      for (let c = 0; c < deathResult.gridCols; c++) {
        if (!grid[c][newRow]) {
          const sym = this.rng.weightedChoice(normalSymbols, normalWeights);
          grid[c][newRow] = { col: c, row: newRow, symbolId: sym.id };
        }
      }

      // Grant 1 extra spin per expansion
      deathResult.spinsRemaining++;
      deathResult.spinsTotal++;

      console.log(`💀 Grid expanded to ${deathResult.gridCols}×${deathResult.gridRows}! Min cluster size now: ${3 + deathResult.currentExpansion}, +1 bonus spin (${deathResult.spinsRemaining} left)`);
    }

    // 8. Decrement spins
    deathResult.spinsRemaining--;

    console.log(`💀 Death Spin: ${slashes.length} slashes, ${reaped} reaped (total: ${deathResult.reapBar}), ${newStickyWilds.length} new WILDs, ${deathResult.stickyWilds.length} sticky WILDs, ${deathResult.spinsRemaining} spins left`);

    return {
      clusters,
      slashes,
      slashedCells: allSlashedCells,
      refillCells,
      newStickyWilds,
      removedWilds,
      clusterWins,
      reaped,
      totalReaped: deathResult.reapBar,
      expanded,
      newGridCols: deathResult.gridCols,
      newGridRows: deathResult.gridRows,
      transformedGrid: grid,
    };
  }

  // ─── LOVERS ────────────────────────────────────────────────────

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
