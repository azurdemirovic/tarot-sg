# Cups Feature - Balance & Logic Fixes

## Problems Fixed

### 1. ✅ Too Many Multipliers Landing
**Problem**: 30% chance × 15 cells = ~4.5 multipliers per spin. Board filled too quickly.

**Solution**: 
- Lowered landing chance: **30% → 15%**
- Limited cells checked per spin: **15 cells → 5 random cells**

**Expected Rate**:
- Before: ~4.5 multipliers per spin
- After: ~0.75 multipliers per spin (5 cells × 15% = 0.75)

### 2. ✅ Lives Never Depleted
**Problem**: Landing on existing cells (replacements/multiplications) counted as "landing", so lives never decreased.

**Solution**: 
- Track only **NEW multipliers** landing in **empty cells**
- Replacements/multiplications don't count as "landing"
- Lives only deplete when NO new multipliers appear in empty cells

**Before**:
```typescript
if (multiplierGrid[col][row] === null) {
  landedThisSpin = true; // NEW
} else {
  landedThisSpin = true; // REPLACEMENT - shouldn't count!
}

if (!landedThisSpin) {
  lives--; // Never happens if replacements occur
}
```

**After**:
```typescript
if (multiplierGrid[col][row] === null) {
  newMultipliersLanded = true; // Only NEW count
} else {
  // Landing on existing cell does NOT count
}

if (!newMultipliersLanded) {
  lives--; // Properly depletes now
}
```

### 3. ✅ Too Much Multiplication
**Problem**: 20% multiply chance meant multipliers stacked too often, creating huge values.

**Solution**: Lowered multiply chance: **20% → 10%**

**Stacking Behavior**:
- 10% chance: Multiply existing × new (e.g., 5 × 3 = 15)
- 90% chance: Replace existing with new

### 4. ✅ Multiple Multipliers Per Cell Per Spin
**Problem**: Loop checked all 15 cells, so same cell could theoretically be checked multiple times (though unlikely).

**Solution**: 
- Build list of all cells
- Shuffle randomly
- Check only **5 random cells** per spin
- Each cell checked at most once per spin

## Implementation Details

### Random Cell Selection
```typescript
// Build list of all cells
const cellsToCheck: { col: number; row: number }[] = [];
for (let col = 0; col < this.cols; col++) {
  for (let row = 0; row < this.rows; row++) {
    cellsToCheck.push({ col, row });
  }
}

// Shuffle to randomize
this.rng.shuffle(cellsToCheck);

// Check only 5 random cells
const maxChecks = 5;
const cellsThisSpin = cellsToCheck.slice(0, maxChecks);
```

### New vs Replacement Tracking
```typescript
let newMultipliersLanded = false; // Track only NEW

for (const cell of cellsThisSpin) {
  if (this.rng.nextFloat() < landingChance) {
    if (multiplierGrid[col][row] === null) {
      // Empty cell: counts as NEW
      newMultipliersLanded = true;
    } else {
      // Existing cell: does NOT count
      // (replacement or multiplication)
    }
  }
}

// Only lose life if NO NEW multipliers
if (!newMultipliersLanded) {
  lives--;
}
```

## New Balance Parameters

| Parameter | Old Value | New Value | Reason |
|-----------|-----------|-----------|--------|
| Landing Chance | 30% | 15% | Reduce frequency |
| Cells Checked | 15 | 5 | Prevent spam |
| Multiply Chance | 20% | 10% | Reduce stacking |
| Life Loss Trigger | No landings | No NEW landings | Fix logic bug |

## Expected Behavior

### Collection Cycle
1. **Spin animation** plays (scrolling multipliers)
2. **5 random cells** are selected
3. Each cell has **15% chance** to land a multiplier
4. **If multiplier lands**:
   - **Empty cell**: Add new multiplier → counts as "landing"
   - **Occupied cell**: 10% multiply, 90% replace → does NOT count
5. **If no NEW multipliers** landed in empty cells:
   - Lose 1 life
   - Update lives display with pulse animation
6. Repeat until **lives = 0** or **board full**

### Typical Playthrough
With 3 lives and ~0.75 multipliers per spin:

**Early Game (empty board)**:
- High chance of landing in empty cells
- Lives rarely deplete
- Board fills gradually

**Mid Game (half full)**:
- More replacements/multiplications
- Lives start depleting more often
- Tension builds

**Late Game (mostly full)**:
- Very hard to find empty cells
- Lives deplete quickly
- Feature ends soon

**Full Board**:
- All 15 cells filled
- All multipliers ×2 (bonus)
- Feature ends immediately

## Game Feel Improvements

✅ **Slower Progression**
- Board fills more gradually
- Feature lasts longer
- More tension and anticipation

✅ **Lives Actually Matter**
- Lives deplete when appropriate
- Players must balance risk
- Clear failure condition

✅ **Controlled Randomness**
- Only 5 cells checked per spin
- Predictable pacing
- No overwhelming multiplier spam

✅ **Rare Multiplication**
- 10% chance makes it special
- Players excited when it happens
- Big multipliers feel earned

## Example Scenarios

### Scenario 1: Empty Board
- 5 cells checked, 15% chance each
- Expected: 0-1 multipliers land
- Lives: Rarely depleted (high success rate)

### Scenario 2: Half Full (7/15 cells)
- 5 random cells: ~2-3 empty, ~2-3 occupied
- Empty cells: 15% × 2.5 = ~0.375 new multipliers
- Lives: Sometimes depleted (medium success rate)

### Scenario 3: Mostly Full (13/15 cells)
- 5 random cells: ~0-1 empty, ~4-5 occupied
- Empty cells: 15% × 0.7 = ~0.1 new multipliers
- Lives: Often depleted (low success rate)

## Testing Notes

**To Verify**:
1. Lives should deplete when only replacements/multiplications happen
2. Lives should NOT deplete when new multipliers appear
3. Only ~0-2 multipliers per spin (not 4-5)
4. Multiplication is rare (~10% of replacements)
5. Board fills in ~10-20 spins (not 3-5)

**Expected Console Logs**:
```
☕ Cups Feature: 2 Cups → 3 initial multipliers
🔄 Multiplier stacked: 2,1 → ×6   (rare - ~10%)
💔 No new multipliers landed. Lives: 2
💔 No new multipliers landed. Lives: 1
💔 No new multipliers landed. Lives: 0
☕ Cups Feature Complete: Total Multiplier = ×35
```

## Files Modified

**src/game/render/CupsRevealAnimation.ts**:
- Lowered `landingChance` from 0.3 to 0.15
- Lowered `multiplyChance` from 0.2 to 0.10
- Changed from checking all cells to random 5 cells
- Fixed life depletion logic to track only NEW multipliers
- Added cell shuffling for true randomness

## Code Quality

- ✅ No new TypeScript errors
- ✅ Deterministic RNG (shuffle uses seeded RNG)
- ✅ Clear logic separation (new vs replacement)
- ✅ Better game balance and pacing

## Next Steps

The Cups feature is now properly balanced. After playtesting, you may want to adjust:
- `landingChance` (currently 15%)
- `maxChecks` (currently 5 cells)
- `multiplyChance` (currently 10%)
- Initial multiplier counts (currently 2-4 or 6-9)

All values are easy to tweak at the top of `phaseMultiplierLoop()`.
