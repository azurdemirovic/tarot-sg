# Tarot Slot Game - Complete Design Document

## Executive Summary

A browser-based 5×3 slot game prototype with a unique Tarot card mechanic. Tarot cards appear as full-column stacks and trigger special features only when 2+ of the same type land simultaneously. Built in PixiJS for rapid prototyping with plans to migrate to OpenGL.

---

## 1. Core Game Mechanics

### 1.1 Grid Configuration
- **Layout**: 5 reels (columns) × 3 rows (15 cells total)
- **Pay System**: 25 paylines (fixed patterns)
- **Bet System**: 1 credit per payline × 25 paylines = 25 credits per spin
- **Symbol Types**: 
  - Normal symbols (1×1 single cell)
  - Tarot symbols (3×1 full column stack)

### 1.2 Win Evaluation Flow
1. **Spin Result**: Symbols land, including tarot column stacks
2. **Trigger Check**: Detect if 2+ same-type tarot columns landed
3. **Feature Application**: Transform grid based on triggered feature
4. **Ways Calculation**: Evaluate final grid for winning combinations
5. **Mode Transition**: Enter feature modes (Priestess/Death) if triggered

### 1.3 Critical Rules

#### Single Tarot Behavior (Non-Trigger)
- **If exactly 1 tarot column lands**:
  - NO feature triggers
  - Column remains as a 3-cell stack
  - The same tarot symbol appears in all 3 rows of that reel
  - Paylines check the tarot symbol normally (like any other symbol)

#### Tarot Trigger Rule
- **Feature triggers ONLY when**: 2+ tarot columns of the SAME type land
- **Mixed tarots**: Do not trigger (e.g., 1 Fool + 1 Cups = no feature)
- **When triggered**:
  1. Triggering tarot columns disappear
  2. Freed cells reveal as **premium symbols** (unless feature specifies otherwise)
  3. Wins are then evaluated

---

## 2. Symbol Roster (FINAL)

### 2.1 Special Symbols
| ID | File | Type |
|----|------|------|
| WILD | WILD.png | Universal substitute |

### 2.2 Low-Tier Symbols (6 symbols)
| ID | File | Description |
|----|------|-------------|
| COIN | COIN.png | Gold coins |
| CUP | CUP.png | Chalice |
| KEY | KEY.png | Ornate key |
| SWORD | SWORD.png | Blade |
| RING | RING.png | Jeweled ring |
| FLEUR | FLEUR.png | Fleur-de-lis |

### 2.3 Premium Symbols (4 symbols)
| ID | File | Description |
|----|------|-------------|
| SKULLCROSS | SKULLCROSS.png | Skull with cross |
| DICE | DICE.png | Fortune dice |
| KING | KING.png | Crowned figure |
| ANGEL | ANGEL.png | Angelic figure |

### 2.4 Tarot Symbols (5 major arcana)
| ID | File | Rarity | Feature |
|----|------|--------|---------|
| T_FOOL | T_FOOL.jpg | Common | Wild/Premium reveal + multiplier |
| T_CUPS | T_CUPS.jpg | Common | Convert lows to premiums |
| T_LOVERS | T_LOVERS.jpg | Rare | Anchor box fill |
| T_PRIESTESS | T_PRIESTESS.jpg | Epic | Mystery feature mode |
| T_DEATH | T_DEATH.jpg | Epic | Reap & expand mode |

**Note**: Chariot is excluded from MVP scope.

### 2.5 Symbol Pools (for feature logic)
- **LOW_POOL**: COIN, CUP, KEY, SWORD, RING, FLEUR
- **PREMIUM_POOL**: SKULLCROSS, DICE, KING, ANGEL
- **WILD_POOL**: WILD only
- **TAROT_POOL**: T_FOOL, T_CUPS, T_LOVERS, T_PRIESTESS, T_DEATH

---

## 3. Feature Specifications

### 3.1 The Fool (Common Rarity)
**Theme**: Chaos and wild fortune

**Trigger**: 2+ T_FOOL columns land

**Effect (2 Fools)**:
1. Remove triggering Fool columns
2. In each freed Fool column:
   - Create 1–3 WILD cells (random)
   - Remaining cells become PREMIUM symbols
3. Apply **×3 multiplier** to total spin win
4. **Wild Cap**: Maximum 9 wilds total; excess becomes premium

**Effect (3+ Fools)**:
- Same as above, but:
  - Bias toward 2–3 wilds per column
  - Apply **×5 multiplier** instead
  - Still respects 9-wild cap

**Design Notes**:
- Premium symbols created here are normal (don't re-trigger tarots)
- Multiplier applies to final win after all transformations

---

### 3.2 Cups (Common Rarity)
**Theme**: Blessing and transformation

**Trigger**: 2+ T_CUPS columns land

**Effect (2 Cups)**:
1. Remove triggering Cups columns
2. Scan remaining grid for most common LOW symbol
   - If tie: use deterministic tie-break (leftmost, then topmost)
3. Convert **up to 4 instances** of that LOW symbol to PREMIUM
4. Freed Cups cells reveal PREMIUM symbols only
5. Evaluate wins

**Effect (3+ Cups)**:
- Same steps, but convert **up to 7 LOW symbols**

**Design Notes**:
- Only LOW symbols are candidates for conversion
- Premium reveals are random from PREMIUM_POOL
- Simplest feature—good for initial testing

---

### 3.3 The Lovers (Rare)
**Theme**: Connection and unity

**Trigger**: 2+ T_LOVERS columns land

**Core Mechanic**: Anchor Box Fill

**Steps**:
1. **Choose Bond Symbol** (weighted random):
   - LOW symbols: common probability
   - PREMIUM symbols: rare probability
   - Top-tier outcomes: nearly impossible
2. **Place Anchors** (1×1 markers on grid):
   - 2 Lovers → 2 anchors
   - 3 Lovers → 3 anchors
3. **Fill Bounding Rectangle**:
   - Calculate smallest rectangle containing all anchors
   - Fill entire rectangle with the Bond Symbol
4. Remove Lovers columns → freed cells reveal PREMIUM
5. Evaluate wins

**Scaling (2 Lovers)**:
- Anchors biased to be **closer together** (smaller rectangle)
- Apply **×2 multiplier** to spin win

**Scaling (3+ Lovers)**:
- Anchors can span **very large rectangles** (potentially near 5×3)
- No multiplier

**Design Notes**:
- Bond Symbol is used as-is (not converted to WILD)
- Rectangle can overlap with revealed premium cells
- Anchor placement is random but weighted by Lovers count

---

### 3.4 High Priestess (Epic)
**Theme**: Mystery and revelation

**Trigger**: 2+ T_PRIESTESS columns land

**Effect**: Enters **FEATURE_PRIESTESS mode**

**2 Priestess Mode**:
- Duration: **6 spins**
- No win multiplier

**3+ Priestess Mode**:
- Duration: **9 spins**
- Apply **×2 multiplier** to all wins during feature

**Per Spin Logic**:
1. **Pre-Spin Phase**:
   - Place 0–15 **mystery card-back covers** on random cells
2. **Spin Phase**:
   - Normal spin occurs
   - Grid populates normally
3. **Reveal Phase**:
   - Select one **Mystery Symbol** (weighted random from symbol table)
   - ALL covers flip to reveal the SAME chosen symbol
4. Evaluate wins

**Isolation Rule**:
- During Priestess feature, **other tarot features do NOT trigger**
- Tarot columns can still appear but only pay (no feature activation)

**Design Notes**:
- Mystery covers are visual placeholders
- All covers resolve to a single symbol per spin
- Creates anticipation and potential for massive same-symbol clusters

---

### 3.5 Death (Epic)
**Theme**: Reaping and expansion

**Trigger**: 2+ T_DEATH columns land

**Effect**: Enters **FEATURE_DEATH mode**

**Duration**: 10 spins

**Core Mechanic**: Cluster Slash & Grid Expansion

**Per Spin Logic**:
1. **Spin**: Generate symbols on current grid size (starts 5×3)
2. **Cluster Detection**:
   - Find all clusters of 2+ adjacent matching symbols
   - Adjacency: horizontal, vertical, OR diagonal
3. **Slash Execution** (1–3 slashes per spin):
   - Target largest cluster first
   - Slash removes ≥2 symbols from cluster
   - Collected symbols add to **Reap Bar**
4. **Refill**: Empty cells repopulate with new symbols
5. **Expansion Check**:
   - When Reap Bar reaches threshold (10 → 20 → 30):
   - Expand grid by **+1 column AND +1 row**
   - Grid grows: 5×3 → 6×4 → 7×5 → 8×6 (max 8×6)
6. Evaluate wins after refill

**Cluster Targeting Priority**:
1. Largest cluster size (most symbols)
2. Higher-paying symbol type
3. Leftmost position
4. Topmost position

**Slash Line Selection** (within chosen cluster):
1. Longest horizontal run of ≥2 symbols
2. Else longest vertical run
3. Else longest diagonal run
4. Else any valid 2+ symbols in cluster

**Design Notes**:
- Most complex feature—requires robust cluster detection
- Expansion dramatically increases ways (243 → 1536 → 16807 potential)
- Reap Bar thresholds are placeholder—tune during testing
- Grid expansion persists for remaining spins in feature

---

## 4. Technical Architecture

### 4.1 PixiJS Structure

```
src/
├── game/
│   ├── GameController.ts       # Main state machine
│   ├── RNG.ts                  # Seeded random number generator
│   ├── config/
│   │   ├── symbols.json        # Symbol definitions & weights
│   │   ├── tarots.json         # Tarot trigger rules
│   │   └── paytable.json       # Win values per symbol
│   ├── logic/
│   │   ├── spinGenerator.ts   # Generate spin results
│   │   ├── waysEvaluator.ts   # Calculate 243-ways wins
│   │   └── gridUtils.ts        # Coords, bounds, adjacency
│   ├── features/
│   │   ├── cups.ts
│   │   ├── fool.ts
│   │   ├── lovers.ts
│   │   ├── priestess.ts
│   │   └── death.ts
│   ├── render/
│   │   ├── GridView.ts         # Visual grid renderer
│   │   ├── SymbolSpriteFactory.ts
│   │   └── Animations.ts       # Tweens & effects
│   └── ui/
│       ├── HUD.ts              # Bet, win, balance display
│       └── DebugPanel.ts       # Force features, seed control
└── assets/
    ├── SYMBOLS/                # Renamed symbol PNGs
    └── TAROT CARDS/            # Renamed tarot JPGs
```

### 4.2 State Machine Modes

| Mode | Description | Transitions |
|------|-------------|-------------|
| BASE | Normal gameplay | → FEATURE_PRIESTESS or FEATURE_DEATH on trigger |
| FEATURE_PRIESTESS | 6-9 spins with mystery reveals | → BASE when spins exhausted |
| FEATURE_DEATH | 10 spins with reaping/expansion | → BASE when spins exhausted |

Each mode implements:
- `start()`: Initialize feature state
- `stepSpin()`: Execute one spin
- `isFinished()`: Check if mode should end

---

## 5. Development Phases

### Phase 1: Project Setup ✓
- [x] Create Vite + PixiJS project
- [x] Asset loader configuration
- [x] Basic grid renderer (5×3)
- [x] UI scaffolding (spin button, text displays)

### Phase 2: Core Game Logic
- [ ] Implement seeded RNG with debug seed control
- [ ] Create symbols.json configuration
- [ ] Build spin result generator
- [ ] Handle tarot column placement logic

### Phase 3: Ways Evaluation
- [ ] Implement 243-ways algorithm
- [ ] Create paytable.json with placeholder values
- [ ] Display win breakdown in debug panel

### Phase 4: Tarot System
- [ ] Detect 2+ same-type tarot triggers
- [ ] Implement removal and premium reveal
- [ ] Verify single tarot pays correctly

### Phase 5: Feature Implementation
- [ ] **Cups**: Convert LOW → PREMIUM (simplest)
- [ ] **Fool**: Wild/premium reveal + multiplier + cap
- [ ] **Lovers**: Anchor placement + bounding box fill
- [ ] **Priestess**: Feature mode with mystery covers
- [ ] **Death**: Cluster detection, slashing, expansion

### Phase 6: Debug Tools (REQUIRED)
- [ ] Force specific tarot types on next spin
- [ ] Show cluster detection visualization (Death)
- [ ] Show anchor coordinates (Lovers)
- [ ] Display feature mode & remaining spins
- [ ] RNG seed input field

### Phase 7: Polish
- [ ] Tarot column land animation
- [ ] Tarot removal transition
- [ ] Slash trails (Death)
- [ ] Mystery flip animation (Priestess)
- [ ] Reap bar fill animation
- [ ] Responsive layout scaling

---

## 6. Migration to OpenGL (Phase 2)

### 6.1 Preserve (No Changes)
✅ **All game logic modules**:
- spinGenerator.ts
- waysEvaluator.ts
- features/*.ts
- RNG.ts

✅ **Configuration files**:
- symbols.json
- tarots.json
- paytable.json

### 6.2 Rewrite (Rendering Only)
🔄 **Rendering layer**:
- PixiJS sprites → OpenGL textured quads
- Text rendering → Bitmap fonts or SDF
- Animation system → Custom timeline/tweens in C++

### 6.3 Recommended Approach
1. Treat browser version as **reference implementation**
2. Port TypeScript logic to C++ 1:1
3. OR keep logic in JSON-driven rules + small interpreter

---

## 7. MVP Scope

### ✅ Included in MVP
- Base game: 5×3, 243 ways, symbol rendering
- Tarot column rendering + paying behavior
- Trigger system (2+ same tarot)
- All 5 features: Cups, Fool, Lovers, Priestess, Death
- Minimal UI: Spin, bet, win, balance
- **Debug overlay**: Force tarots, seed RNG, feature state

### ❌ Excluded from MVP
- Chariot feature (future expansion)
- Sound effects/music (optional later)
- Full RTP simulation and tuning
- Complex animation polish

---

## 8. Testing Checklist

### Base Game
- [ ] Single tarot pays correctly (3 symbols)
- [ ] Mixed tarots don't trigger features
- [ ] 243-ways calculation verified on paper
- [ ] RNG seed produces consistent results

### Cups Feature
- [ ] Correctly identifies most common LOW
- [ ] Converts exactly 4 (2 Cups) or 7 (3 Cups)
- [ ] Freed cells show PREMIUM only

### Fool Feature
- [ ] Wild cap enforced (max 9)
- [ ] Multiplier applied (×3 or ×5)
- [ ] Overflow wilds become premium

### Lovers Feature
- [ ] Anchor placement visible
- [ ] Bounding box calculated correctly
- [ ] Bond symbol fills entire rectangle
- [ ] ×2 multiplier for 2 Lovers

### Priestess Feature
- [ ] Lasts correct duration (6 or 9 spins)
- [ ] Mystery covers placed randomly (0-15)
- [ ] All covers reveal same symbol
- [ ] ×2 multiplier for 3+ Priestess
- [ ] Other tarots don't trigger during mode

### Death Feature
- [ ] Lasts 10 spins
- [ ] Cluster detection works (diagonal included)
- [ ] Slash targets largest cluster
- [ ] Reap bar increments correctly
- [ ] Grid expands at thresholds (10/20/30)
- [ ] Expanded grid persists between spins

---

## 9. Asset Naming Convention (FINAL)

### SYMBOLS Folder (PNG format)
```
WILD.png
COIN.png
CUP.png
KEY.png
SWORD.png
RING.png
FLEUR.png
SKULLCROSS.png
DICE.png
KING.png
ANGEL.png
```

### TAROT CARDS Folder (JPG format)
```
T_FOOL.jpg
T_CUPS.jpg
T_LOVERS.jpg
T_PRIESTESS.jpg
T_DEATH.jpg
```

All files should have:
- Transparent backgrounds (PNG for symbols)
- Consistent resolution (recommend 256×256 or 512×512)
- Uppercase naming for easy config matching

---

## 10. Quick Reference Tables

### Symbol ID Quick Lookup
```
WILD         → Wild symbol
COIN, CUP, KEY, SWORD, RING, FLEUR  → Low-tier
SKULLCROSS, DICE, KING, ANGEL       → Premium
T_FOOL, T_CUPS, T_LOVERS, T_PRIESTESS, T_DEATH → Tarot
```

### Feature Trigger Summary
```
T_FOOL       → 2+: Wild reveal + multiplier (×3 or ×5)
T_CUPS       → 2+: LOW → PREMIUM conversion (4 or 7)
T_LOVERS     → 2+: Anchor box fill + ×2 (if 2)
T_PRIESTESS  → 2+: Mystery mode (6 or 9 spins) + ×2 (if 3+)
T_DEATH      → 2+: Reap mode (10 spins, cluster slash, expand)
```

### Multiplier Quick Reference
```
2 Fool      → ×3
3+ Fool     → ×5
2 Lovers    → ×2
3+ Priestess → ×2 (applies to all spins in feature)
```

---

## 11. Common Questions (FAQ)

**Q: What happens if 2 Fools + 2 Cups land together?**  
A: Only one feature triggers per spin. Priority is undefined in spec—suggest: last tarot type detected, or implement priority order (Death > Priestess > Lovers > Fool > Cups).

**Q: Can mystery covers land on tarot columns during Priestess mode?**  
A: Spec says tarots don't trigger features during Priestess mode. They can appear as paying symbols. Mystery covers likely don't overlap tarots—covers placed after spin resolves.

**Q: What's the maximum grid size in Death feature?**  
A: Not specified, but 8×6 is reasonable limit (7776 ways). Thresholds 10 → 20 → 30 allow 3 expansions: 5×3 → 6×4 → 7×5 → 8×6.

**Q: Do wins during Death feature count toward Reap Bar?**  
A: No—only slashed symbols fill the bar. Wins are evaluated separately after refill.

**Q: Can Lovers Bond Symbol be WILD?**  
A: Not specified. Suggest: LOW (common), PREMIUM (rare), WILD (nearly impossible, epic outcome).

---

## 12. Next Steps

1. ✅ Create this documentation
2. ✅ Rename all assets to match specification
3. 🟡 Initialize Vite + PixiJS project structure
4. 🟡 Implement Phase 2: RNG + spin generator
5. 🟡 Continue through phases sequentially

**Development Priority**: Cups → Fool → Lovers → Priestess → Death

---

**Document Version**: 1.0  
**Last Updated**: February 5, 2026  
**Status**: Pre-Development (Asset Preparation Phase)
