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
   */
  async show(
    tarotType: string,
    fadeInMs: number = 400,
    holdMs: number = 1000,
    fadeOutMs: number = 400
  ): Promise<void> {
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

    // Semi-transparent dark background for readability
    ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * opacity})`;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = opacity;

    const centerX = w / 2;
    const centerY = h / 2 - 20;

    // Draw curved tarot name
    this.drawCurvedText(ctx, name, centerX, centerY, color, glowColor);

    // Draw subtitle "FEATURE TRIGGERED"
    const subtitleY = centerY + 50;
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

    // Calculate total angular span based on text width
    const totalWidth = ctx.measureText(text).width;
    const totalAngle = totalWidth / radius; // Radians spanned by text

    // Starting angle (top of arc, centered)
    const startAngle = -Math.PI / 2 - totalAngle / 2;

    // Measure individual character widths
    const chars = text.split('');
    const charWidths = chars.map(c => ctx.measureText(c).width);
    const letterSpacing = fontSize * 0.12; // Extra spacing between chars

    // Draw with glow first
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 25;
    ctx.fillStyle = color;

    let currentAngle = startAngle;
    for (let i = 0; i < chars.length; i++) {
      const halfCharAngle = (charWidths[i] / 2 + (i > 0 ? letterSpacing / 2 : 0)) / radius;
      currentAngle += halfCharAngle;

      const x = centerX + radius * Math.cos(currentAngle);
      const y = arcCenterY + radius * Math.sin(currentAngle);
      const rotation = currentAngle + Math.PI / 2;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();

      currentAngle += (charWidths[i] / 2 + letterSpacing / 2) / radius;
    }
    ctx.restore();

    // Second pass — crisp text without glow
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;

    currentAngle = startAngle;
    for (let i = 0; i < chars.length; i++) {
      const halfCharAngle = (charWidths[i] / 2 + (i > 0 ? letterSpacing / 2 : 0)) / radius;
      currentAngle += halfCharAngle;

      const x = centerX + radius * Math.cos(currentAngle);
      const y = arcCenterY + radius * Math.sin(currentAngle);
      const rotation = currentAngle + Math.PI / 2;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();

      currentAngle += (charWidths[i] / 2 + letterSpacing / 2) / radius;
    }
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
