export type SymbolTier = 'WILD' | 'LOW' | 'PREMIUM' | 'TAROT';

export interface Symbol {
  id: string;
  tier: SymbolTier;
  filename: string;
  baseWeight: number;
  payValues: number[]; // [1-reel, 2-reel, 3-reel, 4-reel, 5-reel]
  isTarot: boolean;
}

export interface Cell {
  col: number;
  row: number;
  symbolId: string;
  isLocked?: boolean;
  mysteryMask?: boolean;
}

export type Grid = Cell[][];

export interface TarotColumn {
  col: number;
  tarotType: string;
}

export interface FeatureTrigger {
  type: string;
  count: number;
  columns: number[];
}

export interface WinLine {
  paylineIndex: number;      // Which payline won (0-24 for 25 paylines)
  symbol: string;             // Winning symbol
  matchCount: number;         // How many reels matched (3, 4, or 5)
  payout: number;             // Credits won on this payline
  cells: { col: number; row: number }[]; // Cells that are part of this win
}

export interface SpinResult {
  grid: Grid;
  tarotColumns: TarotColumn[];
  feature: FeatureTrigger | null;
  wins: WinLine[];
  totalPayout: number;
  multiplier: number;
}

export type GameMode = 'BASE' | 'FEATURE_PRIESTESS' | 'FEATURE_DEATH';

export interface SymbolsConfig {
  symbols: Symbol[];
  pools: {
    LOW: string[];
    PREMIUM: string[];
    TAROT: string[];
  };
}
