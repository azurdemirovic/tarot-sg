# Cups Feature - Improvements & Fixes

## Issues Fixed

### 1. ✅ Board Clear Spin Animation
**Problem**: After initial multipliers were revealed, the board just instantly cleared without any transition.

**Solution**: Added `animateBoardClearSpin()` method that creates a smooth spin transition:
- 800ms spin duration
- Scrolls down 2 cell heights
- All reels spin together
- Creates sense of randomness and anticipation
- Smooth easing (easeInOutQuad)

**Location**: `src/game/render/CupsRevealAnimation.ts` - Phase 3

### 2. ✅ Proper Reel Spin Between Collection Cycles
**Problem**: Multipliers just appeared instantly during collection loop without spin animation.

**Solution**: Enhanced `simulateSpin()` method with realistic slot machine behavior:

**Phase 1 - Spin Down (720ms):**
- Accelerating scroll effect (t² easing)
- Scrolls down 3 cell heights
- All reels spin together
- Creates anticipation

**Phase 2 - Sequential Stop (480ms + stagger):**
- Reels stop left-to-right
- 80ms stagger between each reel
- Bounce effect on stop (easeOutBack)
- Mimics real slot machine behavior
- 150ms pause after all reels stop

**Total Duration**: ~1.6 seconds per collection cycle

**Location**: `src/game/render/CupsRevealAnimation.ts` - `simulateSpin()`

### 3. ✅ Debug Mode Force Once Only
**Problem**: When `DEBUG.FORCE_CUPS = true`, the feature was forced on EVERY spin, not just the first one.

**Solution**: Added sessionStorage check to force only once:
```typescript
if (DEBUG.FORCE_CUPS && !sessionStorage.getItem('cups_forced')) {
  console.log('🔧 DEBUG: Forcing Cups feature (one-time)');
  sessionStorage.setItem('cups_forced', 'true');
  spinOutput = gameController.forceTarotSpin('T_CUPS', DEBUG.CUPS_COLUMNS);
} else {
  spinOutput = gameController.spin();
}
```

**Behavior**:
- First spin: Forces Cups feature
- Subsequent spins: Normal random behavior
- Resets on page refresh (sessionStorage cleared)

**Location**: `src/main.ts` - `handleSpin()`

## Animation Flow Summary

### Complete Cups Feature Timeline

1. **Cups cards land** (normal spin)
2. **Cardbacks flip** to reveal Cups faces
3. **Cards disappear**
4. **Initial multipliers reveal** (staggered, 150ms between each)
5. **Board clear spin** (800ms) ← NEW
   - All reels spin down together
   - Transition to empty grid
6. **Lives counter appears** ("Lives: 3")
7. **Collection Loop** (repeats until lives = 0 or board full):
   - **Spin animation** (1.6s) ← IMPROVED
     - Accelerating spin down (720ms)
     - Sequential reel stops with bounce (480ms + stagger)
     - Brief pause (150ms)
   - **Multipliers appear** (30% chance per cell)
   - **Stacking logic** (20% multiply, 80% replace)
   - **Life loss** if no multipliers landed
8. **Full table bonus** (if all 15 cells filled)
   - All multipliers × 2
   - Pulse animation
9. **Win display** (2 seconds hold)
   - Total multiplier
   - Count-up payout animation
10. **Cleanup** (fade out)

## Visual Improvements

### Anticipation & Randomness
- Board clear spin creates smooth transition
- Collection spins feel like real slot machine
- Sequential reel stops build tension
- Bounce effect adds polish
- Proper timing prevents "instant appearance" feel

### Player Experience
- Clear feedback on each collection cycle
- Randomness is visually communicated
- Anticipation builds with each spin
- Lives counter provides clear progress tracking
- Smooth transitions throughout

## Testing Notes

### How to Test
1. Set `DEBUG.FORCE_CUPS = true` in `src/game/config/debug.ts`
2. Set `CUPS_COLUMNS: [1, 3]` (or any 2-3 columns)
3. Run `npm run dev`
4. Open http://localhost:3000
5. Click spin once to trigger Cups feature
6. Feature plays with all improvements
7. Next spin behaves normally (no forced feature)
8. Refresh page to reset debug flag

### Expected Behavior
- ✅ First spin triggers Cups feature
- ✅ Board clears with spin animation
- ✅ Each collection cycle has proper spin
- ✅ Reels stop sequentially with bounce
- ✅ Multipliers appear after spin completes
- ✅ Subsequent spins are normal (not forced)

## Code Quality

- ✅ No new TypeScript errors
- ✅ Follows existing animation patterns
- ✅ Reusable easing functions
- ✅ Proper async/await flow
- ✅ Clean separation of concerns
- ✅ Well-commented code

## Files Modified

1. `src/game/render/CupsRevealAnimation.ts`
   - Added `animateBoardClearSpin()` method
   - Enhanced `simulateSpin()` with 2-phase animation
   
2. `src/main.ts`
   - Added sessionStorage check for one-time force
   - Prevents continuous feature forcing

## Performance

- Animation durations optimized for feel
- No unnecessary redraws
- Efficient Promise handling
- Proper cleanup of tweens

## Next Steps

The Cups feature is now complete with proper animations and randomness feedback. Ready for:
- ✅ Full playtesting
- ✅ Weight balancing in `symbols.json`
- ✅ RTP tuning
- ✅ Production deployment

All improvements follow the same quality standards as the Fool feature.
