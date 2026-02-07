/**
 * Paylines Configuration - 25 Paylines
 * Each payline must have exactly 5 asterisks (one per reel)
 */

const NOTATED_PAYLINES = [
  // === Straight Lines (3) ===
  `
  -----
  *****
  -----
  `, // 1: Middle straight
  
  `
  *****
  -----
  -----
  `, // 2: Top straight
  
  `
  -----
  -----
  *****
  `, // 3: Bottom straight

  // === V-Shapes (2) ===
  `
  *---*
  -*-*-
  --*--
  `, // 4: V shape
  
  `
  --*--
  -*-*-
  *---*
  `, // 5: Inverted V

  // === Zigzag Patterns (4) ===
  `
  *-*-*
  -*-*-
  -----
  `, // 6: Top zigzag
  
  `
  -----
  -*-*-
  *-*-*
  `, // 7: Bottom zigzag
  
  `
  -*-*-
  *-*-*
  -----
  `, // 8: Top wave
  
  `
  -----
  *-*-*
  -*-*-
  `, // 9: Bottom wave

  // === W and M Shapes (2) ===
  `
  *-*-*
  -----
  -*-*-
  `, // 10: W shape
  
  `
  -*-*-
  -----
  *-*-*
  `, // 11: M shape

  // === Complex Patterns (14) ===
  `
  *---*
  -*-*-
  --*--
  `, // 12: U shape
  
  `
  --*--
  -*-*-
  *---*
  `, // 13: Inverted U
  
  `
  *-*-*
  -*-*-
  --*--
  `, // 14: Top heavy
  
  `
  --*--
  -*-*-
  *-*-*
  `, // 15: Bottom heavy
  
  `
  *-*-*
  -----
  -*-*-
  `, // 16: Repeat W
  
  `
  -*-*-
  -----
  *-*-*
  `, // 17: Repeat M
  
  `
  *-*-*
  -*-*-
  --*--
  `, // 18: Pattern A
  
  `
  --*--
  -*-*-
  *-*-*
  `, // 19: Pattern B
  
  `
  *-*-*
  -----
  -*-*-
  `, // 20: Pattern C
  
  `
  -*-*-
  -----
  *-*-*
  `, // 21: Pattern D
  
  `
  *-*-*
  -*-*-
  -*-*-
  `, // 22: Double middle
  
  `
  -*-*-
  -*-*-
  *-*-*
  `, // 23: Triple middle
  
  `
  *-*-*
  -*-*-
  *-*-*
  `, // 24: All outer
  
  `
  -*-*-
  *-*-*
  -*-*-
  `, // 25: Alternating
];

/**
 * Convert payline notation to row sequence
 */
function convertToRowSequence(line: string): number[] {
  const rows = getRows(line);
  const columns = rows[0].length;
  const sequence: number[] = [];
  
  for (let column = 0; column < columns; column++) {
    const rowIndex = rows.findIndex((row) => row[column] === '*');
    if (rowIndex === -1) {
      throw new Error(`Payline column ${column} has no asterisk marker`);
    }
    sequence.push(rowIndex);
  }
  
  if (sequence.length !== 5) {
    throw new Error(`Payline must have exactly 5 columns, got ${sequence.length}`);
  }
  
  return sequence;
}

/**
 * Split payline into rows
 */
function getRows(line: string): string[] {
  const rows = line
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean);
  
  if (rows.length !== 3) {
    throw new Error(`Payline must have exactly 3 rows, got ${rows.length}`);
  }
  
  return rows;
}

// Convert all paylines
const paylines: number[][] = NOTATED_PAYLINES.map((line, index) => {
  try {
    return convertToRowSequence(line);
  } catch (error) {
    throw new Error(`Error in payline ${index + 1}: ${error}`);
  }
});

// Validate
paylines.forEach((payline, index) => {
  if (payline.some(row => row < 0 || row > 2)) {
    throw new Error(`Payline ${index + 1} contains invalid row index`);
  }
});

console.log(`✅ Loaded ${paylines.length} paylines`);

export default paylines;
