import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { AssetLoader } from '../AssetLoader';
import { FeatureTrigger, Grid } from '../Types';
import { LoversResult, LoversSpinResult } from '../logic/TarotFeatureProcessor';
import { ReelSpinner } from './ReelSpinner';
import { GridView } from './GridView';
import { WinDisplay } from './WinDisplay';
import { ThreeBackground } from '../../threeBackground';
import { playTarotTearEffects } from './TearEffectHelper';
import { tween, wait, easeOutCubic, easeOutBack, spawnDarkParticleGlow } from '../utils/AnimationUtils';
import { soundManager } from '../utils/SoundManager';
import { FeatureWinTracker } from './FeatureWinTracker';

// ═══════════════════════════════════════════════════════════════
//  LoversRevealAnimation
//  Multi-spin Lovers feature:
//    Per spin: Card Pick → MALE/FEMALE anchors appear & move → Bond fill
// ═══════════════════════════════════════════════════════════════
export class LoversRevealAnimation {
  private overlay: Container;
  private dimGraphic: Graphics;
  private glowContainer: Container;
  private cardContainer: Container;
  private spinCounterText: Text | null = null;

  constructor(
    private parent: Container,
    private reelSpinners: ReelSpinner[],
    private assetLoader: AssetLoader,
    private cellSize: number,
    private padding: number,
    private cols: number,
    private rows: number,
    private gridView: GridView,
    private threeBg: ThreeBackground | null = null,
    private pixiCanvas: HTMLCanvasElement | null = null,
  ) {
    this.overlay = new Container();
    this.dimGraphic = new Graphics();
    this.glowContainer = new Container();
    this.cardContainer = new Container();
  }

  // ── Public entry point ────────────────────────────────────
  async play(
    feature: FeatureTrigger,
    loversResult: LoversResult,
    onSelection: (selectedIndex: number) => {
      spinResult: LoversSpinResult;
      finalGrid: Grid;
      wins: any[];
      totalWin: number;
      multiplier: number;
    },
    onGenerateFreshGrid: () => Grid,
    betAmount: number
  ): Promise<void> {
    const totalWidth = this.cols * (this.cellSize + this.padding) - this.padding;
    const totalHeight = this.rows * (this.cellSize + this.padding) - this.padding;

    // Persistent "WON" total display below the frame
    const winTracker = new FeatureWinTracker();

    // Mount overlay layers
    this.parent.addChild(this.overlay);
    this.overlay.addChild(this.glowContainer);
    this.overlay.addChild(this.cardContainer);

    try {
      // Phase A — Hide Lovers tarot columns (tear starts immediately)
      // Start tear (don't await — premium reveal starts alongside the tear)
      const tearPromise = this.phaseHideLovers(feature);

      // Phase B — Show freed Lovers columns with premium symbols (runs concurrently with tear)
      await Promise.all([tearPromise, this.phaseRevealPremiums(feature, loversResult)]);
      await wait(400);

      // Phase C — Multi-spin loop
      while (loversResult.spinsRemaining > 0) {
        const spinNum = loversResult.spinsTotal - loversResult.spinsRemaining + 1;

        // Show spin counter on overlay
        await this.showSpinCounter(spinNum, loversResult.spinsTotal, totalWidth);

        // C1: Card pick — show 3 card backs, player picks one → flip reveal
        const candidates = this.generateCandidates();
        loversResult.currentSpin = {
          bondSymbolId: '',
          candidateSymbols: candidates,
          selectedIndex: -1,
          malePos: { col: 0, row: 0 },
          femalePos: { col: 0, row: 0 },
          filledCells: [],
          boundingRect: { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 },
          transformedGrid: [],
        };

        const selectedIndex = await this.phaseCardPick(candidates, totalWidth, totalHeight);

        // C2: Generate a fresh grid for this spin, then spin-drop it onto the table
        const freshGrid = onGenerateFreshGrid();
        await this.phaseShowFreshGrid(freshGrid);

        const result = onSelection(selectedIndex);
        const spinResult = result.spinResult;

        // C3: Animate MALE and FEMALE anchors appearing and moving to positions
        await this.phaseAnchors(spinResult);

        // C4: Animate bond fill over the bounding rectangle (area creation)
        await this.phaseBondFill(spinResult, result.finalGrid);

        // C5: Accumulate payout and update persistent WON display
        if (result.wins.length > 0 && result.totalWin > 0) {
          await winTracker.addWin(result.totalWin);
        }

        // C6: Show per-spin win using WinDisplay (only if win > 10× bet)
        const winDisplay = new WinDisplay(this.parent);
        await winDisplay.show(result.wins, result.multiplier, result.totalWin, betAmount, totalWidth, totalHeight);

        await wait(400);
      }
    } finally {
      winTracker.dispose();
      this.cleanup();
    }
  }

  // ── Phase A: Hide Lovers tarot columns (with tear effect) ──
  // Pre-generates premium symbols so they're visible underneath the tear.
  private async phaseHideLovers(feature: FeatureTrigger): Promise<void> {
    // Generate premium symbols to place underneath the tarot before tearing
    const premiumPool = this.assetLoader.getSymbolsByTier('PREMIUM')
      .filter(s => !LoversRevealAnimation.ANCHOR_SYMBOLS.has(s.id));

    const finalSymbolIds = new Map<number, string[]>();
    for (const col of feature.columns) {
      const symbolIds: string[] = [];
      for (let row = 0; row < this.rows; row++) {
        symbolIds.push(premiumPool[Math.floor(Math.random() * premiumPool.length)].id);
      }
      finalSymbolIds.set(col, symbolIds);
    }

    if (this.threeBg && this.pixiCanvas) {
      await playTarotTearEffects(
        this.threeBg,
        feature.columns,
        feature.type,
        this.reelSpinners,
        this.cellSize,
        this.padding,
        this.rows,
        this.pixiCanvas,
        finalSymbolIds
      );
    } else {
      // Fallback: set symbols directly
      for (const col of feature.columns) {
        this.reelSpinners[col].setSymbols(finalSymbolIds.get(col)!, false);
        this.reelSpinners[col].setColumnVisible(true);
      }
    }
  }

  // ── Phase B: Reveal freed columns with premium symbols ──
  // Symbols are already visible from the tear — just ensure columns are shown.
  private async phaseRevealPremiums(feature: FeatureTrigger, _loversResult: LoversResult): Promise<void> {
    const sortedCols = [...feature.columns].sort((a, b) => a - b);

    for (const col of sortedCols) {
      this.reelSpinners[col].setColumnVisible(true);
    }
  }

  // ── Phase C1: Card Pick ─────────────────────────────────
  // Shows 3 card backs, player clicks one, it flips to reveal the bond symbol.
  private async phaseCardPick(
    candidates: string[],
    totalWidth: number,
    totalHeight: number
  ): Promise<number> {
    // Dim the grid
    this.dimGraphic.clear();
    this.dimGraphic.rect(-40, -40, totalWidth + 80, totalHeight + 80);
    this.dimGraphic.fill({ color: 0x000000, alpha: 0.55 });
    this.overlay.addChildAt(this.dimGraphic, 0);

    // "Pick a card" title
    const title = new Text({
      text: 'Choose your bond symbol',
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 28,
        fill: 0xFFD700,
        stroke: { color: 0x000000, width: 4 },
      }),
    });
    title.anchor.set(0.5);
    title.x = totalWidth / 2;
    title.y = totalHeight / 2 - 130;
    this.cardContainer.addChild(title);

    // Card layout
    const cardWidth = 130;
    const cardHeight = 170;
    const gap = 24;
    const totalCardsWidth = 3 * cardWidth + 2 * gap;
    const startX = totalWidth / 2 - totalCardsWidth / 2 + cardWidth / 2;
    const cardY = totalHeight / 2 + 10;

    // Get the Lovers cardback texture
    const cardbackTexture = this.assetLoader.getTexture('CARDBACK_LOVERS');

    // Wait for player to click a card back
    const selectedIndex = await new Promise<number>((resolve) => {
      const cardGroups: Container[] = [];

      for (let i = 0; i < 3; i++) {
        const cardGroup = new Container();
        cardGroup.x = startX + i * (cardWidth + gap);
        cardGroup.y = cardY;
        cardGroup.eventMode = 'static';
        cardGroup.cursor = 'pointer';

        // Card back: image stretched to card size, or fallback
        if (cardbackTexture) {
          const backSprite = new Sprite(cardbackTexture);
          backSprite.anchor.set(0.5);
          backSprite.width = cardWidth;
          backSprite.height = cardHeight;
          cardGroup.addChild(backSprite);
        } else {
          const bg = new Graphics();
          bg.roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 10);
          bg.fill({ color: 0x2a0a3e, alpha: 0.95 });
          bg.stroke({ color: 0xFFD700, width: 2 });
          cardGroup.addChild(bg);

          const qMark = new Text({
            text: '?',
            style: new TextStyle({
              fontFamily: 'CustomFont, Arial, sans-serif',
              fontSize: 56,
              fill: 0xFFD700,
            }),
          });
          qMark.anchor.set(0.5);
          cardGroup.addChild(qMark);
        }

        // Hover effect
        cardGroup.on('pointerover', () => {
          cardGroup.scale.set(1.06);
        });
        cardGroup.on('pointerout', () => {
          cardGroup.scale.set(1.0);
        });

        // Click handler
        const index = i;
        cardGroup.on('pointertap', () => {
          for (const cg of cardGroups) {
            cg.eventMode = 'none';
            cg.cursor = 'default';
          }
          resolve(index);
        });

        cardGroups.push(cardGroup);
        this.cardContainer.addChild(cardGroup);
      }
    });

    // ── Flip animation: scale X → 0 (back disappears), build front, scale X → 1 ──
    const selectedCard = this.cardContainer.children[selectedIndex + 1] as Container; // +1 for title
    if (selectedCard) {
      // Phase 1: Shrink horizontally (card back disappearing)
      await tween(200, (t) => {
        selectedCard.scale.x = 1.06 * (1 - t);
      });

      // Replace back content with the front — plain white card with symbol
      selectedCard.removeChildren();

      // Plain white background
      const bg = new Graphics();
      bg.roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 10);
      bg.fill({ color: 0xFFFFFF, alpha: 1 });
      selectedCard.addChild(bg);

      // Symbol centered on the white card
      const symbolTexture = this.assetLoader.getTexture(candidates[selectedIndex]);
      if (symbolTexture) {
        const symbolSize = Math.min(cardWidth, cardHeight) - 30;
        const symbol = new Sprite(symbolTexture);
        symbol.anchor.set(0.5);
        symbol.width = symbolSize;
        symbol.height = symbolSize;
        selectedCard.addChild(symbol);
      }

      // Phase 2: Expand horizontally (card front appearing)
      await tween(200, (t) => {
        selectedCard.scale.x = t;
      });
      selectedCard.scale.x = 1;

      // Hold to show the revealed symbol
      await wait(800);
    }

    // Clean up card UI
    this.cardContainer.removeChildren();
    this.dimGraphic.clear();

    return selectedIndex;
  }

  // ── Phase C2b: Show fresh grid with natural spin-drop animation ──
  // ALL columns spin with fresh symbols (including former tarot columns).
  private async phaseShowFreshGrid(freshGrid: Grid): Promise<void> {
    // Ensure all columns are visible before spinning
    for (let col = 0; col < this.cols; col++) {
      this.reelSpinners[col].setColumnVisible(true);
    }

    // Spin all columns with natural drop animation
    await this.gridView.spinColumnsToGrid(freshGrid);
  }

  // ── Phase C3: Animate MALE/FEMALE anchors ────────────────
  private async phaseAnchors(spinResult: LoversSpinResult): Promise<void> {
    const step = this.cellSize + this.padding;
    const symbolSize = this.cellSize - 20;

    // Target positions for MALE and FEMALE on the grid
    const maleTargetX = spinResult.malePos.col * step + this.cellSize / 2;
    const maleTargetY = spinResult.malePos.row * step + this.cellSize / 2;
    const femaleTargetX = spinResult.femalePos.col * step + this.cellSize / 2;
    const femaleTargetY = spinResult.femalePos.row * step + this.cellSize / 2;

    // Create MALE sprite — starts from top-left corner
    const maleTexture = this.assetLoader.getTexture('MALE');
    const maleSprite = new Sprite(maleTexture!);
    maleSprite.anchor.set(0.5);
    maleSprite.width = symbolSize;
    maleSprite.height = symbolSize;
    maleSprite.x = -this.cellSize;
    maleSprite.y = -this.cellSize;
    maleSprite.alpha = 0;
    this.overlay.addChild(maleSprite);

    // Create FEMALE sprite — starts from bottom-right corner
    const totalWidth = this.cols * step - this.padding;
    const totalHeight = this.rows * step - this.padding;
    const femaleTexture = this.assetLoader.getTexture('FEMALE');
    const femaleSprite = new Sprite(femaleTexture!);
    femaleSprite.anchor.set(0.5);
    femaleSprite.width = symbolSize;
    femaleSprite.height = symbolSize;
    femaleSprite.x = totalWidth + this.cellSize;
    femaleSprite.y = totalHeight + this.cellSize;
    femaleSprite.alpha = 0;
    this.overlay.addChild(femaleSprite);

    // Animate both sprites flying to their target positions
    const startMaleX = maleSprite.x;
    const startMaleY = maleSprite.y;
    const startFemaleX = femaleSprite.x;
    const startFemaleY = femaleSprite.y;

    soundManager.play('anchor-move', 0.5);

    await tween(700, (t) => {
      // MALE flies in from top-left
      maleSprite.x = startMaleX + (maleTargetX - startMaleX) * t;
      maleSprite.y = startMaleY + (maleTargetY - startMaleY) * t;
      maleSprite.alpha = Math.min(1, t * 2);
      maleSprite.scale.set((symbolSize / (maleTexture!.width || 1)) * (0.5 + t * 0.5));

      // FEMALE flies in from bottom-right
      femaleSprite.x = startFemaleX + (femaleTargetX - startFemaleX) * t;
      femaleSprite.y = startFemaleY + (femaleTargetY - startFemaleY) * t;
      femaleSprite.alpha = Math.min(1, t * 2);
      femaleSprite.scale.set((symbolSize / (femaleTexture!.width || 1)) * (0.5 + t * 0.5));
    }, easeOutCubic);

    // Spawn glow at anchor positions
    this.spawnAnchorGlow(spinResult.malePos.col, spinResult.malePos.row, step, 0xFF6B9D);
    this.spawnAnchorGlow(spinResult.femalePos.col, spinResult.femalePos.row, step, 0xFF6B9D);

    // Brief hold to admire anchors
    await wait(500);

    // Remove anchor overlay sprites (the bond fill will set the actual grid symbols)
    this.overlay.removeChild(maleSprite);
    this.overlay.removeChild(femaleSprite);
    maleSprite.destroy();
    femaleSprite.destroy();
  }

  // ── Phase C4: Bond fill animation ──────────────────────
  private async phaseBondFill(
    spinResult: LoversSpinResult,
    finalGrid: Grid
  ): Promise<void> {
    const step = this.cellSize + this.padding;
    const stagger = 80;
    const popDuration = 350;
    // Update all columns in the bounding rect with final symbols
    const affectedCols = new Set<number>();
    for (const cell of spinResult.filledCells) {
      affectedCols.add(cell.col);
    }

    const colSpriteData: {
      col: number;
      sprites: Sprite[];
      targetScales: { x: number; y: number }[];
    }[] = [];

    for (const col of affectedCols) {
      const symbolIds = finalGrid[col].map(cell => cell.symbolId);
      this.reelSpinners[col].setSymbols(symbolIds, false);
      this.reelSpinners[col].setColumnVisible(true);

      const sprites = this.reelSpinners[col].getVisibleSprites();
      const targetScales = sprites.map(s => ({ x: s.scale.x, y: s.scale.y }));

      // Hide only the bond-filled cells (other cells keep their current state)
      for (let row = 0; row < this.rows; row++) {
        const isBondCell = spinResult.filledCells.some(c => c.col === col && c.row === row);
        if (isBondCell) {
          sprites[row].scale.set(0);
          sprites[row].alpha = 0;
        }
      }

      colSpriteData.push({ col, sprites, targetScales });
    }

    // Sort filled cells: top-to-bottom, left-to-right
    const sortedFilled = [...spinResult.filledCells].sort((a, b) =>
      a.row !== b.row ? a.row - b.row : a.col - b.col
    );

    // Staggered pop-in with rose glow
    const allDone: Promise<void>[] = [];
    for (let i = 0; i < sortedFilled.length; i++) {
      const cell = sortedFilled[i];
      const delayMs = i * stagger;

      allDone.push(
        wait(delayMs).then(async () => {
          const data = colSpriteData.find(d => d.col === cell.col);
          if (!data) return;
          const sprite = data.sprites[cell.row];
          const target = data.targetScales[cell.row];
          if (!sprite || !target) return;

          // Bond cell glow + pop sound (same as Fool wild pop)
          this.spawnBondGlow(cell.col, cell.row, step);
          soundManager.play('symbol-glow', 0.4);

          // Pop-in animation
          await tween(popDuration, (t) => {
            let s: number;
            if (t < 0.55) {
              s = easeOutBack(t / 0.55) * 1.12;
            } else {
              s = 1.12 - ((t - 0.55) / 0.45) * 0.12;
            }
            sprite.scale.set(target.x * s, target.y * s);
            sprite.alpha = Math.min(1, t * 3);
          }, easeOutCubic);

          sprite.scale.set(target.x, target.y);
          sprite.alpha = 1;
        })
      );
    }

    await Promise.all(allDone);
  }

  private spawnAnchorGlow(col: number, row: number, _step: number, _color: number): void {
    spawnDarkParticleGlow(this.glowContainer, col, row, this.cellSize, this.padding);
  }

  private spawnBondGlow(col: number, row: number, _step: number): void {
    spawnDarkParticleGlow(this.glowContainer, col, row, this.cellSize, this.padding);
  }

  // ── Spin Counter Display ─────────────────────────────────
  private async showSpinCounter(spinNum: number, total: number, totalWidth: number): Promise<void> {
    // Remove any previous counter
    if (this.spinCounterText) {
      this.overlay.removeChild(this.spinCounterText);
      this.spinCounterText.destroy();
    }

    this.spinCounterText = new Text({
      text: `SPINS REMAINING ${spinNum} / ${total}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 22,
        fill: 0xFF69B4,
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    this.spinCounterText.anchor.set(0.5, 0);
    this.spinCounterText.x = totalWidth / 2;
    this.spinCounterText.y = -40;
    this.overlay.addChild(this.spinCounterText);

    // Brief flash animation
    await tween(300, (t) => {
      this.spinCounterText!.alpha = t;
      this.spinCounterText!.scale.set(0.8 + 0.2 * t);
    }, easeOutCubic);
  }

  // ── Cleanup ────────────────────────────────────────────
  private cleanup(): void {
    if (this.spinCounterText) {
      this.spinCounterText.destroy();
      this.spinCounterText = null;
    }
    this.cardContainer.removeChildren();
    this.dimGraphic.clear();
    this.parent.removeChild(this.overlay);
    this.overlay.removeChildren();

    while (this.glowContainer.children.length) {
      this.glowContainer.children[0].destroy();
    }
  }

  /** Anchor-only symbols excluded from bond candidates and premiums */
  private static readonly ANCHOR_SYMBOLS = new Set(['MALE', 'FEMALE']);

  private generateCandidates(): string[] {
    // Generate 3 candidate bond symbols (premium-biased, no anchors)
    const premiumPool = this.assetLoader.getSymbolsByTier('PREMIUM')
      .filter(s => !LoversRevealAnimation.ANCHOR_SYMBOLS.has(s.id));
    const lowPool = this.assetLoader.getSymbolsByTier('LOW')
      .filter(s => !LoversRevealAnimation.ANCHOR_SYMBOLS.has(s.id));
    const candidates: string[] = [];
    for (let i = 0; i < 3; i++) {
      const roll = Math.random();
      if (roll < 0.60) {
        candidates.push(premiumPool[Math.floor(Math.random() * premiumPool.length)].id);
      } else if (roll < 0.90) {
        candidates.push(lowPool[Math.floor(Math.random() * lowPool.length)].id);
      } else {
        candidates.push('WILD');
      }
    }
    return candidates;
  }
}
