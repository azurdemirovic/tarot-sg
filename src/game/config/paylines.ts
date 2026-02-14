/**
 * Paylines Configuration — 25 Unique Paylines
 *
 * Each payline is a 5-element array of row indices [r0, r1, r2, r3, r4],
 * one per reel (column 0–4).  Row 0 = top, 1 = middle, 2 = bottom.
 *
 * All 25 sequences are verified unique.
 */

const paylines: number[][] = [
  // --- Straight lines (3) ---
  [1, 1, 1, 1, 1], //  1  Middle straight
  [0, 0, 0, 0, 0], //  2  Top straight
  [2, 2, 2, 2, 2], //  3  Bottom straight

  // --- V shapes (2) ---
  [0, 1, 2, 1, 0], //  4  V down
  [2, 1, 0, 1, 2], //  5  V up (inverted V)

  // --- Zigzags (4) ---
  [0, 1, 0, 1, 0], //  6  Top zigzag
  [2, 1, 2, 1, 2], //  7  Bottom zigzag
  [1, 0, 1, 0, 1], //  8  Mid-top zigzag
  [1, 2, 1, 2, 1], //  9  Mid-bottom zigzag

  // --- W / M (2) ---
  [0, 2, 0, 2, 0], // 10  W shape
  [2, 0, 2, 0, 2], // 11  M shape

  // --- Steps (4) ---
  [0, 0, 1, 1, 2], // 12  Step down
  [2, 2, 1, 1, 0], // 13  Step up
  [0, 1, 1, 2, 2], // 14  Staircase down
  [2, 1, 1, 0, 0], // 15  Staircase up

  // --- Bumps (4) ---
  [1, 0, 1, 2, 2], // 16  Bump down-right
  [1, 2, 1, 0, 0], // 17  Bump up-right
  [2, 2, 1, 0, 1], // 18  Bump down-left
  [0, 0, 1, 2, 1], // 19  Bump up-left

  // --- Arches (2) ---
  [0, 1, 1, 1, 2], // 20  Arch down
  [2, 1, 1, 1, 0], // 21  Arch up

  // --- Slides (2) ---
  [0, 1, 2, 0, 0], // 22  Slide right
  [2, 1, 0, 2, 2], // 23  Slide left

  // --- Flat-dip (2) ---
  [0, 0, 1, 0, 0], // 24  Top dip
  [2, 2, 1, 2, 2], // 25  Bottom dip
];

// --- Validation ---
if (paylines.length !== 25) {
  throw new Error(`Expected 25 paylines, got ${paylines.length}`);
}

// Check uniqueness
const seen = new Set<string>();
paylines.forEach((pl, i) => {
  if (pl.length !== 5) throw new Error(`Payline ${i + 1} has ${pl.length} entries, expected 5`);
  if (pl.some(r => r < 0 || r > 2)) throw new Error(`Payline ${i + 1} has invalid row index`);
  const key = pl.join(',');
  if (seen.has(key)) throw new Error(`Payline ${i + 1} is a duplicate: [${key}]`);
  seen.add(key);
});

console.log(`✅ Loaded ${paylines.length} unique paylines`);

export default paylines;
