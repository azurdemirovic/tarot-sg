import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { tween, wait, easeOutCubic } from '../utils/AnimationUtils';
import { soundManager } from '../utils/SoundManager';

// ═══════════════════════════════════════════════════════════════
//  WinDisplay
//  Universal win display overlay used by all features.
//  Shows payout, multiplier, and count-up total when win > threshold.
//  Supports looping sound during count-up and skip-to-end via requestSkip().
// ═══════════════════════════════════════════════════════════════

export class WinDisplay {
  private overlay: Container;
  private dimGraphic: Graphics;
  private totalText: Text | null = null;
  private betAmount: number = 1;
  private skipRequested: boolean = false;

  constructor(private parent: Container) {
    this.overlay = new Container();
    this.dimGraphic = new Graphics();
  }

  /** Request the count-up to skip to the final value immediately */
  requestSkip(): void {
    this.skipRequested = true;
  }

  /**
   * Optional callback to run before the win display appears (e.g. outline winning symbols).
   * Set this before calling show() or showAlways().
   */
  onBeforeShow: (() => Promise<void>) | null = null;

  /**
   * Show the win display if totalWin exceeds betAmount × threshold.
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
    this.skipRequested = false;

    // Run pre-show callback (e.g. outline winning symbols)
    if (this.onBeforeShow) {
      await this.onBeforeShow();
    }

    this.parent.addChild(this.overlay);

    try {
      await this.phaseWinDisplay(wins, multiplier, totalWin, tw, th);
      await this.skippableWait(holdMs);
      await this.phaseFadeOut(tw, th);
    } finally {
      this.stopCountUpSound();
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
    this.skipRequested = false;

    // Run pre-show callback (e.g. outline winning symbols)
    if (this.onBeforeShow) {
      await this.onBeforeShow();
    }

    this.parent.addChild(this.overlay);

    try {
      await this.phaseWinDisplay(wins, multiplier, totalWin, tw, th);
      await this.skippableWait(holdMs);
      await this.phaseFadeOut(tw, th);
    } finally {
      this.stopCountUpSound();
      this.cleanup();
    }
  }

  // ── Win Headlines (sorted by ascending win magnitude) ──
  private static readonly WIN_HEADLINES: { minMultiplier: number; text: string; color: number }[] = [
    { minMultiplier: 50, text: 'YOUR NAME IS WRITTEN IN THE STARS!', color: 0xFFFFFF },
    { minMultiplier: 30, text: 'THE VEIL RIPS OPEN!',                color: 0xFF4444 },
    { minMultiplier: 15, text: 'FATE BREAKER!',                      color: 0xFF69B4 },
    { minMultiplier: 5,  text: 'PROPHECY PAYS!',                     color: 0xFFAA00 },
    { minMultiplier: 2,  text: 'THE SPREAD FAVORS YOU!',             color: 0xFFD700 },
  ];

  private getHeadline(totalWin: number, betAmount: number): { text: string; color: number } | null {
    const ratio = totalWin / betAmount;
    for (const h of WinDisplay.WIN_HEADLINES) {
      if (ratio >= h.minMultiplier) return h;
    }
    return null;
  }

  /** Wait that can be interrupted by requestSkip */
  private skippableWait(ms: number): Promise<void> {
    return new Promise(resolve => {
      if (this.skipRequested) { resolve(); return; }
      const timer = setTimeout(resolve, ms);
      const checkSkip = () => {
        if (this.skipRequested) {
          clearTimeout(timer);
          resolve();
        } else {
          requestAnimationFrame(checkSkip);
        }
      };
      requestAnimationFrame(checkSkip);
    });
  }

  private startCountUpSound(): void {
    soundManager.startLoop('win-countup', 0.35);
  }

  private stopCountUpSound(): void {
    soundManager.stopLoop('win-countup', 0.15);
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

    // 2. Dramatic headline based on win magnitude — letter-by-letter jump-in
    const headline = this.getHeadline(totalWin, this.betAmount);
    let headlineContainer: Container | null = null;
    if (headline) {
      // Split into two lines if text is long (more than ~18 chars)
      const words = headline.text.split(' ');
      let lines: string[];
      if (headline.text.length > 18 && words.length >= 3) {
        const mid = Math.ceil(words.length / 2);
        lines = [
          words.slice(0, mid).join(' '),
          words.slice(mid).join(' '),
        ];
      } else {
        lines = [headline.text];
      }

      const baseFontSize = 36;
      const charStyle = new TextStyle({
        fontFamily: 'CustomFont, Arial, sans-serif',
        fontSize: baseFontSize,
        fill: headline.color,
        stroke: { color: 0x000000, width: 5 },
        dropShadow: {
          color: 0x000000,
          blur: 12,
          distance: 4,
          alpha: 0.9,
        },
      });

      headlineContainer = new Container();
      headlineContainer.x = tw / 2;
      headlineContainer.y = th / 2 - 110;
      this.overlay.addChild(headlineContainer);

      // Build all character Text objects with layout positions
      const allChars: { text: Text; targetX: number; targetY: number }[] = [];
      const lineHeight = baseFontSize * 1.4;
      const totalHeight = (lines.length - 1) * lineHeight;

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const lineText = lines[lineIdx];
        const yOffset = -totalHeight / 2 + lineIdx * lineHeight;

        // Create chars and measure total width
        const lineChars: Text[] = [];
        let totalWidth = 0;
        const spacing = 2;
        for (const ch of lineText) {
          const ct = new Text({ text: ch, style: charStyle });
          ct.anchor.set(0.5);
          lineChars.push(ct);
          totalWidth += ct.width + spacing;
        }
        totalWidth -= spacing; // remove trailing spacing

        // Position chars centered on X
        let xCursor = -totalWidth / 2;
        for (const ct of lineChars) {
          const cx = xCursor + ct.width / 2;
          xCursor += ct.width + spacing;

          ct.x = cx;
          ct.y = yOffset;
          ct.alpha = 0;
          headlineContainer.addChild(ct);
          allChars.push({ text: ct, targetX: cx, targetY: yOffset });
        }
      }

      // Scale down if headline would exceed frame width
      const maxWidth = tw * 0.85;
      const bounds = headlineContainer.getLocalBounds();
      if (bounds.width > maxWidth) {
        const s = maxWidth / bounds.width;
        headlineContainer.scale.set(s);
      }

      // Animate letters jumping in one by one
      const staggerDelay = 30; // ms between each letter
      const jumpHeight = 30; // pixels each letter drops from
      const letterDuration = 250; // ms per letter animation
      const totalAnimTime = allChars.length * staggerDelay + letterDuration;

      await new Promise<void>(resolve => {
        const start = performance.now();
        const frame = (now: number) => {
          const elapsed = now - start;
          for (let i = 0; i < allChars.length; i++) {
            const charStart = i * staggerDelay;
            const t = Math.max(0, Math.min(1, (elapsed - charStart) / letterDuration));
            const ease = easeOutCubic(t);
            allChars[i].text.alpha = ease;
            allChars[i].text.y = allChars[i].targetY - jumpHeight * (1 - ease);
            allChars[i].text.scale.set(0.5 + 0.5 * ease);
          }
          if (elapsed < totalAnimTime) {
            requestAnimationFrame(frame);
          } else {
            // Ensure all at final state
            for (const c of allChars) {
              c.text.alpha = 1;
              c.text.y = c.targetY;
              c.text.scale.set(1);
            }
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });

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
    payoutText.y = th / 2 - 20;
    payoutText.alpha = 0;
    this.overlay.addChild(payoutText);

    // 4b. Create multiplier text (next to payout)
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
    multiplierText.y = th / 2 - 20;
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
    this.totalText.y = th / 2 + 50;
    this.totalText.alpha = 0;
    this.totalText.scale.set(0.8);
    this.overlay.addChild(this.totalText);

    // 6. Animate: fade in payout + multiplier
    await tween(400, (t) => {
      payoutText.alpha = t;
      multiplierText.alpha = t;
    }, easeOutCubic);

    // 7. Count up total win while growing in size
    // Scale duration based on win magnitude: bigger wins = longer count-up
    const winRatio = totalWin / this.betAmount;
    const countDuration = Math.min(5000, Math.max(2000, winRatio * 100));
    const startScale = 0.8;
    const endScale = 1.2;
    const totalTextRef = this.totalText;

    // Start looping count-up sound
    this.startCountUpSound();

    await new Promise<void>(resolve => {
      const start = performance.now();
      const frame = (now: number) => {
        const elapsed = now - start;

        // If skip requested, jump to final value immediately
        if (this.skipRequested) {
          totalTextRef.text = `${totalWin.toFixed(2)} €`;
          totalTextRef.scale.set(endScale);
          totalTextRef.alpha = 1;
          this.stopCountUpSound();
          resolve();
          return;
        }

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
          this.stopCountUpSound();
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
