/**
 * TarotTitleDisplay — Shows a centered title card before a tarot feature triggers.
 * 
 * Displays the tarot name on a curved arc with "FEATURE TRIGGERED" subtitle below,
 * colored to match the tarot's theme. Uses a Canvas2D overlay for curved text rendering.
 */

// Feature display names and colors
const TAROT_DISPLAY_NAMES: Record<string, string> = {
  'T_FOOL':      'THE FOOL',
  'T_CUPS':      'ACE OF CUPS',
  'T_LOVERS':    'THE LOVERS',
  'T_PRIESTESS': 'THE PRIESTESS',
  'T_DEATH':     'DEATH',
};

const TAROT_COLORS: Record<string, string> = {
  'T_FOOL':      '#19d94e',  // Green
  'T_CUPS':      '#4d80ff',  // Blue
  'T_LOVERS':    '#e63352',  // Red/Rose
  'T_PRIESTESS': '#9a4de6',  // Purple
  'T_DEATH':     '#e62619',  // Dark Red
};

const TAROT_GLOW_COLORS: Record<string, string> = {
  'T_FOOL':      'rgba(25, 217, 78, 0.6)',
  'T_CUPS':      'rgba(77, 128, 255, 0.6)',
  'T_LOVERS':    'rgba(230, 51, 82, 0.6)',
  'T_PRIESTESS': 'rgba(154, 77, 230, 0.6)',
  'T_DEATH':     'rgba(230, 38, 25, 0.6)',
};

export class TarotTitleDisplay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrameId: number = 0;
  private gridCenter: { x: number; y: number } | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * Show the tarot title with fade in, hold, and fade out.
   * @param tarotType - e.g. 'T_FOOL'
   * @param fadeInMs - fade in duration
   * @param holdMs - hold duration
   * @param fadeOutMs - fade out duration
   * @param center - optional screen-space center point to position the title on (e.g. grid center)
   */
  async show(
    tarotType: string,
    fadeInMs: number = 400,
    holdMs: number = 1000,
    fadeOutMs: number = 400,
    center?: { x: number; y: number }
  ): Promise<void> {
    if (center) {
      this.gridCenter = center;
    }
    const name = TAROT_DISPLAY_NAMES[tarotType] || tarotType.replace('T_', '');
    const color = TAROT_COLORS[tarotType] || '#ffffff';
    const glowColor = TAROT_GLOW_COLORS[tarotType] || 'rgba(255,255,255,0.6)';

    // Setup canvas as full-screen overlay
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100vw';
    this.canvas.style.height = '100vh';
    this.canvas.style.zIndex = '15'; // Above everything
    this.canvas.style.pointerEvents = 'none';
    document.body.appendChild(this.canvas);

    this.ctx.scale(dpr, dpr);

    const totalDuration = fadeInMs + holdMs + fadeOutMs;

    return new Promise<void>((resolve) => {
      const start = performance.now();

      const animate = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / totalDuration, 1);

        // Calculate opacity based on phase
        let opacity: number;
        if (elapsed < fadeInMs) {
          // Fade in
          opacity = elapsed / fadeInMs;
          opacity = opacity * opacity; // ease-in quad
        } else if (elapsed < fadeInMs + holdMs) {
          // Hold
          opacity = 1;
        } else {
          // Fade out
          const fadeT = (elapsed - fadeInMs - holdMs) / fadeOutMs;
          opacity = 1 - fadeT;
          opacity = Math.max(0, opacity * opacity); // ease-out quad
        }

        this.draw(name, color, glowColor, opacity);

        if (t < 1) {
          this.animationFrameId = requestAnimationFrame(animate);
        } else {
          this.cleanup();
          resolve();
        }
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  private draw(name: string, color: string, glowColor: string, opacity: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ctx = this.ctx;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Full-screen dimmed backdrop overlay
    ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * opacity})`;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = opacity;

    // Center on the grid if available, otherwise fall back to screen center
    let centerX: number;
    let centerY: number;
    if (this.gridCenter) {
      centerX = this.gridCenter.x;
      centerY = this.gridCenter.y;
    } else {
      centerX = w / 2;
      centerY = h / 2;
    }

    // Offset upward so the visual center of title + subtitle block is at centerY
    const blockOffset = 25;
    const titleY = centerY - blockOffset;

    // Draw curved tarot name
    this.drawCurvedText(ctx, name, centerX, titleY, color, glowColor);

    // Draw subtitle "FEATURE TRIGGERED"
    const subtitleY = titleY + 50;
    const subtitleSize = Math.max(16, Math.min(22, w * 0.022));
    ctx.font = `bold ${subtitleSize}px 'CustomFont', Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Subtle glow
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 15;
    ctx.fillStyle = color;
    ctx.fillText('FEATURE TRIGGERED', centerX, subtitleY);

    // Second pass without glow for crisp text
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText('FEATURE TRIGGERED', centerX, subtitleY);

    ctx.globalAlpha = 1;
  }

  private drawCurvedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    centerY: number,
    color: string,
    glowColor: string
  ): void {
    const fontSize = Math.max(28, Math.min(48, window.innerWidth * 0.04));
    ctx.font = `bold ${fontSize}px 'CustomFont', Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Arc parameters — gentle upward curve
    const radius = fontSize * 8; // Large radius = gentle curve
    const arcCenterY = centerY + radius; // Arc center below text

    // Measure individual character widths
    const chars = text.split('');
    const charWidths = chars.map(c => ctx.measureText(c).width);
    const letterSpacing = fontSize * 0.12; // Extra spacing between chars

    // Calculate the true total angular span including letter spacing
    let totalArcLength = 0;
    for (let i = 0; i < chars.length; i++) {
      totalArcLength += charWidths[i];
      if (i < chars.length - 1) totalArcLength += letterSpacing;
    }
    const totalAngle = totalArcLength / radius;

    // Starting angle — centered at the top of the arc (-PI/2)
    const startAngle = -Math.PI / 2 - totalAngle / 2;

    // Helper to draw characters along the arc
    const drawCharsOnArc = () => {
      let angle = startAngle;
      for (let i = 0; i < chars.length; i++) {
        // Advance by half the char width to reach the char center
        const halfCharAngle = charWidths[i] / 2 / radius;
        angle += halfCharAngle;

        const x = centerX + radius * Math.cos(angle);
        const y = arcCenterY + radius * Math.sin(angle);
        const rotation = angle + Math.PI / 2;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.fillText(chars[i], 0, 0);
        ctx.restore();

        // Advance past the second half of this char + spacing to next
        angle += halfCharAngle;
        if (i < chars.length - 1) {
          angle += letterSpacing / radius;
        }
      }
    };

    // Draw with glow first
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 25;
    ctx.fillStyle = color;
    drawCharsOnArc();
    ctx.restore();

    // Second pass — crisp text without glow
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    drawCharsOnArc();
    ctx.restore();
  }

  private cleanup(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.canvas.remove();
  }

  dispose(): void {
    this.cleanup();
  }
}
