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
  /** Sum of all multiplier cell values — payout = totalMultiplierSum × betAmount */
  totalMultiplierSum: number;
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
    const premiumPool = this.assetLoader.getSymbolsByTier('PREMIUM')
      .filter(s => !TarotFeatureProcessor.ANCHOR_SYMBOLS.has(s.id));

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
    const totalMultiplierSum = initialMultipliers.reduce((sum, m) => sum + m.value, 0);
    console.log(`☕ Cups Feature: ${trigger.count} Cups → ${totalMultipliers} multiplier cells, total sum: ${totalMultiplierSum}×`);

    return { initialMultipliers, cupsColumns: trigger.columns, totalMultiplierSum };
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
   * Area ranges from 1×1 to 5×3, biased toward smaller areas for balanced RTP.
   * 
   * Rarity tiers (area = width × height):
   *   Tiny (1×1):        15%
   *   Small (2×1, 1×2):  25%
   *   Medium (2×2, 3×1): 30%
   *   Large (3×2, 2×3):  18%
   *   Huge (4×2, 3×3):   9%
   *   Full (5×2, 4×3):   3%
   */
  private rollAnchorPositions(cols: number, rows: number): { malePos: { col: number; row: number }; femalePos: { col: number; row: number } } {
    // Roll area tier
    const roll = this.rng.nextFloat();
    let targetWidth: number;
    let targetHeight: number;

    if (roll < 0.15) {
      // Tiny: 1×1
      targetWidth = 1; targetHeight = 1;
    } else if (roll < 0.40) {
      // Small: 2×1 or 1×2
      if (this.rng.nextFloat() < 0.5) { targetWidth = 2; targetHeight = 1; }
      else { targetWidth = 1; targetHeight = 2; }
    } else if (roll < 0.70) {
      // Medium: 2×2 or 3×1
      if (this.rng.nextFloat() < 0.5) { targetWidth = 2; targetHeight = 2; }
      else { targetWidth = 3; targetHeight = 1; }
    } else if (roll < 0.88) {
      // Large: 3×2 or 2×3
      if (this.rng.nextFloat() < 0.5) { targetWidth = 3; targetHeight = 2; }
      else { targetWidth = 2; targetHeight = 3; }
    } else if (roll < 0.97) {
      // Huge: 4×2 or 3×3
      if (this.rng.nextFloat() < 0.5) { targetWidth = 4; targetHeight = 2; }
      else { targetWidth = 3; targetHeight = 3; }
    } else {
      // Full: 5×2 or 4×3
      if (this.rng.nextFloat() < 0.5) { targetWidth = 5; targetHeight = 2; }
      else { targetWidth = 4; targetHeight = 3; }
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
   * Find all clusters of adjacent same-symbol groups.
   * Adjacency: horizontal and vertical only (4-connected — no diagonals).
   *
   * Each cluster consists of one specific symbol type (e.g. RING) plus any
   * adjacent WILD cells. WILDs act as that symbol for the cluster but do NOT
   * bridge different symbol types together. A WILD can belong to multiple
   * clusters (e.g. a WILD between RINGs and COINs counts for both).
   *
   * Minimum cluster size scales with expansion: 3 → 4 → 5 → 6.
   */
  private findClusters(grid: Grid, cols: number, rows: number, minSize: number): DeathCluster[] {
    const clusters: DeathCluster[] = [];

    const key = (c: number, r: number) => `${c},${r}`;
    const directions = [
              [-1, 0],
      [0, -1],         [0, 1],
              [1, 0],
    ];

    // Collect all unique non-WILD, non-tarot symbol types on the grid
    const symbolTypes = new Set<string>();
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!grid[c] || !grid[c][r]) continue;
        const sid = grid[c][r].symbolId;
        if (sid !== 'WILD' && sid !== 'EMPTY' && !sid.startsWith('T_')) {
          symbolTypes.add(sid);
        }
      }
    }

    // For each symbol type, find connected groups of that symbol + adjacent WILDs
    for (const targetSymbol of symbolTypes) {
      const visited = new Set<string>();

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (!grid[c] || !grid[c][r]) continue;
          const sid = grid[c][r].symbolId;
          // Only seed from the target symbol (not from WILDs — WILDs get pulled in)
          if (sid !== targetSymbol) continue;

          const k = key(c, r);
          if (visited.has(k)) continue;

          // BFS: expand to same symbol or WILD neighbors
          const clusterCells: { col: number; row: number }[] = [];
          const queue: { col: number; row: number }[] = [{ col: c, row: r }];
          visited.add(k);

          while (queue.length > 0) {
            const cell = queue.shift()!;
            clusterCells.push(cell);

            for (const [dc, dr] of directions) {
              const nc = cell.col + dc;
              const nr = cell.row + dr;
              if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
              const nk = key(nc, nr);
              if (visited.has(nk)) continue;
              if (!grid[nc] || !grid[nc][nr]) continue;
              const neighborId = grid[nc][nr].symbolId;

              // Match same symbol or WILD (WILDs join the cluster but don't bridge)
              if (neighborId === targetSymbol || neighborId === 'WILD') {
                visited.add(nk);
                queue.push({ col: nc, row: nr });
              }
            }
          }

          // Only keep clusters that meet the minimum size
          if (clusterCells.length >= minSize) {
            clusters.push({ symbolId: targetSymbol, cells: clusterCells });
          }
        }
      }
    }

    // Also find pure WILD-only clusters (3+ connected WILDs not already part of other clusters)
    {
      const visited = new Set<string>();
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (!grid[c] || !grid[c][r]) continue;
          if (grid[c][r].symbolId !== 'WILD') continue;

          const k = key(c, r);
          if (visited.has(k)) continue;

          // BFS: expand to WILD neighbors only
          const clusterCells: { col: number; row: number }[] = [];
          const queue: { col: number; row: number }[] = [{ col: c, row: r }];
          visited.add(k);

          while (queue.length > 0) {
            const cell = queue.shift()!;
            clusterCells.push(cell);

            for (const [dc, dr] of directions) {
              const nc = cell.col + dc;
              const nr = cell.row + dr;
              if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
              const nk = key(nc, nr);
              if (visited.has(nk)) continue;
              if (!grid[nc] || !grid[nc][nr]) continue;
              if (grid[nc][nr].symbolId !== 'WILD') continue;

              visited.add(nk);
              queue.push({ col: nc, row: nr });
            }
          }

          if (clusterCells.length >= minSize) {
            clusters.push({ symbolId: 'WILD', cells: clusterCells });
          }
        }
      }
    }

    return clusters;
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

    // Convert any 'EMPTY' cells (sticky WILD placeholders) back to 'WILD' for logic
    for (const wild of deathResult.stickyWilds) {
      if (wild.col < cols && wild.row < rows && grid[wild.col] && grid[wild.col][wild.row]) {
        if (grid[wild.col][wild.row].symbolId === 'EMPTY') {
          grid[wild.col][wild.row].symbolId = 'WILD';
        }
      }
    }

    // Minimum cluster size is always 3
    const minClusterSize = 3;

    // 1. Find clusters meeting the minimum size requirement
    const clusters = this.findClusters(grid, cols, rows, minClusterSize);

    // 2. Slash ALL clusters — every cell in every cluster gets slashed
    const slashes: DeathSlash[] = [];
    const allSlashedCells: { col: number; row: number }[] = [];
    const slashedSet = new Set<string>();

    for (const cluster of clusters) {
      slashes.push({ cells: [...cluster.cells], symbolId: cluster.symbolId });

      for (const cell of cluster.cells) {
        const k = `${cell.col},${cell.row}`;
        if (!slashedSet.has(k)) {
          slashedSet.add(k);
          allSlashedCells.push(cell);
        }
      }
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
