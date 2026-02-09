# Cups Feature - Spin Animation Redesign

## Problem Identified

The original implementation had the wrong approach to spinning during the Cups collection loop:
- ❌ Simple Y-offset animation on reel containers
- ❌ No actual multiplier visuals during spin
- ❌ Would trigger normal spin flow and payline calculations
- ❌ Multipliers appeared instantly without anticipation

## Solution: Multiplier-Only Fake Spin

Studied how normal reel spinning works in `ReelSpinner.ts` and `GridView.ts`, then created a **multiplier-only visual spin system** that:

### ✅ Creates Visual Anticipation
- Scrolling multiplier text overlays (not symbols)
- No connection to game logic or paylines
- Pure visual effect for player anticipation

### ✅ Mimics Slot Machine Behavior
Following the same pattern as normal spins:

**Phase 1 - Create Scrolling Strip:**
- Builds 10 fake multipliers per column
- Random values from pool [2x, 3x, 5x, 10x]
- Positioned in a vertical strip above the grid
- Slightly faded (alpha 0.6) to indicate "filler"

**Phase 2 - Accelerating Spin (720ms):**
- All columns scroll down together
- Accelerating motion (t² easing)
- Scrolls through ~8 cell heights of fake multipliers
- Creates anticipation as multipliers fly past

**Phase 3 - Sequential Stop (80ms stagger):**
- Columns stop left-to-right
- 80ms delay between each column
- Bounce effect on landing (easeOutBack)
- Each column takes 480ms to settle

**Phase 4 - Cleanup:**
- Removes all scrolling containers
- Cleans up fake multiplier texts
- 150ms pause before checking results

### ✅ After Spin: Real Logic
Once animation completes:
- Check each cell with 30% landing chance
- Spawn/update real multiplier overlays
- Apply stacking logic (20% multiply, 80% replace)
- Lose life if nothing landed

## Key Implementation Details

### No Symbol Generation
```typescript
// Hide all symbol containers (reels stay invisible)
for (let col = 0; col < this.cols; col++) {
  this.reelSpinners[col].setColumnVisible(false);
}
```

### Fake Multiplier Strip
```typescript
// Create scrolling container per column
const container = new Container();
container.x = col * step;
container.y = 0;

// Fill with fake multipliers (visual only)
for (let i = 0; i < fillerCount; i++) {
  const value = this.rng.choice([2, 3, 5, 10]);
  const text = new Text(`×${value}`, { ...goldStyle });
  text.y = -i * step + cellSize / 2; // Start above screen
  text.alpha = 0.6; // Faded to indicate filler
  container.addChild(text);
}
```

### Scroll Animation
```typescript
// Accelerating scroll
await tween(720, (t) => {
  const accel = t * t;
  scrollingContainers.forEach(container => {
    container.y = accel * scrollDistance;
  });
});

// Sequential stop with bounce
for (let col = 0; col < this.cols; col++) {
  await wait(80); // Stagger
  const container = scrollingContainers[col];
  const startY = container.y;
  
  await tween(480, (t) => {
    const bounce = easeOutBack(t);
    container.y = startY + (step * 2) * bounce;
  });
}
```

### Cleanup
```typescript
// Remove all fake multipliers
scrollingContainers.forEach(container => {
  container.removeChildren();
  this.overlay.removeChild(container);
});
```

## Animation Timeline

### Complete Collection Cycle (~2.4 seconds)

1. **Spin Start** (720ms)
   - Fake multipliers scroll down
   - Accelerating motion
   - All columns together

2. **Sequential Stop** (480ms + 320ms stagger = 800ms)
   - Column 0 stops: 480ms
   - Wait 80ms
   - Column 1 stops: 480ms
   - Wait 80ms
   - Column 2 stops: 480ms
   - Wait 80ms
   - Column 3 stops: 480ms
   - Wait 80ms
   - Column 4 stops: 480ms
   - (Columns overlap, total ~800ms)

3. **Pause** (150ms)
   - Brief moment after all stopped

4. **Result Check** (variable)
   - Check each cell for landing
   - Spawn multipliers if landed
   - Update if stacking
   - Total: ~200-500ms depending on results

5. **Next Cycle Pause** (200ms)
   - Brief gap before next spin

**Total**: ~2.4 seconds per collection cycle

## Comparison: Before vs After

### Before (Wrong Approach)
```typescript
// Simple Y offset on reel containers
await tween(400, (t) => {
  const offset = easeOutCubic(t) * 20;
  this.reelSpinners[col].y = offset;
});
```
- ❌ No visual multipliers
- ❌ Just moves symbol containers
- ❌ Boring, no anticipation
- ❌ Doesn't match slot machine feel

### After (Correct Approach)
```typescript
// Create fake multiplier strip
// Scroll through with acceleration
// Stop sequentially with bounce
// Clean up and check results
```
- ✅ Multipliers visibly scroll past
- ✅ Matches normal slot machine spin
- ✅ Creates anticipation and randomness feel
- ✅ No payline calculations or game logic
- ✅ Pure visual effect

## Technical Benefits

1. **No Game Logic Interference**
   - Doesn't call `spin()` or generate grids
   - Doesn't evaluate paylines
   - Completely isolated from game controller

2. **Visual Consistency**
   - Uses same gold multiplier style
   - Same easing functions as normal spins
   - Same stagger pattern as GridView

3. **Performance**
   - Efficient container management
   - Proper cleanup prevents memory leaks
   - No texture loading during animation

4. **Player Experience**
   - Clear visual feedback
   - Anticipation builds with each spin
   - Randomness is communicated visually
   - Feels like a real slot machine

## Debug Mode Fix

Also fixed the debug force issue:
```typescript
// Only force Cups once, not every spin
if (DEBUG.FORCE_CUPS && !sessionStorage.getItem('cups_forced')) {
  sessionStorage.setItem('cups_forced', 'true');
  spinOutput = gameController.forceTarotSpin('T_CUPS', DEBUG.CUPS_COLUMNS);
} else {
  spinOutput = gameController.spin();
}
```

Now subsequent spins behave normally after the first forced Cups.

## Testing

Set `DEBUG.FORCE_CUPS = true` and observe:
1. ✅ Initial multipliers reveal
2. ✅ Board clears (symbols hidden)
3. ✅ Collection loop begins
4. ✅ Each cycle shows multipliers scrolling
5. ✅ Sequential column stops with bounce
6. ✅ Real multipliers appear after spin
7. ✅ No payline calculations during feature
8. ✅ Lives counter updates correctly
9. ✅ Next spin is normal (not forced)

## Files Modified

- `src/game/render/CupsRevealAnimation.ts`
  - Removed `animateBoardClearSpin()` (simple Y-offset)
  - Completely rewrote `simulateSpin()` with fake multiplier strip
  - Updated `phaseBoardClear()` to just hide symbols
  
- `src/main.ts`
  - Added sessionStorage check for one-time force

## Result

The Cups feature now has proper slot machine-style spinning with visible multiplier anticipation, completely independent of the normal game flow. No symbols, no paylines, just multiplier collection excitement!
