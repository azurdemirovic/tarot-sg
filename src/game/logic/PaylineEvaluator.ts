import { AssetLoader } from '../AssetLoader';
import { Grid, WinLine } from '../Types';
import paylines from '../config/paylines';
import paytableData from '../config/paytable.json';

interface Paytable {
  payouts: {
    [symbolId: string]: {
      [matchCount: string]: number;
    };
  };
  betPerLine: number;
  totalPaylines: number;
  minimumMatch: number;
  wildSubstitution: boolean;
}

export class PaylineEvaluator {
  private paytable: Paytable;
  /** Current total bet amount — used to derive betPerLine dynamically */
  public currentBetAmount: number = 0.20;

  constructor(private assetLoader: AssetLoader) {
    this.paytable = paytableData as Paytable;
  }

  /**
   * Evaluate all paylines and return winning lines
   */
  evaluateAllPaylines(grid: Grid): WinLine[] {
    const winLines: WinLine[] = [];

    for (let i = 0; i < paylines.length; i++) {
      const win = this.evaluatePayline(grid, i);
      if (win) {
        winLines.push(win);
      }
    }

    return winLines;
  }

  /**
   * Evaluate a single payline
   * @param grid The current grid
   * @param paylineIndex Index of the payline to check (0-24)
   * @returns WinLine if there's a win, null otherwise
   */
  evaluatePayline(grid: Grid, paylineIndex: number): WinLine | null {
    const payline = paylines[paylineIndex];
    
    // Extract symbols along this payline
    const symbols = this.extractPaylineSymbols(grid, payline);
    
    // Count consecutive matches with WILD substitution
    const match = this.countConsecutiveMatches(symbols);
    
    // Check if we have a win (minimum 3 matches)
    if (match.count >= this.paytable.minimumMatch) {
      const payout = this.calculatePayout(match.symbol, match.count);
      
      if (payout > 0) {
        // Build array of winning cell positions
        const cells = [];
        for (let col = 0; col < match.count; col++) {
          cells.push({
            col,
            row: payline[col]
          });
        }

        return {
          paylineIndex,
          symbol: match.symbol,
          matchCount: match.count,
          payout,
          cells
        };
      }
    }

    return null;
  }

  /**
   * Extract symbols along a payline path
   * @param grid The current grid
   * @param payline Array of row indices for each reel
   * @returns Array of symbol IDs along the payline
   */
  private extractPaylineSymbols(grid: Grid, payline: number[]): string[] {
    const symbols: string[] = [];
    
    for (let col = 0; col < payline.length; col++) {
      const row = payline[col];
      if (grid[col] && grid[col][row]) {
        symbols.push(grid[col][row].symbolId);
      } else {
        console.warn(`Missing cell at col=${col}, row=${row}`);
        symbols.push(''); // Empty symbol for missing cell
      }
    }
    
    return symbols;
  }

  /**
   * Count consecutive matching symbols from left with WILD substitution
   * @param symbols Array of symbol IDs along payline
   * @returns Object with the winning symbol and match count
   */
  private countConsecutiveMatches(symbols: string[]): { symbol: string; count: number } {
    if (symbols.length === 0) {
      return { symbol: '', count: 0 };
    }

    // Apply WILD substitution
    const substituted = this.substituteWilds(symbols);
    
    // Count consecutive matches from left
    const firstSymbol = substituted[0];
    let count = 1;

    for (let i = 1; i < substituted.length; i++) {
      if (substituted[i] === firstSymbol) {
        count++;
      } else {
        break; // Stop at first non-match
      }
    }

    // Determine the actual symbol (not WILD unless all were WILD)
    let winningSymbol = firstSymbol;
    if (firstSymbol === 'WILD' && symbols[0] !== 'WILD') {
      // Find first non-WILD symbol in original sequence
      for (let i = 0; i < count; i++) {
        if (symbols[i] !== 'WILD') {
          winningSymbol = symbols[i];
          break;
        }
      }
    }

    return { symbol: winningSymbol, count };
  }

  /**
   * Apply WILD substitution to symbol sequence
   * WILD symbols become the first non-WILD symbol in the sequence
   * If all symbols are WILD, they remain as WILD
   * 
   * @param symbols Original symbol sequence
   * @returns Substituted symbol sequence
   */
  private substituteWilds(symbols: string[]): string[] {
    if (!this.paytable.wildSubstitution) {
      return symbols;
    }

    // Find the first non-WILD symbol
    let targetSymbol: string | null = null;
    for (const symbol of symbols) {
      if (symbol !== 'WILD' && symbol !== '') {
        targetSymbol = symbol;
        break;
      }
    }

    // If no non-WILD symbol found, all are WILDs (or empty)
    if (targetSymbol === null) {
      return symbols;
    }

    // Replace all WILDs with the target symbol
    return symbols.map(s => {
      if (s === 'WILD') {
        return targetSymbol;
      }
      return s;
    });
  }

  /**
   * Calculate payout for a symbol and match count
   * @param symbol Symbol ID
   * @param matchCount Number of consecutive matches (3, 4, or 5)
   * @returns Payout amount in credits
   */
  private calculatePayout(symbol: string, matchCount: number): number {
    const symbolPayouts = this.paytable.payouts[symbol];
    
    if (!symbolPayouts) {
      console.warn(`No paytable entry for symbol: ${symbol}`);
      return 0;
    }

    const payout = symbolPayouts[matchCount.toString()];
    
    if (payout === undefined) {
      return 0;
    }

    // Derive betPerLine from the current total bet amount
    const betPerLine = this.currentBetAmount / this.paytable.totalPaylines;
    return payout * betPerLine;
  }

  /**
   * Get total bet amount (for display purposes)
   */
  getTotalBet(): number {
    return this.paytable.betPerLine * this.paytable.totalPaylines;
  }

  /**
   * Get paytable for a specific symbol
   */
  getSymbolPaytable(symbolId: string): { [key: string]: number } | null {
    return this.paytable.payouts[symbolId] || null;
  }
}
