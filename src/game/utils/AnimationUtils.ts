/**
 * Shared animation utilities used across all reveal animations and UI components.
 * Centralizes tween, wait, and easing functions to avoid duplication.
 */

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function linear(t: number): number {
  return t;
}

/**
 * Promise-based tween using requestAnimationFrame.
 * @param duration - Duration in milliseconds
 * @param onUpdate - Called each frame with eased progress (0 → 1)
 * @param easeFn - Easing function (default: easeInOutQuad)
 */
export function tween(
  duration: number,
  onUpdate: (t: number) => void,
  easeFn: (t: number) => number = easeInOutQuad
): Promise<void> {
  return new Promise(resolve => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const raw = Math.min(elapsed / duration, 1);
      onUpdate(easeFn(raw));
      if (raw < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Promise-based delay.
 * @param ms - Delay in milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Shared VFX: Dark diffuse particle glow ──
// Used by Fool (wild glow) and Lovers (anchor glow, bond glow).

import { Container, Graphics } from 'pixi.js';

/**
 * Spawns a dark, diffuse particle-like glow burst centered on a grid cell.
 * @param parent - Container to add the glow to
 * @param col - Grid column
 * @param row - Grid row
 * @param cellSize - Cell size in pixels
 * @param padding - Grid padding in pixels
 * @param duration - Animation duration in ms (default 700)
 */
export function spawnDarkParticleGlow(
  parent: Container,
  col: number,
  row: number,
  cellSize: number,
  padding: number,
  duration: number = 700
): void {
  const step = cellSize + padding;
  const cx = col * step + cellSize / 2;
  const cy = row * step + cellSize / 2;

  const glowGroup = new Container();
  glowGroup.x = cx;
  glowGroup.y = cy;
  parent.addChild(glowGroup);

  const particleCount = 8;
  const particles: { g: Graphics; offsetX: number; offsetY: number; baseRadius: number; speed: number; phase: number }[] = [];

  for (let i = 0; i < particleCount; i++) {
    const g = new Graphics();
    glowGroup.addChild(g);
    const angle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
    const dist = cellSize * (0.05 + Math.random() * 0.15);
    particles.push({
      g,
      offsetX: Math.cos(angle) * dist,
      offsetY: Math.sin(angle) * dist,
      baseRadius: cellSize * (0.15 + Math.random() * 0.2),
      speed: 0.7 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
    });
  }

  tween(duration, (t) => {
    for (const p of particles) {
      p.g.clear();
      const life = t * p.speed;
      const expand = 0.5 + life * 0.8;
      const radius = p.baseRadius * expand;
      const drift = t * 1.3;

      let alpha: number;
      if (t < 0.15) {
        alpha = (t / 0.15) * 0.4;
      } else if (t < 0.5) {
        alpha = 0.4 - (t - 0.15) * 0.15;
      } else {
        alpha = 0.35 * (1 - (t - 0.5) / 0.5) * 0.6;
      }

      const px = p.offsetX * drift + Math.sin(p.phase + t * 4) * 2;
      const py = p.offsetY * drift + Math.cos(p.phase + t * 3) * 2;

      p.g.circle(px, py, radius);
      p.g.fill({ color: 0x000000, alpha: alpha * 0.3 });
      p.g.circle(px, py, radius * 0.65);
      p.g.fill({ color: 0x000000, alpha: alpha * 0.5 });
      p.g.circle(px, py, radius * 0.3);
      p.g.fill({ color: 0x000000, alpha: alpha * 0.7 });
    }
  }, easeOutCubic);
}
