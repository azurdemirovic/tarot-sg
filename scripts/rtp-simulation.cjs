#!/usr/bin/env node
/**
 * RTP Simulation for Tarot Slot Game
 * Standalone Node.js script — replicates all game math from the TypeScript source.
 * Run: node scripts/rtp-simulation.cjs [spins] [seed]
 */

const SPINS = parseInt(process.argv[2]) || 1_000_000;
const SEED = parseInt(process.argv[3]) || 12345;

// ─── RNG (xorshift32) ───────────────────────────────────────────
class RNG {
  constructor(seed) { this.state = seed === 0 ? 1 : seed; }
  nextFloat() {
    let x = this.state;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    this.state = x >>> 0;
    return (this.state >>> 0) / 0xffffffff;
  }
  nextInt(min, max) { return Math.floor(this.nextFloat() * (max - min + 1)) + min; }
  choice(arr) { return arr[this.nextInt(0, arr.length - 1)]; }
  weightedChoice(items, weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total === 0) return items[items.length - 1];
    let r = this.nextFloat() * total;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// ─── SYMBOLS ────────────────────────────────────────────────────
const SYMBOLS = [
  { id: 'WILD',       tier: 'WILD',    baseWeight: 5 },
  { id: 'COIN',       tier: 'LOW',     baseWeight: 30 },
  { id: 'CUP',        tier: 'LOW',     baseWeight: 28 },
  { id: 'KEY',        tier: 'LOW',     baseWeight: 26 },
  { id: 'SWORD',      tier: 'LOW',     baseWeight: 28 },
  { id: 'RING',       tier: 'LOW',     baseWeight: 27 },
  { id: 'FLEUR',      tier: 'LOW',     baseWeight: 29 },
  { id: 'SKULLCROSS', tier: 'PREMIUM', baseWeight: 15 },
  { id: 'DICE',       tier: 'PREMIUM', baseWeight: 12 },
  { id: 'KING',       tier: 'PREMIUM', baseWeight: 10 },
  { id: 'ANGEL',      tier: 'PREMIUM', baseWeight: 8 },
];
const NORMAL_SYMBOLS = SYMBOLS; // excludes MALE, FEMALE, tarots
const NORMAL_WEIGHTS = NORMAL_SYMBOLS.map(s => s.baseWeight);

const PREMIUM_POOL = SYMBOLS.filter(s => s.tier === 'PREMIUM');
const LOW_POOL = SYMBOLS.filter(s => s.tier === 'LOW');

const TAROT_SYMBOLS = [
  { id: 'T_FOOL',      baseWeight: 30 },
  { id: 'T_CUPS',      baseWeight: 30 },
  { id: 'T_LOVERS',    baseWeight: 20 },
  { id: 'T_PRIESTESS', baseWeight: 10 },
  { id: 'T_DEATH',     baseWeight: 10 },
];
const TAROT_WEIGHTS = TAROT_SYMBOLS.map(s => s.baseWeight);

// ─── PAYTABLE ───────────────────────────────────────────────────
const PAYTABLE = {
  WILD:       { 3: 100, 4: 500, 5: 2500 },
  ANGEL:      { 3: 48,  4: 190, 5: 750 },
  KING:       { 3: 38,  4: 130, 5: 500 },
  DICE:       { 3: 28,  4: 75,  5: 375 },
  SKULLCROSS: { 3: 18,  4: 55,  5: 225 },
  FLEUR:      { 3: 15,  4: 45,  5: 185 },
  RING:       { 3: 12,  4: 38,  5: 150 },
  SWORD:      { 3: 12,  4: 38,  5: 150 },
  KEY:        { 3: 10,  4: 30,  5: 110 },
  CUP:        { 3: 10,  4: 24,  5: 95 },
  COIN:       { 3: 10,  4: 24,  5: 95 },
  T_FOOL:     { 3: 25,  4: 60,  5: 160 },
  T_CUPS:     { 3: 25,  4: 60,  5: 160 },
  T_LOVERS:   { 3: 30,  4: 80,  5: 200 },
  T_PRIESTESS:{ 3: 50,  4: 120, 5: 320 },
  T_DEATH:    { 3: 50,  4: 120, 5: 320 },
};

// ─── PAYLINES (25 unique) ───────────────────────────────────────
const PAYLINES = [
  [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],
  [0,1,2,1,0],[2,1,0,1,2],
  [0,1,0,1,0],[2,1,2,1,2],[1,0,1,0,1],[1,2,1,2,1],
  [0,2,0,2,0],[2,0,2,0,2],
  [0,0,1,1,2],[2,2,1,1,0],[0,1,1,2,2],[2,1,1,0,0],
  [1,0,1,2,2],[1,2,1,0,0],[2,2,1,0,1],[0,0,1,2,1],
  [0,1,1,1,2],[2,1,1,1,0],
  [0,1,2,0,0],[2,1,0,2,2],
  [0,0,1,0,0],[2,2,1,2,2],
];

// ─── CONSTANTS ──────────────────────────────────────────────────
const BET = 0.20;
const BET_PER_LINE = BET / 25;
const TAROT_CHANCE = 0.071;
const COLS = 5;
const ROWS = 3;

// ─── HELPERS ────────────────────────────────────────────────────
function generateGrid(rng, cols, rows) {
  const grid = [];
  for (let c = 0; c < cols; c++) {
    grid[c] = [];
    for (let r = 0; r < rows; r++) {
      const sym = rng.weightedChoice(NORMAL_SYMBOLS, NORMAL_WEIGHTS);
      grid[c][r] = sym.id;
    }
  }
  return grid;
}

function getTier(symbolId) {
  const s = SYMBOLS.find(x => x.id === symbolId);
  return s ? s.tier : 'LOW';
}

// ─── PAYLINE EVALUATION ─────────────────────────────────────────
function evaluatePaylines(grid, betPerLine) {
  let totalWin = 0;
  for (const payline of PAYLINES) {
    const symbols = payline.map((row, col) => grid[col][row]);
    // Substitute wilds
    let target = null;
    for (const s of symbols) { if (s !== 'WILD' && s !== '') { target = s; break; } }
    const substituted = target ? symbols.map(s => s === 'WILD' ? target : s) : symbols;
    // Count consecutive from left
    const first = substituted[0];
    let count = 1;
    for (let i = 1; i < substituted.length; i++) {
      if (substituted[i] === first) count++; else break;
    }
    // Determine winning symbol
    let winSymbol = first;
    if (first === 'WILD' && symbols[0] !== 'WILD') {
      for (let i = 0; i < count; i++) { if (symbols[i] !== 'WILD') { winSymbol = symbols[i]; break; } }
    }
    if (count >= 3) {
      const entry = PAYTABLE[winSymbol];
      if (entry && entry[count]) {
        totalWin += entry[count] * betPerLine;
      }
    }
  }
  return totalWin;
}

// ─── SPIN GENERATOR (with tarot columns) ────────────────────────
function generateSpin(rng) {
  const grid = [];
  const tarotColumns = [];
  const hasTarots = rng.nextFloat() < TAROT_CHANCE;
  let tarotColIndices = [];
  let tarotTypes = [];

  if (hasTarots) {
    const roll = rng.nextFloat();
    let tarotCount = 1;
    if (roll > 0.20 && roll <= 0.70) tarotCount = 2;
    else if (roll > 0.70) tarotCount = 3;

    const avail = [0, 1, 2, 3, 4];
    rng.shuffle(avail);
    tarotColIndices = avail.slice(0, tarotCount);

    for (let i = 0; i < tarotCount; i++) {
      const t = rng.weightedChoice(TAROT_SYMBOLS, TAROT_WEIGHTS);
      tarotTypes.push(t.id);
    }
  }

  for (let c = 0; c < COLS; c++) {
    grid[c] = [];
    const tIdx = tarotColIndices.indexOf(c);
    if (tIdx !== -1) {
      const tt = tarotTypes[tIdx];
      for (let r = 0; r < ROWS; r++) grid[c][r] = tt;
      tarotColumns.push({ col: c, tarotType: tt });
    } else {
      for (let r = 0; r < ROWS; r++) {
        grid[c][r] = rng.weightedChoice(NORMAL_SYMBOLS, NORMAL_WEIGHTS).id;
      }
    }
  }
  return { grid, tarotColumns };
}

// ─── FEATURE DETECTION ──────────────────────────────────────────
function detectTrigger(tarotColumns) {
  if (tarotColumns.length < 2) return null;
  const grouped = {};
  for (const tc of tarotColumns) {
    if (!grouped[tc.tarotType]) grouped[tc.tarotType] = [];
    grouped[tc.tarotType].push(tc.col);
  }
  const priority = ['T_DEATH', 'T_PRIESTESS', 'T_LOVERS', 'T_FOOL', 'T_CUPS'];
  for (const type of priority) {
    const cols = grouped[type];
    if (cols && cols.length >= 2) {
      return { type, count: cols.length, columns: cols.sort((a, b) => a - b) };
    }
  }
  return null;
}

// ─── FOOL FEATURE ───────────────────────────────────────────────
function applyFool(rng, grid, trigger) {
  const perColWilds = [];
  for (let i = 0; i < trigger.columns.length; i++) {
    if (trigger.count === 2) {
      perColWilds.push(rng.nextInt(1, 3));
    } else {
      const roll = rng.nextFloat();
      if (roll < 0.20) perColWilds.push(1);
      else if (roll < 0.60) perColWilds.push(2);
      else perColWilds.push(3);
    }
  }
  let totalWilds = perColWilds.reduce((s, v) => s + v, 0);
  if (totalWilds > 9) {
    let excess = totalWilds - 9;
    for (let i = perColWilds.length - 1; i >= 0 && excess > 0; i--) {
      const reduce = Math.min(excess, perColWilds[i] - 1);
      perColWilds[i] -= reduce;
      excess -= reduce;
    }
  }
  trigger.columns.forEach((col, idx) => {
    const wildCount = perColWilds[idx];
    const rowIndices = [0, 1, 2];
    rng.shuffle(rowIndices);
    const wildRows = new Set(rowIndices.slice(0, wildCount));
    for (let row = 0; row < ROWS; row++) {
      if (wildRows.has(row)) {
        grid[col][row] = 'WILD';
      } else {
        grid[col][row] = rng.choice(PREMIUM_POOL).id;
      }
    }
  });
  return trigger.count >= 3 ? 5 : 3;
}

// ─── CUPS FEATURE ───────────────────────────────────────────────
// Cups payout = sum of all multiplier cell values × betAmount (no paylines)
function applyCups(rng, grid, trigger) {
  const pool2 = [2, 3];
  const pool3 = [3, 5, 10];
  let totalMultiplierSum = 0;

  trigger.columns.forEach((col) => {
    const mCount = trigger.count === 2 ? rng.nextInt(1, 2) : rng.nextInt(2, 3);
    const pool = trigger.count === 2 ? pool2 : pool3;
    for (let i = 0; i < mCount; i++) {
      totalMultiplierSum += rng.choice(pool);
    }
  });

  return totalMultiplierSum * BET;
}

// ─── LOVERS FEATURE ─────────────────────────────────────────────
function applyLovers(rng, trigger) {
  const spinsTotal = trigger.count >= 3 ? 6 : 3;
  const multiplier = trigger.count === 2 ? 2 : 1;
  let totalWin = 0;

  for (let spin = 0; spin < spinsTotal; spin++) {
    // Generate fresh grid
    const grid = generateGrid(rng, COLS, ROWS);

    // Generate 3 candidates, pick best (simulate player picking — use index 0)
    const candidates = [];
    for (let i = 0; i < 3; i++) {
      const roll = rng.nextFloat();
      if (roll < 0.60) candidates.push(rng.choice(PREMIUM_POOL).id);
      else if (roll < 0.90) candidates.push(rng.choice(LOW_POOL).id);
      else candidates.push('WILD');
    }
    const bondSymbol = candidates[0]; // Simulate player always picking first

    // Roll area size (rebalanced — biased toward smaller areas)
    const areaRoll = rng.nextFloat();
    let tw, th;
    if (areaRoll < 0.15) { tw = 1; th = 1; }
    else if (areaRoll < 0.40) {
      if (rng.nextFloat() < 0.5) { tw = 2; th = 1; } else { tw = 1; th = 2; }
    } else if (areaRoll < 0.70) {
      if (rng.nextFloat() < 0.5) { tw = 2; th = 2; } else { tw = 3; th = 1; }
    } else if (areaRoll < 0.88) {
      if (rng.nextFloat() < 0.5) { tw = 3; th = 2; } else { tw = 2; th = 3; }
    } else if (areaRoll < 0.97) {
      if (rng.nextFloat() < 0.5) { tw = 4; th = 2; } else { tw = 3; th = 3; }
    } else {
      if (rng.nextFloat() < 0.5) { tw = 5; th = 2; } else { tw = 4; th = 3; }
    }

    tw = Math.min(tw, COLS);
    th = Math.min(th, ROWS);
    const startCol = rng.nextInt(0, COLS - tw);
    const startRow = rng.nextInt(0, ROWS - th);

    // Fill bounding rectangle
    for (let c = startCol; c < startCol + tw; c++) {
      for (let r = startRow; r < startRow + th; r++) {
        grid[c][r] = bondSymbol;
      }
    }

    totalWin += evaluatePaylines(grid, BET_PER_LINE) * multiplier;
  }
  return totalWin;
}

// ─── PRIESTESS FEATURE ──────────────────────────────────────────
function applyPriestess(rng, trigger) {
  const spinsTotal = trigger.count >= 3 ? 9 : 6;
  const multiplier = trigger.count >= 3 ? 2 : 1;
  let totalWin = 0;
  const mysteryCells = []; // persistent across spins

  for (let spin = 0; spin < spinsTotal; spin++) {
    // Generate fresh grid
    const grid = generateGrid(rng, COLS, ROWS);

    // Roll new mystery cell count
    const countRoll = rng.nextFloat();
    let coverCount;
    if (countRoll < 0.70) coverCount = 1;
    else if (countRoll < 0.92) coverCount = 2;
    else coverCount = 3;

    // Find available cells
    const occupiedSet = new Set(mysteryCells.map(c => `${c[0]},${c[1]}`));
    const available = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (!occupiedSet.has(`${c},${r}`)) available.push([c, r]);
      }
    }
    rng.shuffle(available);
    const newCells = available.slice(0, Math.min(coverCount, available.length));
    mysteryCells.push(...newCells);

    // Roll mystery symbol
    const mysterySymbol = rng.weightedChoice(NORMAL_SYMBOLS, NORMAL_WEIGHTS).id;

    // Apply all mystery cells
    for (const [c, r] of mysteryCells) {
      grid[c][r] = mysterySymbol;
    }

    totalWin += evaluatePaylines(grid, BET_PER_LINE) * multiplier;
  }
  return totalWin;
}

// ─── DEATH FEATURE ──────────────────────────────────────────────
function findClusters(grid, cols, rows) {
  const clusters = [];
  const key = (c, r) => `${c},${r}`;
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  const symbolTypes = new Set();
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (grid[c] && grid[c][r] && grid[c][r] !== 'WILD' && grid[c][r] !== 'EMPTY' && !grid[c][r].startsWith('T_'))
        symbolTypes.add(grid[c][r]);

  for (const target of symbolTypes) {
    const visited = new Set();
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!grid[c] || grid[c][r] !== target) continue;
        const k = key(c, r);
        if (visited.has(k)) continue;
        const cells = [];
        const queue = [{ c, r }];
        visited.add(k);
        while (queue.length > 0) {
          const cell = queue.shift();
          cells.push(cell);
          for (const [dc, dr] of dirs) {
            const nc = cell.c + dc, nr = cell.r + dr;
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
            const nk = key(nc, nr);
            if (visited.has(nk)) continue;
            if (!grid[nc] || !grid[nc][nr]) continue;
            if (grid[nc][nr] === target || grid[nc][nr] === 'WILD') {
              visited.add(nk);
              queue.push({ c: nc, r: nr });
            }
          }
        }
        if (cells.length >= 3) clusters.push({ symbol: target, cells });
      }
    }
  }

  // Pure WILD clusters
  {
    const visited = new Set();
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!grid[c] || grid[c][r] !== 'WILD') continue;
        const k = key(c, r);
        if (visited.has(k)) continue;
        const cells = [];
        const queue = [{ c, r }];
        visited.add(k);
        while (queue.length > 0) {
          const cell = queue.shift();
          cells.push(cell);
          for (const [dc, dr] of dirs) {
            const nc = cell.c + dc, nr = cell.r + dr;
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
            const nk = key(nc, nr);
            if (visited.has(nk)) continue;
            if (!grid[nc] || grid[nc][nr] !== 'WILD') continue;
            visited.add(nk);
            queue.push({ c: nc, r: nr });
          }
        }
        if (cells.length >= 3) clusters.push({ symbol: 'WILD', cells });
      }
    }
  }
  return clusters;
}

function clusterPayout(symbolId, size, betAmount) {
  const tier = getTier(symbolId);
  let mult;
  if (tier === 'PREMIUM') {
    if (size >= 6) mult = 30; else if (size === 5) mult = 15; else if (size === 4) mult = 5; else mult = 1;
  } else if (tier === 'WILD') {
    if (size >= 6) mult = 50; else if (size === 5) mult = 25; else if (size === 4) mult = 10; else mult = 2;
  } else {
    if (size >= 6) mult = 10; else if (size === 5) mult = 5; else if (size === 4) mult = 2; else mult = 0.5;
  }
  return mult * betAmount;
}

function applyDeath(rng, trigger) {
  let spinsTotal = 10;
  let spinsRemaining = spinsTotal;
  let reapBar = 0;
  const thresholds = [10, 20, 30];
  let currentExpansion = 0;
  let gridCols = 5, gridRows = 3;
  let stickyWilds = new Set();
  let totalWin = 0;

  while (spinsRemaining > 0) {
    // Generate grid
    const grid = [];
    for (let c = 0; c < gridCols; c++) {
      grid[c] = [];
      for (let r = 0; r < gridRows; r++) {
        const k = `${c},${r}`;
        if (stickyWilds.has(k)) {
          grid[c][r] = 'WILD';
        } else {
          grid[c][r] = rng.weightedChoice(NORMAL_SYMBOLS, NORMAL_WEIGHTS).id;
        }
      }
    }

    // Find & slash clusters
    const clusters = findClusters(grid, gridCols, gridRows);
    const slashedSet = new Set();
    for (const cluster of clusters) {
      totalWin += clusterPayout(cluster.symbol, cluster.cells.length, BET);
      for (const cell of cluster.cells) slashedSet.add(`${cell.c},${cell.r}`);
    }

    // Remove consumed sticky wilds
    for (const k of slashedSet) {
      if (stickyWilds.has(k)) stickyWilds.delete(k);
    }

    // Refill slashed cells — 15% chance sticky WILD
    for (const k of slashedSet) {
      if (rng.nextFloat() < 0.15) {
        stickyWilds.add(k);
      }
    }

    reapBar += slashedSet.size;

    // Check expansion
    while (
      currentExpansion < thresholds.length &&
      reapBar >= thresholds[currentExpansion] &&
      gridCols < 8 && gridRows < 6
    ) {
      currentExpansion++;
      gridCols++;
      gridRows++;
      spinsRemaining++; // bonus spin
    }

    spinsRemaining--;
  }
  return totalWin;
}

// ─── MAIN SIMULATION ────────────────────────────────────────────
function simulate() {
  const rng = new RNG(SEED);
  let totalBet = 0;
  let totalWin = 0;

  // Stats tracking
  const stats = {
    totalSpins: 0,
    baseWins: 0,
    foolTriggers: 0, foolWin: 0,
    cupsTriggers: 0, cupsWin: 0,
    loversTriggers: 0, loversWin: 0,
    priestessTriggers: 0, priestessWin: 0,
    deathTriggers: 0, deathWin: 0,
    singleTarots: 0,
    noFeatureTarots: 0, // 2+ tarots but mixed types
  };

  const progressInterval = Math.floor(SPINS / 10);

  for (let i = 0; i < SPINS; i++) {
    if (i > 0 && i % progressInterval === 0) {
      const pct = ((i / SPINS) * 100).toFixed(0);
      const currentRTP = ((totalWin / totalBet) * 100).toFixed(2);
      process.stdout.write(`  ${pct}% done... RTP so far: ${currentRTP}%\r`);
    }

    totalBet += BET;
    stats.totalSpins++;

    const { grid, tarotColumns } = generateSpin(rng);
    const feature = detectTrigger(tarotColumns);

    if (feature) {
      let featureWin = 0;
      switch (feature.type) {
        case 'T_FOOL': {
          const multiplier = applyFool(rng, grid, feature);
          featureWin = evaluatePaylines(grid, BET_PER_LINE) * multiplier;
          stats.foolTriggers++;
          stats.foolWin += featureWin;
          break;
        }
        case 'T_CUPS': {
          featureWin = applyCups(rng, grid, feature);
          stats.cupsTriggers++;
          stats.cupsWin += featureWin;
          break;
        }
        case 'T_LOVERS': {
          featureWin = applyLovers(rng, feature);
          stats.loversTriggers++;
          stats.loversWin += featureWin;
          break;
        }
        case 'T_PRIESTESS': {
          featureWin = applyPriestess(rng, feature);
          stats.priestessTriggers++;
          stats.priestessWin += featureWin;
          break;
        }
        case 'T_DEATH': {
          featureWin = applyDeath(rng, feature);
          stats.deathTriggers++;
          stats.deathWin += featureWin;
          break;
        }
      }
      totalWin += featureWin;
    } else {
      // Base game (may have 0 or 1 tarot column, or 2+ mixed)
      if (tarotColumns.length === 1) stats.singleTarots++;
      else if (tarotColumns.length >= 2) stats.noFeatureTarots++;

      const baseWin = evaluatePaylines(grid, BET_PER_LINE);
      totalWin += baseWin;
      if (baseWin > 0) stats.baseWins++;
    }
  }

  // ─── RESULTS ────────────────────────────────────────────────
  const rtp = (totalWin / totalBet) * 100;
  console.log('\n');
  console.log('═══════════════════════════════════════════════════');
  console.log('  TAROT SLOT — RTP SIMULATION RESULTS');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Spins:          ${SPINS.toLocaleString()}`);
  console.log(`  Seed:           ${SEED}`);
  console.log(`  Bet per spin:   €${BET}`);
  console.log(`  Total wagered:  €${totalBet.toFixed(2)}`);
  console.log(`  Total won:      €${totalWin.toFixed(2)}`);
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  RTP:            ${rtp.toFixed(4)}%`);
  console.log(`  House Edge:     ${(100 - rtp).toFixed(4)}%`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('  BASE GAME');
  console.log(`    Winning spins:    ${stats.baseWins.toLocaleString()} / ${stats.totalSpins.toLocaleString()} (${((stats.baseWins/stats.totalSpins)*100).toFixed(2)}% hit rate)`);
  console.log(`    Base game RTP:    ${((totalWin - stats.foolWin - stats.cupsWin - stats.loversWin - stats.priestessWin - stats.deathWin) / totalBet * 100).toFixed(4)}%`);
  console.log('');
  console.log('  TAROT EVENTS');
  console.log(`    Single tarot (no trigger):  ${stats.singleTarots.toLocaleString()}`);
  console.log(`    Mixed tarots (no trigger):  ${stats.noFeatureTarots.toLocaleString()}`);
  console.log('');
  console.log('  FEATURE BREAKDOWN');
  console.log(`    ┌─────────────┬──────────┬────────────────┬──────────────┐`);
  console.log(`    │ Feature     │ Triggers │ Trigger Rate   │ Feature RTP  │`);
  console.log(`    ├─────────────┼──────────┼────────────────┼──────────────┤`);

  const features = [
    ['Fool',      stats.foolTriggers,      stats.foolWin],
    ['Cups',      stats.cupsTriggers,      stats.cupsWin],
    ['Lovers',    stats.loversTriggers,    stats.loversWin],
    ['Priestess', stats.priestessTriggers, stats.priestessWin],
    ['Death',     stats.deathTriggers,     stats.deathWin],
  ];
  for (const [name, triggers, win] of features) {
    const rate = ((triggers / stats.totalSpins) * 100).toFixed(4);
    const fRtp = ((win / totalBet) * 100).toFixed(4);
    console.log(`    │ ${name.padEnd(11)} │ ${String(triggers).padStart(8)} │ ${(rate + '%').padStart(14)} │ ${(fRtp + '%').padStart(12)} │`);
  }
  console.log(`    └─────────────┴──────────┴────────────────┴──────────────┘`);
  console.log('');
  console.log(`  Total Feature RTP: ${(((stats.foolWin+stats.cupsWin+stats.loversWin+stats.priestessWin+stats.deathWin)/totalBet)*100).toFixed(4)}%`);
  console.log('═══════════════════════════════════════════════════');
}

simulate();
