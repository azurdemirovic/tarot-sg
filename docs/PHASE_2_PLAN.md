# Phase 2: Payline Evaluation - Implementation Plan

## 🎯 Goal
Replace placeholder random wins with **real payline-based win calculation**.

---

## ✅ Completed Prep Work
- [x] Created `paylines.ts` with 25 payline patterns
- [x] Created `paytable.json` with payout values  
- [x] Updated `Types.ts` with payline-based WinLine interface
- [x] Updated all documentation

---

## 📋 Implementation Tasks

### Task 1: Create PaylineEvaluator.ts
**File**: `src/game/logic/PaylineEvaluator.ts`

**Class Structure**:
```typescript
export class PaylineEvaluator {
  constructor(
    private assetLoader: AssetLoader,
    private paylines: number[][],
    private paytable: Paytable
  )

  // Main method: Check all 25 paylines
  evaluateAllPaylines(grid: Grid): WinLine[]

  // Check single payline
  evaluatePayline(grid: Grid, paylineIndex: number): WinLine | null

  // Extract symbols along payline path
  extractPaylineSymbols(grid: Grid, payline: number[]): string[]

  // Count consecutive matches with WILD substitution
  countConsecutiveMatches(symbols: string[]): { symbol: string, count: number }

  // Apply WILD substitution logic
  substituteWilds(symbols: string[]): string[]

  // Calculate payout from paytable
  calculatePayout(symbol: string, matchCount: number): number
}
```

**Key Logic**:
1. **Extract symbols** along payline path
2. **Apply WILD substitution** (WILD becomes matching symbol)
3. **Count consecutive matches** from left
4. **Stop at first mismatch**
5. **Award if 3+ matches**

---

### Task 2: WILD Substitution Logic

**Rules**:
```typescript
// Example 1: WILD helps complete a match
Input:  [K, W, K, Q, A]
Logic:  K matches K, W becomes K, K matches K → 3 KING
Output: { symbol: "KING", count: 3 }

// Example 2: All WILDs
Input:  [W, W, W, Q, A]
Logic:  All match as WILD symbol
Output: { symbol: "WILD", count: 3 }

// Example 3: No match
Input:  [K, Q, K, K, K]
Logic:  K doesn't match Q → stop at position 1
Output: { symbol: "KING", count: 1 } → No win (need 3+)

// Example 4: WILD at start
Input:  [W, K, K, K, A]
Logic:  W becomes K, all match K
Output: { symbol: "KING", count: 4 }
```

**Implementation**:
```typescript
substituteWilds(symbols: string[]): string[] {
  if (symbols.length === 0) return [];
  
  // Find the first non-WILD symbol
  const targetSymbol = symbols.find(s => s !== 'WILD');
  
  // If all WILDs, return as-is
  if (!targetSymbol) return symbols;
  
  // Replace all WILDs with the target symbol
  return symbols.map(s => s === 'WILD' ? targetSymbol : s);
}
```

---

### Task 3: Update GameController

**Changes to `GameController.spin()`**:
```typescript
spin(): SpinResult {
  // ... existing spin generation ...

  // NEW: Evaluate paylines
  const paylineEvaluator = new PaylineEvaluator(
    this.assetLoader,
    paylines,
    paytable
  );
  
  const wins = paylineEvaluator.evaluateAllPaylines(grid);
  const totalPayout = wins.reduce((sum, win) => sum + win.payout, 0);
  
  this.lastWin = totalPayout;
  this.balance += totalPayout;

  return {
    grid,
    tarotColumns,
    feature: null, // Phase 4
    wins,
    totalPayout,
    multiplier: 1
  };
}
```

---

### Task 4: Update UI Display

**Changes to `main.ts`**:
```typescript
function handleSpin() {
  const result = gameController.spin();
  
  // Update grid
  gridView.updateGrid(result.grid);
  
  // Show win breakdown
  if (result.wins.length > 0) {
    console.log('🎉 Wins:');
    result.wins.forEach(win => {
      console.log(`  Payline ${win.paylineIndex + 1}: ${win.matchCount} ${win.symbol} = ${win.payout} credits`);
    });
  }
  
  // Update UI
  updateUI();
}
```

---

## 🧪 Testing Strategy

### Unit Tests (Manual)

**Test 1: Straight Line Win**
```
Grid:
  K  K  K  Q  A
  Q  A  J  K  K
  A  J  Q  A  Q

Payline 2 (top): [0,0,0,0,0]
Symbols: K-K-K-Q-A
Expected: 3 KING = 20 credits ✅
```

**Test 2: WILD Substitution**
```
Grid:
  K  W  K  K  A
  Q  A  J  Q  K
  A  J  Q  A  Q

Payline 2 (top): [0,0,0,0,0]
Symbols: K-W-K-K-A
Expected: 4 KING = 50 credits ✅
```

**Test 3: Multiple Paylines Win**
```
Grid:
  K  K  K  K  K
  K  K  K  K  K
  Q  A  J  Q  A

Payline 1 (middle): 5 KING = 200
Payline 2 (top): 5 KING = 200
Total: 400 credits ✅
```

**Test 4: No Win (2-of-a-kind)**
```
Grid:
  K  K  Q  A  J
  Q  A  J  K  K
  A  J  Q  A  Q

Payline 2 (top): [0,0,0,0,0]
Symbols: K-K-Q-A-J
Expected: 0 credits (only 2 match) ✅
```

**Test 5: Tarot Column**
```
Grid:
  K      T_FOOL  K      Q  A
  Q      T_FOOL  K      K  K
  A      T_FOOL  Q      A  Q

Payline 1 (middle): Q-T_FOOL-K-K-K
No match (Q ≠ T_FOOL) ✅

Payline with all FOOLs would win if it existed
```

---

## 📁 Files to Create/Modify

### Create:
1. `src/game/logic/PaylineEvaluator.ts` (NEW)

### Modify:
1. `src/game/GameController.ts` - Add payline evaluation
2. `src/main.ts` - Display win breakdown
3. `src/game/Types.ts` - Add Paytable interface (if needed)

### Import:
1. Import `paylines` from `config/paylines.ts`
2. Import `paytable` from `config/paytable.json`

---

## ⏱️ Time Estimate

- **PaylineEvaluator.ts**: 1.5 hours
- **GameController integration**: 30 minutes
- **Testing & debugging**: 1 hour
- **Total**: ~3 hours

---

## 🎯 Success Criteria

- [ ] All 25 paylines checked every spin
- [ ] WILD substitution works correctly
- [ ] 3/4/5-of-a-kind pays correct amounts
- [ ] Multiple payline wins sum correctly
- [ ] Console shows win breakdown
- [ ] Balance updates with real wins
- [ ] No more placeholder random wins

---

## 🚀 Ready to Start?

All preparation is complete! 

**Next command**: "Start Phase 2" or "Implement PaylineEvaluator"

---

**Status**: Ready to implement  
**Dependencies**: None (all prep done)  
**Complexity**: Medium  
**Priority**: High (core gameplay feature)
