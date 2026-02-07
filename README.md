# Tarot Slot Game

A browser-based 5x3 Tarot-themed slot machine prototype built with **PixiJS 8**, **TypeScript**, and **Vite**.

Designed as a portfolio piece demonstrating game logic, animation systems, and clean architecture — intended for eventual migration to an OpenGL/native build.

## What's Implemented (v1.0.0 MVP)

### Core Game Engine
- **5x3 symbol grid** with 12 normal symbols + 1 WILD + 5 tarot cards
- **Deterministic RNG** (seeded) for reproducible spins
- **Spin generator** with weighted symbol distribution
- **Game state machine** managing spin lifecycle (IDLE → SPINNING → COMPLETING)

### Pay System
- **25 fixed paylines** defined via ASCII-art notation with automatic parsing
- **Payline evaluator** with left-to-right matching
- **WILD substitution** (WILD counts as any normal symbol)
- **Paytable** with payout multipliers for 3/4/5 symbol matches
- **Visual payline overlays** — colored lines drawn on winning paylines

### Animation System
- **Reel spinning** with downward scroll (symbols fall from top)
- **Sequential reel stops** — left to right, 200ms stagger, individual bounces
- **Hurry-up mechanic** — double-click after 250ms to speed up remaining reels (60ms stagger)
- **Bounce physics** — overshoot + spring-back on landing
- **Proper state machine** preventing click spam / state locks
- **Tease system** — premium symbols shown during spin filler

### UI / Visuals
- Custom frame border (`frame.png`) overlaying the grid
- Custom spin button with `button.png` background
- Custom font (`font.ttf`) applied globally
- Balance and win display in EUR (€)
- Initial balance: 100.00 €, bet: 0.20 € per spin
- Debug panel showing seed, mode, top symbol, tarot info

### Architecture
- Data-driven config: `symbols.json`, `paytable.json`, `paylines.ts`
- Clean separation: `AssetLoader`, `GameController`, `SpinGenerator`, `PaylineEvaluator`
- Render layer: `GridView`, `ReelSpinner`, `PaylineOverlay`
- Masked reel containers (no symbol overflow during scroll)

## What's NOT Done Yet

### Paylines & RTP
- [ ] Payline payout values are placeholder — not mathematically balanced
- [ ] No RTP (Return to Player) calculation or verification
- [ ] No hit frequency analysis
- [ ] Paytable multipliers need tuning for target RTP (e.g. 96%)

### Tarot Features (Designed, Not Implemented)
- [ ] **The Priestess** — full-column WILD expansion
- [ ] **Death** — symbol transformation mechanic
- [ ] **The Fool** — random bonus trigger
- [ ] **The Lovers** — symbol pairing mechanic
- [ ] **The Chariot** — progressive multiplier
- [ ] **Ace of Cups** — free spins / re-spin feature
- [ ] Tarot column stack detection logic
- [ ] Feature trigger animations and transitions

### Missing Game Features
- [ ] Free spins / bonus rounds
- [ ] Win celebration animations (big win, mega win)
- [ ] Sound effects and music
- [ ] Bet adjustment UI (currently fixed at 0.20 €)
- [ ] Autoplay functionality
- [ ] Win amount animated counter
- [ ] Symbol match highlight animations
- [ ] Responsive layout / mobile support

### Technical Debt
- [ ] No unit tests
- [ ] No build optimization / asset compression
- [ ] Empty `features/` and `ui/` directories (scaffolded, not used)
- [ ] Console logs still present (debug)

## Tech Stack

| Tool | Version |
|------|---------|
| PixiJS | 8.7.x |
| TypeScript | 5.6.x |
| Vite | 6.0.x |

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Project Structure

```
├── docs/              # Design documents & references
├── public/
│   ├── assets/
│   │   ├── symbols/   # Game symbol PNGs + UI assets
│   │   └── tarots/    # Tarot card images
│   └── fonts/         # Custom font
├── src/
│   ├── main.ts        # Entry point, state machine, UI wiring
│   └── game/
│       ├── config/    # symbols.json, paytable.json, paylines.ts
│       ├── logic/     # SpinGenerator, PaylineEvaluator
│       ├── render/    # GridView, ReelSpinner, PaylineOverlay
│       ├── AssetLoader.ts
│       ├── GameController.ts
│       ├── RNG.ts
│       └── Types.ts
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## License

Portfolio project — not licensed for commercial use.
