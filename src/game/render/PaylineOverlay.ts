import { Container, Graphics } from 'pixi.js';
import { WinLine } from '../Types';
import paylines from '../config/paylines';
import { DEBUG } from '../config/debug';
import { ReelSpinner } from './ReelSpinner';

export class PaylineOverlay extends Container {
  private cellSize: number = 156;
  private padding: number = 10;
  private overlays: Graphics[] = [];
  private radiateAnimFrameId: number = 0;
  private radiateGraphics: Graphics[] = [];

  // Color palette for different paylines
  private colors = [
    0xff6b6b, // Red
    0x4ecdc4, // Teal
    0xffe66d, // Yellow
    0x95e1d3, // Mint
    0xf38181, // Pink
    0xaa96da, // Purple
    0xfcbad3, // Light pink
    0xa8e6cf, // Light green
    0xff8b94, // Coral
    0xc7ceea, // Lavender
    0xffd3b6, // Peach
    0xffaaa5, // Salmon
    0xa8dadc, // Light blue
    0xf1e3d3, // Beige
    0x99c1b9, // Sage
    0xffa07a, // Light salmon
    0x98d8c8, // Seafoam
    0xf7b2ad, // Rose
    0xb4a7d6, // Lilac
    0xffdac1, // Light orange
    0x84a59d, // Forest
    0xf28482, // Watermelon
    0xb5e2fa, // Sky blue
    0xd4a5a5, // Mauve
    0xffe5b4, // Cream
  ];

  constructor() {
    super();
  }

  /**
   * Display winning paylines — draws lines only if SHOW_PAYLINES debug is on.
   * Always highlights winning symbols with radiating black outline.
   */
  showWinningPaylines(wins: WinLine[], _reelSpinners?: ReelSpinner[]): void {
    this.clear();

    // Debug: draw connecting lines
    if (DEBUG.SHOW_PAYLINES) {
      wins.forEach((win) => {
        const color = this.colors[win.paylineIndex % this.colors.length];
        this.drawPayline(win, color);
      });
    }

    // Always: highlight winning symbols with radiating outline
    if (_reelSpinners) {
      this.highlightWinningSymbols(wins, _reelSpinners);
    }
  }

  /**
   * Draw a single payline (debug visualization)
   */
  private drawPayline(win: WinLine, color: number): void {
    const overlay = new Graphics();
    const payline = paylines[win.paylineIndex];
    const alpha = 0.6;
    const lineWidth = 8;

    for (let col = 0; col < win.matchCount; col++) {
      const row = payline[col];
      const x = col * (this.cellSize + this.padding) + this.cellSize / 2;
      const y = row * (this.cellSize + this.padding) + this.cellSize / 2;

      if (col === 0) {
        overlay.moveTo(x, y);
      } else {
        overlay.lineTo(x, y);
      }

      overlay.circle(x, y, 12);
    }

    overlay.stroke({ width: lineWidth, color, alpha });
    overlay.fill({ color, alpha: 0.3 });

    this.addChild(overlay);
    this.overlays.push(overlay);
  }

  /**
   * Highlight winning symbols with a radiating black outline effect.
   * The outline pulses twice then holds.
   */
  private highlightWinningSymbols(wins: WinLine[], _reelSpinners: ReelSpinner[]): void {
    // Collect unique (col, row) positions from all wins
    const winCells = new Set<string>();
    for (const win of wins) {
      const payline = paylines[win.paylineIndex];
      for (let col = 0; col < win.matchCount; col++) {
        const row = payline[col];
        winCells.add(`${col},${row}`);
      }
    }

    // Create radiating outline graphics for each winning cell
    const cells = Array.from(winCells).map(key => {
      const [col, row] = key.split(',').map(Number);
      return { col, row };
    });

    const startTime = performance.now();
    const pulseDuration = 600; // ms per pulse
    const pulseCount = 2;
    const totalDuration = pulseDuration * pulseCount;

    const animate = (now: number) => {
      const elapsed = now - startTime;

      // Clean up previous frame's graphics
      for (const g of this.radiateGraphics) {
        g.destroy();
      }
      this.radiateGraphics = [];

      // Calculate pulse phase
      const t = Math.min(elapsed / totalDuration, 1);
      const cycleT = (elapsed % pulseDuration) / pulseDuration;
      // Ease: fast expand, slow fade
      const eased = 1 - Math.pow(1 - cycleT, 2);

      for (const { col, row } of cells) {
        const cx = col * (this.cellSize + this.padding) + this.cellSize / 2;
        const cy = row * (this.cellSize + this.padding) + this.cellSize / 2;
        const halfSize = this.cellSize / 2;

        // Inner solid outline (always visible)
        const inner = new Graphics();
        inner.rect(cx - halfSize, cy - halfSize, this.cellSize, this.cellSize);
        inner.stroke({ width: 3, color: 0x000000, alpha: 0.9 });
        this.addChild(inner);
        this.radiateGraphics.push(inner);

        // Radiating expanding outline
        const expand = eased * 8; // max expansion pixels
        const alpha = t >= 1 ? 0.7 : 0.85 * (1 - eased); // fade out during pulse, hold after
        const outer = new Graphics();
        outer.rect(
          cx - halfSize - expand,
          cy - halfSize - expand,
          this.cellSize + expand * 2,
          this.cellSize + expand * 2
        );
        outer.stroke({ width: 4, color: 0x000000, alpha });
        this.addChild(outer);
        this.radiateGraphics.push(outer);
      }

      if (t < 1) {
        this.radiateAnimFrameId = requestAnimationFrame(animate);
      } else {
        // After pulses complete, keep the solid inner outline
        for (const g of this.radiateGraphics) {
          g.destroy();
        }
        this.radiateGraphics = [];

        for (const { col, row } of cells) {
          const cx = col * (this.cellSize + this.padding) + this.cellSize / 2;
          const cy = row * (this.cellSize + this.padding) + this.cellSize / 2;
          const halfSize = this.cellSize / 2;

          const inner = new Graphics();
          inner.rect(cx - halfSize, cy - halfSize, this.cellSize, this.cellSize);
          inner.stroke({ width: 3, color: 0x000000, alpha: 0.7 });
          this.addChild(inner);
          this.radiateGraphics.push(inner);
        }
      }
    };

    this.radiateAnimFrameId = requestAnimationFrame(animate);
  }

  /**
   * Clear all overlays and stop animations
   */
  clear(): void {
    cancelAnimationFrame(this.radiateAnimFrameId);
    this.overlays.forEach(overlay => overlay.destroy());
    this.radiateGraphics.forEach(g => g.destroy());
    this.overlays = [];
    this.radiateGraphics = [];
    this.removeChildren();
  }
}
