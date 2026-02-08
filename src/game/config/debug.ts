/**
 * Debug configuration — toggle options without modifying game code.
 * Just flip the booleans here.
 */
export const DEBUG = {
  /** Show all 5 tarot cards on the initial screen (one per column, as full-column stacks) */
  showTarotsOnStart: true,

  /** Enable the Three.js 3D background behind the Pixi canvas */
  BG_ENABLED: true,

  /** Animate a slow camera drift on the 3D background (false = static) */
  BG_ANIMATE_CAMERA: true,
};
