import { Container, Graphics } from 'pixi.js';
import { WinLine } from '../Types';
import paylines from '../config/paylines';

export class PaylineOverlay extends Container {
  private cellSize: number = 156;
  private padding: number = 10;
  private overlays: Graphics[] = [];

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
   * Display winning paylines
   */
  showWinningPaylines(wins: WinLine[]): void {
    this.clear();

    wins.forEach((win, index) => {
      const color = this.colors[win.paylineIndex % this.colors.length];
      this.drawPayline(win, color);
    });
  }

  /**
   * Draw a single payline
   */
  private drawPayline(win: WinLine, color: number): void {
    const overlay = new Graphics();
    const payline = paylines[win.paylineIndex];
    const alpha = 0.6;
    const lineWidth = 8;

    // Draw line connecting cells
    for (let col = 0; col < win.matchCount; col++) {
      const row = payline[col];
      const x = col * (this.cellSize + this.padding) + this.cellSize / 2;
      const y = row * (this.cellSize + this.padding) + this.cellSize / 2;

      if (col === 0) {
        overlay.moveTo(x, y);
      } else {
        overlay.lineTo(x, y);
      }

      // Draw circle at each winning cell
      overlay.circle(x, y, 12);
    }

    // Apply styling
    overlay.stroke({ width: lineWidth, color, alpha });
    overlay.fill({ color, alpha: 0.3 });

    this.addChild(overlay);
    this.overlays.push(overlay);
  }

  /**
   * Highlight specific cells for a payline
   */
  private highlightCells(win: WinLine, color: number): void {
    const overlay = new Graphics();
    const payline = paylines[win.paylineIndex];

    for (let col = 0; col < win.matchCount; col++) {
      const row = payline[col];
      const x = col * (this.cellSize + this.padding);
      const y = row * (this.cellSize + this.padding);

      overlay.rect(x, y, this.cellSize, this.cellSize);
    }

    overlay.stroke({ width: 4, color, alpha: 0.8 });
    this.addChild(overlay);
    this.overlays.push(overlay);
  }

  /**
   * Clear all overlays
   */
  clear(): void {
    this.overlays.forEach(overlay => overlay.destroy());
    this.overlays = [];
    this.removeChildren();
  }
}
