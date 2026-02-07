# Tarot Slot Game - Project Summary

## 🎯 What We're Building

A **browser-based slot game prototype** with a unique Tarot card mechanic that stands out from traditional slots. This is designed to be a **portfolio piece** showcasing:

1. **Complex game logic** implementation
2. **State machine** architecture
3. **WebGL rendering** via PixiJS
4. **Data-driven design** (JSON configs)
5. **Deterministic systems** (seeded RNG for reproducibility)

---

## 🎰 Core Gameplay Hook

### The Tarot Twist
- Normal slots: symbols land, you get paid
- **This game**: Tarot cards appear as **full 3-cell columns**
- **The hook**: Tarots are ALWAYS paying symbols, BUT...
  - **1 tarot** = just pays normally (no feature)
  - **2+ of the SAME tarot** = triggers powerful feature!

This creates **anticipation tension**: "I have one Fool... will another land?"

---

## 🎴 The 5 Tarot Features (Complexity Ladder)

### 1. **Cups** (Easiest - Start Here)
- Converts common symbols → premium symbols
- **Teaches**: Grid manipulation, symbol replacement

### 2. **Fool** (Medium)
- Creates wild symbols + applies multiplier
- **Teaches**: Wild cap logic, multiplier system

### 3. **Lovers** (Complex)
- Places "anchor" points, fills rectangle with chosen symbol
- **Teaches**: Geometric calculations, bounding boxes

### 4. **Priestess** (Epic - Feature Mode)
- Enters 6-9 spin **bonus mode**
- Each spin: mystery cards flip to reveal same symbol
- **Teaches**: Game state modes, multi-spin features

### 5. **Death** (Most Complex - Feature Mode)
- Enters 10-spin **expansion mode**
- Detects symbol clusters → slashes them → collects to bar
- **Bar fills → Grid expands** (5×3 → 6×4 → 7×5 → 8×6)
- **Teaches**: Cluster detection (flood fill), dynamic grid sizing

---

## 🏗️ Technical Architecture

### Clean Separation of Concerns

```
Game Logic (Pure TypeScript)
├── RNG.ts                    ← Seeded random (deterministic)
├── spinGenerator.ts          ← Creates spin results
├── waysEvaluator.ts          ← Calculates wins (243 ways)
├── features/                 ← Each feature is isolated module
│   ├── cups.ts
│   ├── fool.ts
│   ├── lovers.ts
│   ├── priestess.ts
│   └── death.ts
└── gridUtils.ts              ← Helper functions (bounds, adjacency)

Rendering Layer (PixiJS)
├── GridView.ts               ← Visual representation
├── SymbolSpriteFactory.ts    ← Asset management
└── Animations.ts             ← Visual effects

Configuration (JSON)
├── symbols.json              ← Symbol definitions, weights
├── tarots.json               ← Tarot trigger rules
└── paytable.json             ← Win values
```

**Why this matters**: When you migrate to OpenGL (C++), only the rendering layer changes. All game logic stays identical.

---

## 🔬 Debug-First Philosophy

**This is a portfolio piece**, so we build **powerful debug tools** from day one:

### Debug Panel Features
- **Force Tarot Drops**: "Next spin: 2 Death tarots on reels 1 & 3"
- **RNG Seed Control**: Reproduce any spin exactly
- **Visual Overlays**:
  - Cluster detection map (Death)
  - Anchor points & bounding box (Lovers)
  - Mystery card positions (Priestess)
- **State Display**: Current mode, remaining spins, reap bar value

**Why**: Shows interviewers you understand testability and debugging.

---

## 📊 Development Phases (Organized Progression)

### ✅ Phase 0: Documentation & Assets (COMPLETE)
- [x] Created comprehensive game design doc
- [x] Created technical reference for AI assistants
- [x] Renamed all assets to spec
- [x] Created asset reference guide

### 🟡 Phase 1: Project Setup (NEXT)
**Deliverables**:
- Vite + PixiJS project initialized
- Asset loader configured
- 5×3 grid renderer working
- Basic UI (spin button, win display)

**Validation**: Click spin → see 5×3 grid of random symbols

---

### 🟡 Phase 2: Core Game Logic
**Deliverables**:
- Seeded RNG implementation
- `symbols.json` configuration
- Spin result generator
- Tarot column placement

**Validation**: Consistent spins from same seed, tarots appear as 3-cell stacks

---

### 🟡 Phase 3: Win Evaluation
**Deliverables**:
- 243-ways algorithm
- `paytable.json` with placeholder values
- Win breakdown display

**Validation**: Manual verification of ways calculation

---

### 🟡 Phase 4: Tarot Trigger System
**Deliverables**:
- Detect 2+ same-type tarots
- Remove & reveal premium symbols
- Single tarot pays correctly

**Validation**: 
- 1 tarot → pays, no feature
- 2 same tarots → feature triggers
- Mixed tarots → no feature

---

### 🟡 Phase 5A: Cups Feature
**Deliverables**:
- Find most common LOW symbol
- Convert 4 or 7 instances to PREMIUM
- Freed tarot cells reveal premium

**Validation**: Count conversions manually, verify correct symbols targeted

---

### 🟡 Phase 5B: Fool Feature
**Deliverables**:
- Random wild placement (1-3 per column)
- Wild cap enforcement (max 9)
- Multiplier application (×3 or ×5)

**Validation**: Force 3 Fools, verify cap works, check multiplier

---

### 🟡 Phase 5C: Lovers Feature
**Deliverables**:
- Anchor placement (2 or 3)
- Bounding box calculation
- Bond symbol fill
- ×2 multiplier for 2 Lovers

**Validation**: Visual debug overlay shows anchors and box

---

### 🟡 Phase 5D: Priestess Feature
**Deliverables**:
- Feature mode state machine
- Mystery cover placement (0-15)
- Single symbol reveal
- Mode isolation (no other tarots trigger)

**Validation**: Enter mode, verify 6 or 9 spins, test isolation

---

### 🟡 Phase 5E: Death Feature
**Deliverables**:
- Cluster detection (8-directional adjacency)
- Slash line selection (longest run)
- Reap bar and thresholds
- Grid expansion (5×3 → 6×4 → 7×5 → 8×6)

**Validation**: Visual cluster map, verify expansion persists

---

### 🟡 Phase 6: Debug Tools
**Deliverables**:
- Force tarot dropdown
- Seed input field
- Feature state display
- Visual overlays

**Validation**: Force each feature, verify reproducibility

---

### 🟡 Phase 7: Polish
**Deliverables**:
- Basic animations (tarot land, removal, slashes)
- Responsive layout
- Bar fill animation

**Validation**: Smooth visual experience, scales to window

---

## 🎓 What Makes This Portfolio-Worthy

### 1. **Complexity Spectrum**
- Simple features (Cups) → Complex (Death)
- Shows you can handle escalating difficulty

### 2. **State Management**
- BASE mode vs. FEATURE_PRIESTESS vs. FEATURE_DEATH
- Clean transitions, isolated logic

### 3. **Algorithmic Challenges**
- **243-ways evaluation**: Combinatorial logic
- **Cluster detection**: Graph algorithms (flood fill)
- **Bounding box**: Geometric calculations
- **Weighted randomization**: Probability distributions

### 4. **Testability**
- Deterministic RNG (reproduce any bug)
- Debug tools (show internal state)
- Modular features (test in isolation)

### 5. **Migration Path**
- PixiJS prototype → OpenGL production
- Same logic, different rendering
- Proves you understand separation of concerns

---

## 🚀 Why This Approach Works

### For Interviews
**Interviewer**: "Walk me through a complex system you've built."

**You**: "I built a slot game with 5 different feature modes. Let me show you the Death feature—it detects clusters using flood fill, then expands the grid dynamically. Here's the debug overlay showing cluster detection in real-time..."

### For Portfolio
- **GitHub**: Clean, documented codebase with README
- **Live Demo**: Browser playable link
- **OpenGL Version**: Shows C++ skills
- **Blog Post**: "Building a Data-Driven Slot Game: PixiJS to OpenGL"

---

## 📝 Development Principles

### 1. **One Feature at a Time**
Don't build everything at once. Cups → Fool → Lovers → etc.

### 2. **Test Before Moving On**
Each feature needs validation before starting the next.

### 3. **Debug Tools from Day One**
Don't bolt them on at the end. Build them as you go.

### 4. **Document Decisions**
When you make a choice (e.g., "bar resets after expansion"), write it down.

### 5. **Keep Logic Separate from Rendering**
All game logic should work without PixiJS (unit testable).

---

## 🎯 Success Criteria (MVP Complete)

- [ ] All 5 tarot features working correctly
- [ ] Debug tools functional (force tarots, seed control)
- [ ] Visual feedback for all features
- [ ] Single tarot pays without triggering
- [ ] Mixed tarots don't trigger
- [ ] Feature modes work correctly (6/9/10 spins)
- [ ] Grid expansion works (Death)
- [ ] Reproducible results from same seed

---

## 🔮 Future Enhancements (Post-MVP)

### Gameplay
- Chariot feature (6th tarot)
- Free spins on scatter symbols
- Progressive jackpot
- RTP tuning and math model

### Technical
- Sound effects and music
- Advanced animations (particle effects)
- Mobile touch controls
- Networked multiplayer (leaderboards)

### Portfolio
- OpenGL migration completed
- Shader effects (glow, trails)
- Performance profiling blog post
- "Making of" video

---

## 📁 Current Project Status

### ✅ Completed
- Comprehensive documentation (3 reference docs)
- Asset renaming (all files ready)
- Project structure planned
- Development roadmap defined

### 🟡 Ready to Start
- Phase 1: Project setup
  - Initialize Vite + PixiJS
  - Configure asset loader
  - Build grid renderer
  - Add basic UI

### ⏱️ Estimated Timeline
- **Phase 1**: 1-2 hours (setup)
- **Phase 2-3**: 2-3 hours (core logic)
- **Phase 4**: 1 hour (tarot system)
- **Phase 5A-C**: 3-4 hours (simple features)
- **Phase 5D-E**: 4-6 hours (complex features)
- **Phase 6**: 2 hours (debug tools)
- **Phase 7**: 2-3 hours (polish)

**Total MVP**: ~15-20 hours of focused development

---

## 🎬 Next Step Decision

**We are here**: Assets ready, documentation complete

**Next**: Phase 1 - Project Setup

### What Phase 1 Involves:
1. Initialize Vite project with TypeScript
2. Install PixiJS dependencies
3. Create folder structure (game/, render/, ui/, config/)
4. Set up asset loader
5. Build basic 5×3 grid renderer
6. Add spin button and win text display
7. Test: Click spin → see random symbols

### Before Starting:
- **Question for you**: Do you have Node.js installed?
- **Question for you**: Any preference for package manager (npm, pnpm, yarn)?
- **Question for you**: Do you want me to explain each step as I go, or just build it?

---

**Status**: Ready to begin Phase 1  
**Waiting for**: Your approval to proceed  
**Estimated Time for Phase 1**: 1-2 hours
