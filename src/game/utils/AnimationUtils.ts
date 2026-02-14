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
