import { RNG } from '../RNG';
import { AssetLoader } from '../AssetLoader';
import { Grid, TarotColumn } from '../Types';

export class SpinGenerator {
  constructor(
    private rng: RNG,
    private assetLoader: AssetLoader
  ) {}

  /**
   * Generates a spin result for a 5x3 grid
   * @param tarotChance Probability (0-1) of tarots appearing
   */
  generateSpin(cols: number = 5, rows: number = 3, tarotChance: number = 0.15): { grid: Grid, tarotColumns: TarotColumn[] } {
    const grid: Grid = [];
    const tarotColumns: TarotColumn[] = [];

    // Determine if tarots will appear
    const hasTarots = this.rng.nextFloat() < tarotChance;
    let tarotColumnIndices: number[] = [];
    let tarotTypes: string[] = [];

    if (hasTarots) {
      // Determine how many tarot columns (weighted: 1=70%, 2=25%, 3=5%)
      const tarotCountRoll = this.rng.nextFloat();
      let tarotCount = 1;
      if (tarotCountRoll > 0.70 && tarotCountRoll <= 0.95) {
        tarotCount = 2;
      } else if (tarotCountRoll > 0.95) {
        tarotCount = 3;
      }

      // Select random columns for tarots
      const availableColumns = Array.from({ length: cols }, (_, i) => i);
      this.rng.shuffle(availableColumns);
      tarotColumnIndices = availableColumns.slice(0, tarotCount);

      // Select tarot types for each column (could be same or different)
      const tarotSymbols = this.assetLoader.getTarotSymbols();
      for (let i = 0; i < tarotCount; i++) {
        const weights = tarotSymbols.map(s => s.baseWeight);
        const selectedTarot = this.rng.weightedChoice(tarotSymbols, weights);
        tarotTypes.push(selectedTarot.id);
      }
    }

    // Generate grid
    const normalSymbols = this.assetLoader.getNormalSymbols();
    const normalWeights = normalSymbols.map(s => s.baseWeight);

    for (let col = 0; col < cols; col++) {
      grid[col] = [];
      
      const tarotIndex = tarotColumnIndices.indexOf(col);
      const isTarotColumn = tarotIndex !== -1;

      if (isTarotColumn) {
        // Fill entire column with same tarot symbol
        const tarotType = tarotTypes[tarotIndex];
        for (let row = 0; row < rows; row++) {
          grid[col][row] = {
            col,
            row,
            symbolId: tarotType,
          };
        }
        tarotColumns.push({ col, tarotType });
      } else {
        // Fill with normal symbols
        for (let row = 0; row < rows; row++) {
          const symbol = this.rng.weightedChoice(normalSymbols, normalWeights);
          grid[col][row] = {
            col,
            row,
            symbolId: symbol.id,
          };
        }
      }
    }

    return { grid, tarotColumns };
  }

  /**
   * Force a specific tarot configuration (for debugging)
   */
  generateSpinWithTarots(tarotType: string, columns: number[], cols: number = 5, rows: number = 3): { grid: Grid, tarotColumns: TarotColumn[] } {
    const grid: Grid = [];
    const tarotColumns: TarotColumn[] = [];

    const normalSymbols = this.assetLoader.getNormalSymbols();
    const normalWeights = normalSymbols.map(s => s.baseWeight);

    for (let col = 0; col < cols; col++) {
      grid[col] = [];
      
      const isTarotColumn = columns.includes(col);

      if (isTarotColumn) {
        for (let row = 0; row < rows; row++) {
          grid[col][row] = {
            col,
            row,
            symbolId: tarotType,
          };
        }
        tarotColumns.push({ col, tarotType });
      } else {
        for (let row = 0; row < rows; row++) {
          const symbol = this.rng.weightedChoice(normalSymbols, normalWeights);
          grid[col][row] = {
            col,
            row,
            symbolId: symbol.id,
          };
        }
      }
    }

    return { grid, tarotColumns };
  }
}
