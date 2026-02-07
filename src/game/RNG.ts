/**
 * Deterministic seeded random number generator using xorshift128
 */
export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed === 0 ? 1 : seed; // Avoid 0 seed
  }

  /**
   * Returns a random float between 0 (inclusive) and 1 (exclusive)
   */
  nextFloat(): number {
    // xorshift32 algorithm
    let x = this.state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.state = x >>> 0; // Ensure unsigned 32-bit integer
    return (this.state >>> 0) / 0xffffffff; // Normalize to [0, 1)
  }

  /**
   * Returns a random integer between min (inclusive) and max (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  /**
   * Returns a random element from an array
   */
  choice<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Returns a weighted random element from an array
   * @param items Array of items to choose from
   * @param weights Array of weights (same length as items)
   */
  weightedChoice<T>(items: T[], weights: number[]): T {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let random = this.nextFloat() * totalWeight;
    
    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return items[i];
      }
    }
    
    return items[items.length - 1]; // Fallback
  }

  /**
   * Shuffles an array in place using Fisher-Yates algorithm
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Returns the current seed state (for debugging)
   */
  getState(): number {
    return this.state;
  }

  /**
   * Sets the seed state (for debugging/testing)
   */
  setState(seed: number): void {
    this.state = seed === 0 ? 1 : seed;
  }
}
