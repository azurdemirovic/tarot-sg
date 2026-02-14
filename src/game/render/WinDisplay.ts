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
//  Supports looping sound during count-up and skip-to-end via requestSkip().
// ═══════════════════════════════════════════════════════════════

/** Options for sound playback during win display */
export interface WinDisplaySoundOptions {
  /** Function to play a one-shot sound effect */
  playSfx: (buffer: AudioBuffer | null, volume?: number) => void;
  /** AudioBuffer for the looping count-up tick sound */
  countUpBuffer: AudioBuffer | null;
  /** AudioContext used for creating looping source */
  sfxContext: AudioContext | null;
}

export class WinDisplay {
  private overlay: Container;
  private dimGraphic: Graphics;
  private totalText: Text | null = null;
  private betAmount: number = 1;

  // Skip support
  private skipRequested: boolean = false;

  // Looping count-up sound
  private countUpSource: AudioBufferSourceNode | null = null;
  private countUpGain: GainNode | null = null;
  private soundOptions: WinDisplaySoundOptions | null = null;

  constructor(private parent: Container) {
    this.overlay = new Container();
    this.dimGraphic = new Graphics();
  }

  /** Configure sound options (call before show/showAlways) */
  setSoundOptions(options: WinDisplaySoundOptions): void {
    this.soundOptions = options;
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

  // ── Start looping count-up sound ──
  private startCountUpSound(): void {
    if (!this.soundOptions?.sfxContext || !this.soundOptions.countUpBuffer) return;
    const ctx = this.soundOptions.sfxContext;
    if (ctx.state === 'suspended') ctx.resume();

    this.countUpGain = ctx.createGain();
    this.countUpGain.gain.value = 0.35;
    this.countUpGain.connect(ctx.destination);

    this.countUpSource = ctx.createBufferSource();
    this.countUpSource.buffer = this.soundOptions.countUpBuffer;
    this.countUpSource.loop = true;
    this.countUpSource.connect(this.countUpGain);
    this.countUpSource.start(0);
  }

  // ── Stop looping count-up sound with fade-out ──
  private stopCountUpSound(): void {
    if (this.countUpGain && this.countUpSource && this.soundOptions?.sfxContext) {
      const ctx = this.soundOptions.sfxContext;
      const fadeTime = 0.15; // 150ms fade-out
      const now = ctx.currentTime;
      this.countUpGain.gain.setValueAtTime(this.countUpGain.gain.value, now);
      this.countUpGain.gain.linearRampToValueAtTime(0, now + fadeTime);
      // Schedule stop after fade completes
      const src = this.countUpSource;
      const gain = this.countUpGain;
      setTimeout(() => {
        try { src.stop(); } catch (_) { /* already stopped */ }
        gain.disconnect();
      }, fadeTime * 1000 + 50);
      this.countUpSource = null;
      this.countUpGain = null;
    } else {
      // Fallback: immediate stop if no context available
      if (this.countUpSource) {
        try { this.countUpSource.stop(); } catch (_) { /* already stopped */ }
        this.countUpSource = null;
      }
      if (this.countUpGain) {
        this.countUpGain.disconnect();
        this.countUpGain = null;
      }
    }
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

    // 2. Dramatic headline based on win magnitude — curved arc text (auto 2-row for long text)
    const headline = this.getHeadline(totalWin, this.betAmount);
    let headlineContainer: Container | null = null;
    if (headline) {
      headlineContainer = new Container();
      headlineContainer.x = tw / 2;
      headlineContainer.y = th / 2 - 90;
      headlineContainer.alpha = 0;
      headlineContainer.scale.set(0.5);
      this.overlay.addChild(headlineContainer);

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

      // Split into two rows if text is long (more than ~18 chars)
      const words = headline.text.split(' ');
      let lines: string[];
      if (headline.text.length > 18 && words.length >= 3) {
        // Split roughly in half by word count
        const mid = Math.ceil(words.length / 2);
        lines = [
          words.slice(0, mid).join(' '),
          words.slice(mid).join(' '),
        ];
      } else {
        lines = [headline.text];
      }

      const rowSpacing = baseFontSize * 1.3;
      const totalBlockHeight = (lines.length - 1) * rowSpacing;

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const lineText = lines[lineIdx];
        const chars = lineText.split('');
        const yOffset = -totalBlockHeight / 2 + lineIdx * rowSpacing;

        // Measure character widths
        const charTexts: Text[] = [];
        const charWidths: number[] = [];
        for (const ch of chars) {
          const ct = new Text({ text: ch, style: charStyle });
          ct.anchor.set(0.5);
          charTexts.push(ct);
          charWidths.push(ct.width);
        }

        const letterSpacing = baseFontSize * 0.12;
        let totalArcLen = 0;
        for (let i = 0; i < chars.length; i++) {
          totalArcLen += charWidths[i];
          if (i < chars.length - 1) totalArcLen += letterSpacing;
        }

        // Arc parameters — gentle upward curve; second line curves downward
        const radius = baseFontSize * 8;
        const totalAngle = totalArcLen / radius;
        const isTopRow = lineIdx === 0;
        const startAngle = isTopRow
          ? -Math.PI / 2 - totalAngle / 2   // curves upward
          : -Math.PI / 2 - totalAngle / 2;  // same direction for consistency

        // For bottom row, flip the arc so it curves downward (like a parenthesis pair)
        const arcSign = isTopRow || lines.length === 1 ? 1 : -1;

        let angle = startAngle;
        for (let i = 0; i < chars.length; i++) {
          const halfCharAngle = charWidths[i] / 2 / radius;
          angle += halfCharAngle;

          const cx = radius * Math.cos(angle);
          const cy = arcSign * (radius + radius * Math.sin(angle)) + yOffset;
          const rotation = angle + Math.PI / 2;

          charTexts[i].x = cx;
          charTexts[i].y = cy;
          charTexts[i].rotation = arcSign > 0 ? rotation : -rotation + Math.PI;
          headlineContainer!.addChild(charTexts[i]);

          angle += halfCharAngle;
          if (i < chars.length - 1) {
            angle += letterSpacing / radius;
          }
        }
      }

      // Scale down if headline would exceed frame width (with padding)
      const maxWidth = tw * 0.85;
      const maxHeight = th * 0.35;
      const bounds = headlineContainer.getLocalBounds();
      let constraintScale = 1;
      if (bounds.width > maxWidth) {
        constraintScale = Math.min(constraintScale, maxWidth / bounds.width);
      }
      if (bounds.height > maxHeight) {
        constraintScale = Math.min(constraintScale, maxHeight / bounds.height);
      }
      if (constraintScale < 1) {
        headlineContainer.scale.set(0.5 * constraintScale);
      }

      // Animate headline slam-in
      const targetScale = headlineContainer.scale.x * 2; // from half to full
      const halfScale = headlineContainer.scale.x;
      await tween(500, (t) => {
        headlineContainer!.alpha = Math.min(1, t * 2);
        const s = halfScale + (targetScale - halfScale) * easeOutCubic(t);
        headlineContainer!.scale.set(s);
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
