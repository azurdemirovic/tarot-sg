# Paylines System - Complete Guide

## 🎰 System Change: 243-Ways → 25 Paylines

**UPDATED**: The game now uses traditional **payline-based** wins instead of 243-ways.

---

## What are Paylines?

A **payline** is a specific pattern/path across the 5 reels. Winning symbols must appear along this exact path, starting from the leftmost reel.

### Example Payline:

```
Reel 1  Reel 2  Reel 3  Reel 4  Reel 5
  A       B       C       D       E     Row 0
  B  -->  A  -->  B  -->  A  -->  B     Row 1 (Payline 1)
  C       C       C       C       C     Row 2
```

**Payline 1** checks: `[Row 1, Row 1, Row 1, Row 1, Row 1]` (middle straight line)

If symbols match along this path (e.g., `B-B-B-A-C`), the player wins for 3-of-a-kind!

---

## Our 25 Paylines

### Straight Lines (3 paylines)
1. **Middle Row**: `[1,1,1,1,1]` - Straight across middle
2. **Top Row**: `[0,0,0,0,0]` - Straight across top
3. **Bottom Row**: `[2,2,2,2,2]` - Straight across bottom

### V-Shapes (2 paylines)
4. **V Shape**: `[0,1,2,1,0]` - Down then up
5. **Inverted V (^)**: `[2,1,0,1,2]` - Up then down

### Zigzag Patterns (4 paylines)
6. **Top Zigzag**: `[0,1,0,1,0]`
7. **Bottom Zigzag**: `[2,1,2,1,2]`
8. **Top Wave**: `[0,0,1,0,0]`
9. **Bottom Wave**: `[2,2,1,2,2]`

### W and M Shapes (2 paylines)
10. **W Shape**: `[0,2,0,2,0]`
11. **M Shape**: `[2,0,2,0,2]`

### Complex Patterns (12 paylines)
12-25. Various diagonal, wave, and corner patterns

---

## How Wins Are Calculated

### Step 1: Spin the Reels
Generate random symbols on a 5×3 grid.

### Step 2: Check All 25 Paylines
For each payline:
1. **Extract symbols** along the payline path
2. **Start from reel 1** (leftmost)
3. **Count consecutive matches** (with WILD substitution)
4. **If 3+ match**: Award payout

### Step 3: Calculate Payout
```typescript
// Example: Payline 4 has K-K-K-Q-A
// 3 KING symbols matched

const matchCount = 3; // Three kings
const symbol = "KING";
const payoutPerLine = paytable[symbol][matchCount]; // 20 credits
const betPerLine = 1; // 1 credit per line
const win = payoutPerLine * betPerLine; // 20 credits
```

### Step 4: Sum All Wins
```typescript
totalWin = payline1Win + payline2Win + ... + payline25Win;
```

---

## Win Rules

### Minimum Match
- **3 symbols minimum** required to win
- Must start from **reel 1** (leftmost)
- Must be **consecutive reels** (no gaps)

### WILD Substitution
- **WILD** substitutes for any normal symbol
- Example: `K-W-K-Q-A` = 3 KING (WILD acts as KING)
- WILD-only wins use WILD's own paytable

### Tarot Columns
- When a tarot column appears, that reel has the **same symbol in all 3 rows**
- Example: If T_FOOL lands on reel 3, all paylines see FOOL on reel 3

---

## Paytable (per payline, 1 credit bet)

### Special
| Symbol | 3-of-a-kind | 4-of-a-kind | 5-of-a-kind |
|--------|-------------|-------------|-------------|
| WILD   | 50          | 200         | 1000        |

### Premium Symbols
| Symbol      | 3-of-a-kind | 4-of-a-kind | 5-of-a-kind |
|-------------|-------------|-------------|-------------|
| ANGEL       | 25          | 75          | 300         |
| KING        | 20          | 50          | 200         |
| DICE        | 15          | 35          | 150         |
| SKULLCROSS  | 10          | 25          | 100         |

### Low Symbols
| Symbol | 3-of-a-kind | 4-of-a-kind | 5-of-a-kind |
|--------|-------------|-------------|-------------|
| FLEUR  | 8           | 20          | 80          |
| RING   | 6           | 15          | 60          |
| SWORD  | 6           | 15          | 60          |
| KEY    | 5           | 12          | 50          |
| CUP    | 5           | 10          | 40          |
| COIN   | 5           | 10          | 40          |

### Tarot Symbols
| Symbol       | 3-of-a-kind | 4-of-a-kind | 5-of-a-kind |
|--------------|-------------|-------------|-------------|
| T_DEATH      | 30          | 60          | 150         |
| T_PRIESTESS  | 30          | 60          | 150         |
| T_LOVERS     | 20          | 40          | 100         |
| T_FOOL       | 15          | 30          | 75          |
| T_CUPS       | 15          | 30          | 75          |

**Note**: Tarot payouts apply when tarots appear as normal paying symbols (not triggering features).

---

## Bet System

- **Bet per line**: 1 credit (fixed for MVP)
- **Total paylines**: 25
- **Total bet per spin**: 25 credits
- **Balance requirement**: Must have at least 25 credits to spin

---

## Example Spin Breakdown

### Grid Result:
```
Reel 1   Reel 2   Reel 3   Reel 4   Reel 5
  K        K        A        Q        J      Row 0
  K        K        K        K        K      Row 1
  Q        A        K        A        Q      Row 2
```

### Payline Evaluation:

**Payline 1** (Middle `[1,1,1,1,1]`):
- Symbols: `K-K-K-K-K`
- **5 KING** = 200 credits ✅

**Payline 2** (Top `[0,0,0,0,0]`):
- Symbols: `K-K-A-Q-J`
- **2 KING** = No win (need 3+) ❌

**Payline 3** (Bottom `[2,2,2,2,2]`):
- Symbols: `Q-A-K-A-Q`
- No matches = No win ❌

**Paylines 4-25**: Check remaining patterns...

**Total Win**: 200 + (other wins) = Total payout

---

## Implementation Files

### Configuration Files:
1. **`src/game/config/paylines.ts`** - 25 payline patterns
2. **`src/game/config/paytable.json`** - Payout values
3. **`src/game/config/symbols.json`** - Symbol definitions

### Logic Files (Phase 2):
1. **`src/game/logic/PaylineEvaluator.ts`** - Check wins
2. **`src/game/logic/WildSubstitution.ts`** - Handle WILDs
3. **`src/game/render/PaylineOverlay.ts`** - Visual paylines

---

## Visual Payline Display (Phase 3)

### Planned Features:
- **Overlay Graphics**: Draw winning paylines on grid
- **Color Coding**: Each payline has unique color
- **Animation**: Highlight winning symbols
- **Cycle Button**: Step through each winning payline
- **Win Summary**: "Payline 7: 4 DICE = 35 credits"

### Example Visual:
```
   ┌─────────────────────────┐
   │  K   K   K   K   K  │ ← Payline 1 (highlighted in gold)
   │  Q   A   K   A   Q  │
   │  J   J   A   Q   J  │
   └─────────────────────────┘
   
   WIN: Payline 1 - 5 KING = 200 credits
```

---

## Differences from 243-Ways

### Old System (243-Ways):
- ✅ Any symbol on adjacent reels counts
- ✅ 3×3×3×3×3 = 243 possible combinations
- ✅ Simpler calculation
- ❌ Less traditional
- ❌ Harder to visualize wins

### New System (Paylines):
- ✅ Traditional slot machine feel
- ✅ Visual payline patterns
- ✅ Players understand "line wins"
- ✅ Can show exact winning path
- ❌ More complex to implement
- ❌ 25 separate checks per spin

---

## Testing Checklist

### Manual Tests:
- [ ] Straight line win (paylines 1-3)
- [ ] V-shape win (paylines 4-5)
- [ ] Zigzag win (paylines 6-9)
- [ ] Complex pattern win (paylines 10-25)
- [ ] WILD substitution (e.g., K-W-K-K-A)
- [ ] Multiple paylines win simultaneously
- [ ] Tarot column pays on paylines
- [ ] 3/4/5-of-a-kind payouts correct

### Edge Cases:
- [ ] All 25 paylines win (max win)
- [ ] No paylines win (total loss)
- [ ] WILD-only payline (W-W-W-W-W)
- [ ] Tarot triggers + payline wins
- [ ] 2-of-a-kind (should not pay)

---

## Phase 2 Implementation Plan

### Step 1: Payline Evaluator (Core Logic)
```typescript
class PaylineEvaluator {
  evaluatePayline(grid: Grid, payline: number[]): WinLine | null
  evaluateAllPaylines(grid: Grid): WinLine[]
  checkConsecutiveMatches(symbols: string[]): { symbol: string, count: number }
  applyWildSubstitution(symbols: string[]): string[]
}
```

### Step 2: Integration
- Update `GameController.spin()` to call evaluator
- Replace placeholder wins with real payline wins
- Update UI to show total win from all paylines

### Step 3: Testing
- Force specific grids (debug mode)
- Verify each payline individually
- Test all symbols at 3/4/5 match counts
- Validate WILD behavior

---

## Next Steps

### Ready to Implement:
1. ✅ Paylines defined (25 patterns)
2. ✅ Paytable configured
3. ✅ Types updated (WinLine interface)
4. ⏭️ **Build PaylineEvaluator** (Phase 2)
5. ⏭️ Visual payline overlay (Phase 3)

**Estimated Time**: 2-3 hours for Phase 2 implementation

---

**Status**: System redesigned for paylines ✅  
**Next**: Implement PaylineEvaluator.ts  
**Updated**: February 5, 2026
