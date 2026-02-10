import { Container, Graphics, Text, TextStyle } from 'pixi.js';

// ─── Easing helpers ───────────────────────────────────────────
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function tween(
  duration: number,
  onUpdate: (t: number) => void,
  easing: (t: number) => number = easeInOutQuad
): Promise<void> {
  return new Promise(resolve => {
    const start = performance.now();
    function frame(now: number) {
      const elapsed = now - start;
      const raw = Math.min(elapsed / duration, 1);
      const t = easing(raw);
      onUpdate(t);
      if (raw < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
//  WinDisplay
//  Universal win display overlay used by all features.
//  Shows payout, multiplier, and count-up total when win > threshold.
// ═══════════════════════════════════════════════════════════════
export class WinDisplay {
  private overlay: Container;
  private dimGraphic: Graphics;
  private totalText: Text | null = null;
  private betAmount: number = 1;

  constructor(private parent: Container) {
    this.overlay = new Container();
    this.dimGraphic = new Graphics();
  }

  /**
   * Show the win display if totalWin exceeds betAmount × threshold.
   * @param wins       Array of win objects (must have .payout)
   * @param multiplier Multiplier applied to base payout
   * @param totalWin   Final total win amount
   * @param betAmount  Current bet amount
   * @param tw         Total grid width
   * @param th         Total grid height
   * @param threshold  Multiplier of bet to trigger display (default: 10)
   * @param holdMs     How long to hold the display (default: 1500)
   */
  async show(
    wins: { payout: number }[],
    multiplier: number,
    totalWin: number,
    betAmount: number,
    tw: number,
    th: number,
    threshold: number = 10,
    holdMs: number = 1500
  ): Promise<void> {
    if (wins.length === 0 || totalWin <= betAmount * threshold) return;

    this.betAmount = betAmount;
    this.parent.addChild(this.overlay);

    try {
      await this.phaseWinDisplay(wins, multiplier, totalWin, tw, th);
      await wait(holdMs);
      await this.phaseFadeOut(tw, th);
    } finally {
      this.cleanup();
    }
  }

  /**
   * Show a simpler win display (always shown, no threshold check).
   * Used for per-spin results in multi-spin features.
   */
  async showAlways(
    wins: { payout: number }[],
    multiplier: number,
    totalWin: number,
    betAmount: number,
    tw: number,
    th: number,
    holdMs: number = 1200
  ): Promise<void> {
    if (wins.length === 0 || totalWin <= 0) return;

    this.betAmount = betAmount;
    this.parent.addChild(this.overlay);

    try {
      await this.phaseWinDisplay(wins, multiplier, totalWin, tw, th);
      await wait(holdMs);
      await this.phaseFadeOut(tw, th);
    } finally {
      this.cleanup();
    }
  }

  // ── Win Headlines (sorted by ascending win magnitude) ──
  private static readonly WIN_HEADLINES: { minMultiplier: number; text: string; color: number }[] = [
    { minMultiplier: 50, text: 'YOUR NAME IS WRITTEN IN THE STARS', color: 0xFFFFFF },
    { minMultiplier: 30, text: 'THE VEIL RIPS OPEN!',               color: 0xFF4444 },
    { minMultiplier: 15, text: 'FATE BREAKER',                      color: 0xFF69B4 },
    { minMultiplier: 5,  text: 'PROPHECY PAYS!',                    color: 0xFFAA00 },
    { minMultiplier: 2,  text: 'THE SPREAD FAVORS YOU!',            color: 0xFFD700 },
  ];

  private getHeadline(totalWin: number, betAmount: number): { text: string; color: number } | null {
    const ratio = totalWin / betAmount;
    for (const h of WinDisplay.WIN_HEADLINES) {
      if (ratio >= h.minMultiplier) return h;
    }
    return null;
  }

  // ── Win Display (Grid Dim + Headline + Payout + Multiplier + Total) ──
  private async phaseWinDisplay(
    wins: { payout: number }[],
    multiplier: number,
    totalWin: number,
    tw: number,
    th: number
  ): Promise<void> {
    // 1. Dim only the grid area
    this.dimGraphic.clear();
    this.dimGraphic.rect(0, 0, tw, th);
    this.dimGraphic.fill({ color: 0x000000, alpha: 0.6 });
    this.overlay.addChild(this.dimGraphic);

    // 2. Dramatic headline based on win magnitude
    const headline = this.getHeadline(totalWin, this.betAmount);
    let headlineText: Text | null = null;
    if (headline) {
      headlineText = new Text({
        text: headline.text,
        style: new TextStyle({
          fontFamily: 'CustomFont, Arial, sans-serif',
          fontSize: 36,
          fill: headline.color,
          stroke: { color: 0x000000, width: 5 },
          dropShadow: {
            color: 0x000000,
            blur: 12,
            distance: 4,
            alpha: 0.9,
          },
          letterSpacing: 3,
        }),
      });
      headlineText.anchor.set(0.5);
      headlineText.x = tw / 2;
      headlineText.y = th / 2 - 100;
      headlineText.alpha = 0;
      headlineText.scale.set(0.5);
      this.overlay.addChild(headlineText);

      // Animate headline slam-in
      await tween(500, (t) => {
        headlineText!.alpha = Math.min(1, t * 2);
        headlineText!.scale.set(0.5 + 0.5 * easeOutCubic(t));
      }, easeOutCubic);

      await wait(200);
    }

    // 3. Calculate base payline payout (before multiplier)
    const basePayout = wins.reduce((sum, win) => sum + win.payout, 0);

    // 4. Create payline payout text (center)
    const payoutText = new Text({
      text: `${basePayout.toFixed(2)} €`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 64,
        fill: 0xFFD700,
        stroke: { color: 0x000000, width: 6 },
        dropShadow: {
          color: 0x000000,
          blur: 8,
          distance: 3,
          alpha: 0.8,
        },
      }),
    });
    payoutText.anchor.set(0.5);
    payoutText.x = tw / 2 - 60;
    payoutText.y = th / 2 - 40;
    payoutText.alpha = 0;
    this.overlay.addChild(payoutText);

    // 4. Create multiplier text (next to payout)
    const multiplierText = new Text({
      text: `×${multiplier}`,
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 64,
        fill: 0xFFD700,
        stroke: { color: 0x000000, width: 6 },
        dropShadow: {
          color: 0x000000,
          blur: 8,
          distance: 3,
          alpha: 0.8,
        },
      }),
    });
    multiplierText.anchor.set(0.5);
    multiplierText.x = tw / 2 + 60;
    multiplierText.y = th / 2 - 40;
    multiplierText.alpha = 0;
    this.overlay.addChild(multiplierText);

    // 5. Create total win text (below, counting up, growing)
    this.totalText = new Text({
      text: '0.00 €',
      style: new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: 48,
        fill: 0xFFFFFF,
        stroke: { color: 0x000000, width: 5 },
        dropShadow: {
          color: 0x000000,
          blur: 10,
          distance: 4,
          alpha: 0.9,
        },
      }),
    });
    this.totalText.anchor.set(0.5);
    this.totalText.x = tw / 2;
    this.totalText.y = th / 2 + 30;
    this.totalText.alpha = 0;
    this.totalText.scale.set(0.8);
    this.overlay.addChild(this.totalText);

    // 6. Animate: fade in payout + multiplier
    await tween(400, (t) => {
      payoutText.alpha = t;
      multiplierText.alpha = t;
    }, easeOutCubic);

    // 7. Count up total win while growing in size
    const countDuration = 1000;
    const startScale = 0.8;
    const endScale = 1.2;
    const totalTextRef = this.totalText;

    await new Promise<void>(resolve => {
      const start = performance.now();
      const frame = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / countDuration, 1);
        const ease = easeOutCubic(t);

        const currentValue = totalWin * ease;
        totalTextRef.text = `${currentValue.toFixed(2)} €`;

        const scale = startScale + (endScale - startScale) * ease;
        totalTextRef.scale.set(scale);
        totalTextRef.alpha = Math.min(1, t * 2);

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          totalTextRef.text = `${totalWin.toFixed(2)} €`;
          totalTextRef.scale.set(endScale);
          totalTextRef.alpha = 1;
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  // ── Fade Out ────────────────────────────────────────────
  private async phaseFadeOut(tw: number, th: number): Promise<void> {
    const glowContainer = this.overlay.children.find(c => c instanceof Container) as Container | undefined;

    await tween(400, (t) => {
      this.dimGraphic.clear();
      this.dimGraphic.rect(0, 0, tw, th);
      this.dimGraphic.fill({ color: 0x000000, alpha: 0.6 * (1 - t) });

      this.overlay.children.forEach((child) => {
        if (child instanceof Text) {
          child.alpha = 1 - t;
        }
      });

      if (glowContainer) {
        glowContainer.alpha = 1 - t;
      }
    }, easeOutCubic);
  }

  // ── Cleanup ────────────────────────────────────────────
  private cleanup(): void {
    this.parent.removeChild(this.overlay);
    this.overlay.removeChildren();
    this.dimGraphic.clear();

    if (this.totalText) {
      this.totalText.destroy();
      this.totalText = null;
    }
  }
}
