# Cups Feature - Skip/Speed-Up Functionality

## Problem Fixed

**Issue**: Pressing spin button during Cups feature triggered a new normal spin, causing:
- Random symbols to appear
- Conflict between Cups animation and normal game flow
- Broken game state

## Solution Implemented

Added skip/speed-up functionality that allows players to click the spin button to accelerate the current Cups collection spin without triggering a new game spin.

## Implementation Details

### 1. State Tracking (main.ts)

Added two new state variables:
```typescript
let cupsFeatureActive: boolean = false; // Track if Cups feature is currently running
let currentCupsAnimation: CupsRevealAnimation | null = null; // Reference to active animation
```

### 2. Modified handleSpin() Logic

Added priority check at the start of `handleSpin()`:
```typescript
async function handleSpin() {
  // ── CUPS FEATURE ACTIVE: Speed up current collection spin ──
  if (cupsFeatureActive && currentCupsAnimation) {
    console.log('⚡ Speeding up Cups collection spin');
    currentCupsAnimation.skipCurrentSpin();
    return; // Exit early - NO normal spin
  }
  
  // ... rest of normal spin logic
}
```

**Priority Order**:
1. **Cups skip** (highest priority - new)
2. Hurry-up for normal spins
3. New spin request

### 3. Cups Feature State Management

When Cups feature starts:
```typescript
spinBtn.disabled = false; // Allow clicking to speed up
cupsFeatureActive = true; // Mark as active
currentCupsAnimation = cupsReveal; // Store reference
```

When Cups feature ends:
```typescript
cupsFeatureActive = false; // Mark as inactive
currentCupsAnimation = null; // Clear reference
```

### 4. Skip Functionality in CupsRevealAnimation

Added internal skip mechanism:
```typescript
private skipRequested: boolean = false; // Flag for skip request
private currentSpinResolve: (() => void) | null = null; // Promise resolver

public skipCurrentSpin(): void {
  this.skipRequested = true;
  if (this.currentSpinResolve) {
    this.currentSpinResolve(); // Immediately resolve current animation
    this.currentSpinResolve = null;
  }
}
```

### 5. Accelerated Animation Timing

When skip is requested, animation speeds up:

**Normal Speed**:
- Spin down: 720ms
- Stop stagger: 80ms per column
- Bounce duration: 480ms
- Pause: 150ms

**Skip Speed**:
- Spin down: 200ms (72% faster)
- Stop stagger: 20ms per column (75% faster)
- Bounce duration: 150ms (69% faster)
- Pause: 50ms (67% faster)

Total cycle time:
- Normal: ~2.4 seconds
- Skip: ~0.6 seconds

### 6. Early Exit Logic

Skip can interrupt at multiple points:
```typescript
// Check at start
if (this.skipRequested) {
  this.skipRequested = false;
  return; // Skip entire animation
}

// During scroll phase
await new Promise<void>((resolve) => {
  this.currentSpinResolve = resolve; // Store resolver
  tween(...).then(() => {
    this.currentSpinResolve = null;
    resolve();
  });
});

// Check after scroll
if (this.skipRequested) {
  // Fast cleanup and exit
  scrollingContainers.forEach(container => {
    container.removeChildren();
    this.overlay.removeChild(container);
  });
  return;
}

// During sequential stops
for (let col = 0; col < this.cols; col++) {
  if (this.skipRequested) break; // Exit loop early
  // ...
}
```

## Player Experience

### Normal Behavior
1. Cups feature starts
2. Spin button stays enabled
3. Each collection cycle runs at normal speed (~2.4s)
4. Lives counter updates
5. Multipliers appear after each spin

### With Skip
1. Player clicks spin button during collection cycle
2. Console logs: `⚡ Speeding up Cups collection spin`
3. Current spin accelerates dramatically (~0.6s)
4. Multiplier check happens immediately
5. Next cycle begins (or feature ends if lives=0)
6. Can skip each cycle individually

## Benefits

✅ **No Game State Conflicts**
- Skip only affects current Cups animation
- Never triggers normal spin during feature
- Clean state management

✅ **Player Control**
- Players can speed through collection if desired
- Or let it play naturally for full effect
- Same control as normal spin hurry-up

✅ **Smooth Interruption**
- Animations clean up properly
- No visual glitches
- Promise-based, so async-safe

✅ **Consistent Behavior**
- Works like normal spin skip/hurry-up
- Familiar to players
- Same button interaction

## Code Quality

- ✅ No new TypeScript errors
- ✅ Proper async/await handling
- ✅ Clean state management
- ✅ Early exit prevents unnecessary work
- ✅ Proper cleanup of resources

## Testing

**To Test**:
1. Set `DEBUG.FORCE_CUPS = true`
2. Start the game
3. Cups feature triggers on first spin
4. During collection loop, click spin button
5. Observe acceleration of current spin
6. Check console for: `⚡ Speeding up Cups collection spin`
7. Verify no normal spin triggers
8. Verify multipliers still appear correctly

**Expected Behavior**:
- ✅ Spin button works during Cups feature
- ✅ Click speeds up current collection cycle
- ✅ Does NOT trigger new normal spin
- ✅ No random symbols appear
- ✅ Lives counter updates correctly
- ✅ Feature completes normally

## Files Modified

1. **src/main.ts**
   - Added `cupsFeatureActive` flag
   - Added `currentCupsAnimation` reference
   - Modified `handleSpin()` to check Cups state first
   - Updated Cups feature invocation to manage state

2. **src/game/render/CupsRevealAnimation.ts**
   - Added `skipRequested` flag
   - Added `currentSpinResolve` for promise management
   - Added `skipCurrentSpin()` public method
   - Modified `simulateSpin()` with skip checks
   - Added accelerated timing when skipped
   - Added early exit points

## Summary

The Cups feature now properly handles spin button clicks during the collection loop by speeding up the current animation instead of triggering a new game spin. This prevents state conflicts and gives players control over the pacing of the feature.
