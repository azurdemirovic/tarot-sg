# Tarot Slot Game - Technical Reference for AI Assistants

## Purpose
This document provides unambiguous technical specifications for AI assistants implementing game features. All logic is deterministic and testable.

---

## Core Data Structures

### Symbol Definition
```typescript
interface Symbol {
  id: string;           // "WILD", "COIN", "T_FOOL", etc.
  tier: SymbolTier;     // "WILD" | "LOW" | "PREMIUM" | "TAROT"
  filename: string;     // Asset path
  baseWeight: number;   // Reel weight for spin generation
  payValue: number;     // Base payout for 3-of-a-kind
  isTarot: boolean;     // True if column-stack symbol
}

enum SymbolTier {
  WILD = "WILD",
  LOW = "LOW",
  PREMIUM = "PREMIUM",
  TAROT = "TAROT"
}
```

### Grid Cell
```typescript
interface Cell {
  col: number;          // 0-4 (or higher in Death mode)
  row: number;          // 0-2 (or higher in Death mode)
  symbolId: string;     // Symbol.id
  isLocked: boolean;    // Used during feature transformations
  mysteryMask?: boolean; // For Priestess feature
}

type Grid = Cell[][];   // grid[col][row]
```

### Spin Result
```typescript
interface SpinResult {
  grid: Grid;
  tarotColumns: TarotColumn[];  // Detected tarot columns
  feature: FeatureTrigger | null;
  wins: WinLine[];
  totalPayout: number;
  multiplier: number;           // Applied multiplier (default 1)
}

interface TarotColumn {
  col: number;
  tarotType: string;  // "T_FOOL", "T_CUPS", etc.
}

interface FeatureTrigger {
  type: string;       // "FOOL", "CUPS", "LOVERS", "PRIESTESS", "DEATH"
  count: number;      // Number of triggering tarot columns
  columns: number[];  // Column indices
}
```

---

## Algorithm Specifications

### 1. Spin Generation (Base Game)

**Input**: RNG seed, current game mode, grid dimensions  
**Output**: Grid with symbols and tarot columns

**Algorithm**:
```
1. Initialize empty grid[5][3]
2. Determine tarot spawn:
   - Roll random 0-100
   - If < TAROT_CHANCE_BASE (e.g., 15%):
     - Roll 1-5 for tarot count (weighted: 1=70%, 2=25%, 3=5%)
     - Roll which columns get tarots (unique random columns)
     - Roll tarot type for each column (weighted by rarity)
   - Else: no tarots this spin
3. For each column:
   - If column is tarot:
     - Fill all 3 cells with same tarot symbol ID
   - Else:
     - For each row:
       - Roll symbol from weighted pool (exclude tarots)
       - Assign to grid[col][row]
4. Return grid + tarotColumns list
```

**Edge Cases**:
- Tarot columns are always full 3-cell stacks (never partial)
- Same tarot type can appear on multiple columns
- WILD can appear in non-tarot columns normally

---

### 2. Tarot Trigger Detection

**Input**: TarotColumn[]  
**Output**: FeatureTrigger | null

**Algorithm**:
```
1. Group tarot columns by type:
   groupedTarots = {
     "T_FOOL": [col1, col3],
     "T_CUPS": [col2],
     ...
   }
2. For each group:
   - If count >= 2:
     - Return FeatureTrigger with that type
3. If no group has 2+:
   - Return null (no feature)
```

**Priority** (if multiple valid triggers):
```
DEATH > PRIESTESS > LOVERS > FOOL > CUPS
```

**Critical**: Only ONE feature triggers per spin, even if multiple types have 2+.

---

### 3. Tarot Removal & Premium Reveal

**Input**: Grid, FeatureTrigger  
**Output**: Modified grid

**Algorithm**:
```
1. For each column in FeatureTrigger.columns:
   - For each row in that column:
     - Roll random symbol from PREMIUM_POOL
     - Replace cell with premium symbol
     - Set cell.isLocked = false
2. Return modified grid
```

**Exception**: Some features override this (e.g., Fool creates wilds instead).

---

### 4. Payline Evaluation

**Input**: Grid (5×3), Paylines (25 patterns), Paytable  
**Output**: WinLine[]

**Algorithm**:
```
1. Load paylines (array of 25 row-index patterns)
2. Initialize winLines = []
3. For each payline (0-24):
   a. Extract symbols along payline path:
      - symbols = [grid[0][payline[0]], grid[1][payline[1]], ...]
   
   b. Count consecutive matches from left:
      - Start from reel 0
      - Count how many consecutive reels match (with WILD substitution)
      - Stop at first non-matching reel or end of grid
   
   c. If matchCount >= 3:
      - symbol = the matched symbol (not WILD unless all WILDs)
      - payout = paytable[symbol][matchCount] * betPerLine
      - cells = array of {col, row} for winning symbols
      - Add WinLine{paylineIndex, symbol, matchCount, payout, cells}
4. Return winLines
```

**WILD Substitution**:
```
Example payline symbols: [K, W, K, Q, A]
- Position 0: K
- Position 1: W (can be K)
- Position 2: K
- Result: 3 KING match

Example: [W, W, W, Q, A]
- All WILDs count as WILD symbol
- Result: 3 WILD match
```

**Edge Cases**:
- Minimum 3 consecutive matches required
- Matches must start from reel 0 (leftmost)
- Gaps break the sequence: [K, K, Q, K, K] = only 2 KING
- WILD-only paylines use WILD's paytable

---

### 5. Feature: Cups (Conversion)

**Input**: Grid, FeatureTrigger (2 or 3+ Cups)  
**Output**: Modified grid

**Algorithm**:
```
1. Remove tarot columns (replace with premium) [standard removal]
2. Scan remaining grid for LOW symbols:
   - Count occurrences: { "COIN": 3, "CUP": 5, "KEY": 1, ... }
   - Find max count
   - If tie: pick leftmost position, then topmost
3. Determine conversion limit:
   - If trigger.count == 2: limit = 4
   - Else: limit = 7
4. Find all cells with target LOW symbol:
   - Sort by: col ASC, row ASC
   - Take first 'limit' cells
   - Replace each with random PREMIUM symbol
5. Return modified grid
```

**Edge Cases**:
- If fewer than 'limit' LOW symbols exist, convert all available
- Premium symbols are not converted (only LOW tier)

---

### 6. Feature: Fool (Wild Reveal + Multiplier)

**Input**: Grid, FeatureTrigger (2 or 3+ Fools)  
**Output**: Modified grid, multiplier

**Algorithm**:
```
1. Determine per-column wild count:
   - If trigger.count == 2:
     - For each Fool column: roll 1-3 (equal weight)
   - Else (3+):
     - For each Fool column: roll 1-3 (weighted: 1=20%, 2=40%, 3=40%)

2. Collect all wild placements across columns:
   - totalWilds = sum of per-column wild counts
   - If totalWilds > 9:
     - Cap at 9
     - Redistribute excess as premium

3. For each Fool column:
   - Randomly select 'wildCount' rows in that column
   - Set those cells to WILD
   - Set remaining cells to random PREMIUM

4. Determine multiplier:
   - If trigger.count == 2: multiplier = 3
   - Else: multiplier = 5

5. Return grid + multiplier
```

**Wild Cap Enforcement**:
```
Example: 3 Fools roll [3, 3, 3] = 9 wilds → OK
Example: 3 Fools roll [3, 3, 4] = 10 wilds → Cap to 9, 1 becomes premium
```

**Randomization Details**:
- Within each column, wild positions are random (no bias)
- Excess wilds converted to premium in last processed column

---

### 7. Feature: Lovers (Anchor Box)

**Input**: Grid, FeatureTrigger (2 or 3+ Lovers)  
**Output**: Modified grid, multiplier

**Algorithm**:
```
1. Remove tarot columns (standard premium reveal)

2. Choose Bond Symbol (weighted roll):
   - LOW symbols: 70% combined
   - PREMIUM symbols: 28% combined
   - WILD: 2%

3. Place anchors:
   - anchorCount = trigger.count
   - If anchorCount == 2:
     - Bias: place anchors within 2-cell distance (Manhattan or Euclidean)
   - Else (3+):
     - Bias: place anchors spread apart (min 1-cell distance)
   - Anchors placed on random available cells

4. Calculate bounding box:
   - minCol = min(anchor.col for each anchor)
   - maxCol = max(anchor.col for each anchor)
   - minRow = min(anchor.row for each anchor)
   - maxRow = max(anchor.row for each anchor)

5. Fill bounding box:
   - For col in minCol..maxCol:
     - For row in minRow..maxRow:
       - Set grid[col][row] = Bond Symbol

6. Determine multiplier:
   - If trigger.count == 2: multiplier = 2
   - Else: multiplier = 1

7. Return grid + multiplier
```

**Anchor Placement Details**:
```
2 Lovers example biasing:
- Roll distance = 1-3 cells (Manhattan)
- Place first anchor at random cell
- Place second anchor within 'distance' radius
- If no valid cell, fallback to any random cell

3 Lovers example biasing:
- Place anchors sequentially
- Each new anchor must be at least 2 cells away from previous
- If impossible, reduce constraint
```

---

### 8. Feature: High Priestess (Mystery Mode)

**Input**: Grid, FeatureTrigger (2 or 3+ Priestess)  
**Output**: Enter FEATURE_PRIESTESS mode

**Mode Initialization**:
```
priestessMode = {
  spinsRemaining: trigger.count == 2 ? 6 : 9,
  multiplier: trigger.count >= 3 ? 2 : 1,
  active: true
}
```

**Per-Spin Algorithm** (during mode):
```
1. Roll mystery cover count: random 0-15
2. Place covers on random cells:
   - Select 'coverCount' unique random cells
   - Mark each as cell.mysteryMask = true
3. Generate spin normally (no tarots trigger during mode)
4. Roll Mystery Symbol from weighted table (all symbols possible)
5. Reveal all masked cells:
   - For each cell where mysteryMask == true:
     - Set cell.symbolId = Mystery Symbol
6. Evaluate wins with mode multiplier applied
7. Decrement spinsRemaining
8. If spinsRemaining == 0: exit mode
```

**Isolation Rule**:
- Tarot columns can still land during mode
- They count as paying symbols (3-of-a-kind in that column)
- They do NOT trigger features (even if 2+ same type)

---

### 9. Feature: Death (Reap & Expand Mode)

**Input**: Grid, FeatureTrigger (always 2+)  
**Output**: Enter FEATURE_DEATH mode

**Mode Initialization**:
```
deathMode = {
  spinsRemaining: 10,
  reapBar: 0,
  thresholds: [10, 20, 30],
  currentThreshold: 0,
  gridSize: { cols: 5, rows: 3 },
  active: true
}
```

**Per-Spin Algorithm**:
```
1. Generate spin for current grid size
2. Detect all clusters:
   - Cluster = 2+ adjacent matching symbols
   - Adjacency: horizontal, vertical, OR diagonal
   - Use flood-fill or union-find algorithm
3. Perform slashes (1-3 slashes per spin):
   - Sort clusters by priority:
     a. Largest size (most cells)
     b. Highest-paying symbol
     c. Leftmost (min col)
     d. Topmost (min row)
   - For top 1-3 clusters:
     - Select slash line within cluster:
       * Find longest horizontal run of ≥2
       * Else longest vertical run
       * Else longest diagonal run
       * Else pick any 2+ cells in cluster
     - Remove slashed cells
     - Add count to reapBar
4. Refill empty cells with new random symbols
5. Check expansion:
   - If reapBar >= thresholds[currentThreshold]:
     - Expand grid: cols += 1, rows += 1
     - Increment currentThreshold
     - Reset reapBar to 0 (or keep accumulating—clarify in tuning)
6. Evaluate wins on final grid
7. Decrement spinsRemaining
8. If spinsRemaining == 0: exit mode, reset to 5×3
```

**Cluster Detection Algorithm**:
```typescript
function findClusters(grid: Grid): Cluster[] {
  visited = new Set<string>();
  clusters: Cluster[] = [];
  
  for (col in 0..gridCols) {
    for (row in 0..gridRows) {
      cellKey = `${col},${row}`;
      if (visited.has(cellKey)) continue;
      
      cluster = floodFill(grid, col, row, visited);
      if (cluster.cells.length >= 2) {
        clusters.push(cluster);
      }
    }
  }
  return clusters;
}

function floodFill(grid, startCol, startRow, visited): Cluster {
  targetSymbol = grid[startCol][startRow].symbolId;
  cluster = { symbol: targetSymbol, cells: [] };
  stack = [{col: startCol, row: startRow}];
  
  while (stack.length > 0) {
    {col, row} = stack.pop();
    cellKey = `${col},${row}`;
    if (visited.has(cellKey)) continue;
    if (grid[col][row].symbolId != targetSymbol) continue;
    
    visited.add(cellKey);
    cluster.cells.push({col, row});
    
    // Add all 8 neighbors (horizontal, vertical, diagonal)
    neighbors = [
      {col-1, row-1}, {col, row-1}, {col+1, row-1},
      {col-1, row},                 {col+1, row},
      {col-1, row+1}, {col, row+1}, {col+1, row+1}
    ];
    
    for (neighbor in neighbors) {
      if (isInBounds(neighbor)) {
        stack.push(neighbor);
      }
    }
  }
  return cluster;
}
```

**Slash Line Selection** (within cluster):
```typescript
function selectSlashLine(cluster: Cluster): Cell[] {
  // Try horizontal
  horizontalRuns = findRuns(cluster, "horizontal");
  longestH = max(horizontalRuns, by: length);
  if (longestH.length >= 2) return longestH;
  
  // Try vertical
  verticalRuns = findRuns(cluster, "vertical");
  longestV = max(verticalRuns, by: length);
  if (longestV.length >= 2) return longestV;
  
  // Try diagonal (both directions)
  diagonalRuns = findRuns(cluster, "diagonal_down") + findRuns(cluster, "diagonal_up");
  longestD = max(diagonalRuns, by: length);
  if (longestD.length >= 2) return longestD;
  
  // Fallback: any 2 cells in cluster
  return cluster.cells.slice(0, 2);
}
```

**Grid Expansion**:
```
Expansion 1 (bar >= 10): 5×3 → 6×4 (384 ways)
Expansion 2 (bar >= 20): 6×4 → 7×5 (2401 ways)
Expansion 3 (bar >= 30): 7×5 → 8×6 (7776 ways)
```

---

## RNG Specification

### Requirements
- **Deterministic**: Same seed produces identical results
- **Seeded**: Allow setting seed for testing/reproduction
- **Methods**:
  - `nextInt(min, max)`: Inclusive range
  - `nextFloat()`: 0.0-1.0
  - `choice(array, weights?)`: Select element (optionally weighted)
  - `shuffle(array)`: Fisher-Yates shuffle

### Recommended Implementation
Use **xorshift128** or **MT19937** (Mersenne Twister) for quality + performance.

```typescript
class RNG {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  nextInt(min: number, max: number): number {
    // xorshift128 or similar
    // Return integer in [min, max] inclusive
  }
  
  nextFloat(): number {
    // Return float in [0.0, 1.0)
  }
  
  choice<T>(array: T[], weights?: number[]): T {
    // If weights provided: weighted random selection
    // Else: uniform random
  }
}
```

---

## Configuration Files

### symbols.json
```json
{
  "symbols": [
    {
      "id": "WILD",
      "tier": "WILD",
      "filename": "WILD.png",
      "baseWeight": 5,
      "payValues": [0, 0, 20, 100, 500],
      "isTarot": false
    },
    {
      "id": "COIN",
      "tier": "LOW",
      "filename": "COIN.png",
      "baseWeight": 30,
      "payValues": [0, 0, 5, 10, 25],
      "isTarot": false
    },
    {
      "id": "T_FOOL",
      "tier": "TAROT",
      "filename": "T_FOOL.jpg",
      "baseWeight": 8,
      "payValues": [0, 0, 15, 30, 75],
      "isTarot": true
    }
  ],
  "pools": {
    "LOW": ["COIN", "CUP", "KEY", "SWORD", "RING", "FLEUR"],
    "PREMIUM": ["SKULLCROSS", "DICE", "KING", "ANGEL"],
    "TAROT": ["T_FOOL", "T_CUPS", "T_LOVERS", "T_PRIESTESS", "T_DEATH"]
  }
}
```

**Pay Values Array**: [1-reel, 2-reel, 3-reel, 4-reel, 5-reel]  
Only 3+ reels pay in 243-ways.

---

## Testing Scenarios

### Test 1: Single Tarot (No Trigger)
```
Seed: 12345
Expected: 1 tarot column appears
Verify:
  - No feature triggers
  - Tarot column counts as 3 symbols in ways calculation
  - Tarot column pays according to paytable
```

### Test 2: Two Same Tarots (Trigger)
```
Seed: 67890
Force: 2 T_CUPS columns on reels 1 and 4
Expected:
  - Cups feature triggers
  - Cups columns removed, reveal premium
  - Most common LOW converted (up to 4)
  - Ways evaluated on final grid
```

### Test 3: Mixed Tarots (No Trigger)
```
Force: 1 T_FOOL (reel 2), 1 T_CUPS (reel 4)
Expected:
  - No feature triggers
  - Both tarots pay as normal symbols
  - Ways calculated with both tarot columns as 3-symbol stacks
```

### Test 4: Fool Wild Cap
```
Force: 3 T_FOOL columns
Mock RNG: Each column rolls 4 wilds
Expected:
  - Total would be 12, but capped at 9
  - 3 excess cells become premium
  - Multiplier = ×5
```

### Test 5: Death Cluster Detection
```
Grid:
  COIN COIN COIN KEY  SWORD
  COIN KEY  COIN COIN COIN
  KEY  COIN COIN COIN DICE
Expected clusters:
  - COIN cluster: 11 cells (8-connected)
  - KEY cluster: 3 cells
Target for slash: COIN cluster (largest)
```

### Test 6: Priestess Isolation
```
During Priestess feature:
  - Spin lands 2 T_FOOL columns
  - Expected: Fools pay as symbols, NO Fool feature
```

---

## Priority & Ambiguity Resolution

### Multiple Features Triggering
**Priority Order**:
1. DEATH (highest)
2. PRIESTESS
3. LOVERS
4. FOOL
5. CUPS (lowest)

### Tie-Breaking Rules
- **Most common symbol** (Cups): Leftmost position, then topmost
- **Cluster size tie**: Higher-paying symbol, then leftmost, then topmost
- **Anchor placement**: RNG-deterministic based on seed

### Reap Bar Accumulation
**Clarification Needed**: Does bar reset to 0 after expansion, or keep accumulating?  
**Recommendation**: Reset to 0 for predictable progression.

---

## Performance Considerations

### Optimization Targets
- Spin generation: < 5ms
- Ways evaluation: < 10ms
- Cluster detection (Death): < 20ms (even at 8×6 grid)

### Profiling Points
- Flood-fill algorithm (Death feature)
- Ways calculation with large grids
- Symbol sprite rendering (PixiJS batch rendering)

---

## Debugging Tools (Required)

### Force Tarot Spin
```typescript
interface ForceConfig {
  tarotType: string;      // "T_FOOL", etc.
  columns: number[];      // [0, 2, 4]
  enabled: boolean;
}
```

### RNG Seed Control
```typescript
// Input field in debug panel
setSeed(seed: number): void
getCurrentSeed(): number
```

### Visualization Modes
- **Cluster Map**: Outline detected clusters with colors
- **Anchor Display**: Show anchor positions and bounding box
- **Mystery Mask**: Highlight cells with mystery covers
- **Reap Bar**: Display current value and next threshold

---

## Edge Cases Checklist

- [ ] Single tarot column pays correctly
- [ ] Mixed tarots don't trigger
- [ ] Wild cap enforced (Fool)
- [ ] Grid expansion persists (Death)
- [ ] Priestess mode blocks other features
- [ ] Bounding box handles corner anchors (Lovers)
- [ ] Empty cells after slash refill correctly (Death)
- [ ] Multipliers stack correctly (if multiple sources)
- [ ] Tarot columns can't be partially filled
- [ ] WILD substitution works in ways calculation

---

**Document Version**: 1.0  
**Companion Document**: GAME_DESIGN_DOCUMENT.md  
**Status**: Pre-Development Reference
