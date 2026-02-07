# Asset Reference - Tarot Slot Game

## File Naming Complete ✅

All assets have been renamed to match the game specification.

---

## Symbol Assets (SYMBOLS folder)

### Special
- `WILD.png` → Wild symbol (universal substitute)

### Low-Tier Symbols (6 total)
- `COIN.png` → Gold coins
- `CUP.png` → Chalice
- `KEY.png` → Ornate key
- `SWORD.png` → Blade
- `RING.png` → Jeweled ring
- `FLEUR.png` → Fleur-de-lis (single flower)

### Premium Symbols (4 total)
- `SKULLCROSS.png` → Skull with cross (was premium.png)
- `DICE.png` → Fortune dice
- `KING.png` → Crowned figure
- `ANGEL.png` → Angelic figure

---

## Tarot Assets (TAROT CARDS folder)

### Active Tarot Cards (5 major arcana)
- `T_FOOL.jpg` → The Fool (Common) - Wild reveal + multiplier
- `T_CUPS.jpg` → Cups (Common) - Convert LOW to PREMIUM
- `T_LOVERS.jpg` → The Lovers (Rare) - Anchor box fill
- `T_PRIESTESS.jpg` → High Priestess (Epic) - Mystery feature mode
- `T_DEATH.jpg` → Death (Epic) - Reap & expand mode

### Unused (Future Expansion)
- `chariot.jpg` → The Chariot (excluded from MVP)

---

## Asset Requirements

### Technical Specifications
- **Symbols**: PNG format with transparent backgrounds
- **Tarots**: JPG format (full-bleed card art)
- **Recommended Resolution**: 256×256 or 512×512 pixels
- **Aspect Ratio**: Square (1:1) for symbols, card ratio for tarots

### Configuration Mapping
All asset filenames match the `id` field in `symbols.json`:

```json
{
  "id": "COIN",
  "filename": "COIN.png",
  ...
}
```

---

## Symbol Pools (for feature logic)

### LOW_POOL
Used by Cups feature for conversion targets:
```
COIN, CUP, KEY, SWORD, RING, FLEUR
```

### PREMIUM_POOL
Used for reveal/conversion destinations:
```
SKULLCROSS, DICE, KING, ANGEL
```

### TAROT_POOL
Column-stack symbols that trigger features:
```
T_FOOL, T_CUPS, T_LOVERS, T_PRIESTESS, T_DEATH
```

---

## Visual Design Notes

### Symbol Hierarchy (Visual Weight)
1. **WILD** - Most eye-catching, glowing/magical
2. **ANGEL** - Highest premium, divine/radiant
3. **KING** - High premium, regal/commanding
4. **DICE** - Mid premium, fortune/luck theme
5. **SKULLCROSS** - Base premium, gothic/mystical
6. **FLEUR** - Highest low, ornate but simple
7. **RING, SWORD, KEY** - Mid low, recognizable icons
8. **CUP, COIN** - Base low, common items

### Tarot Cards (Visual Style)
- Full tarot card artwork (Rider-Waite or similar style)
- Should stand out from normal symbols
- Occupy 3 vertical cells when displayed
- Suggest distinct color schemes per card:
  - **Fool**: Yellow/gold (beginnings)
  - **Cups**: Blue/silver (emotions)
  - **Lovers**: Pink/red (connection)
  - **Priestess**: Purple/violet (mystery)
  - **Death**: Black/white (transformation)

---

## Asset Checklist

### Pre-Development Verification
- [x] All symbol PNGs renamed correctly
- [x] All tarot JPGs renamed correctly
- [ ] Verify transparent backgrounds on symbols
- [ ] Verify consistent resolution across assets
- [ ] Test asset loading in PixiJS
- [ ] Confirm visual hierarchy is clear

### Development Integration
- [ ] Create `symbols.json` with correct filenames
- [ ] Set up asset loader paths
- [ ] Test sprite rendering
- [ ] Verify tarot column stacking visuals
- [ ] Test grid scaling and positioning

---

**Status**: Assets renamed and ready for development  
**Next Step**: Initialize PixiJS project structure
