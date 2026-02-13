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

  /** Force Cups feature on next spin (for testing) */
  FORCE_CUPS: false,

  /** Columns to place Cups cards (2 or 3 columns) */
  CUPS_COLUMNS: [1, 3],

  /** Force Lovers feature on next spin (for testing) */
  FORCE_LOVERS: false,

  /** Columns to place Lovers cards (2 or 3 columns) */
  LOVERS_COLUMNS: [1, 3],

  /** Force Priestess feature on next spin (for testing) */
  FORCE_PRIESTESS: false,

  /** Columns to place Priestess cards (2 or 3 columns) */
  PRIESTESS_COLUMNS: [1, 3],

  /** Force Death feature on next spin (for testing) */
  FORCE_DEATH: false,

  /** Columns to place Death cards (2 or 3 columns) */
  DEATH_COLUMNS: [1, 3],

  /** Show payline connection lines (debug visualization) */
  SHOW_PAYLINES: false,

  /** Death visual mode — keeps the Death UI (reap bar, spin counter, 3D model, color tint) active at all times */
  DEATH_MODE: false,
};
