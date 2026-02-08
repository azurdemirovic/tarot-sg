import { Application } from 'pixi.js';
import { AssetLoader } from './game/AssetLoader';
import { GameController, SpinOutput } from './game/GameController';
import { GridView } from './game/render/GridView';
import { PaylineOverlay } from './game/render/PaylineOverlay';

// Initialize PixiJS Application
const app = new Application();

// Game instances
let assetLoader: AssetLoader;
let gameController: GameController;
let gridView: GridView;
let paylineOverlay: PaylineOverlay;
let canSkip: boolean = false;

// UI Elements
const spinBtn = document.getElementById('spin-btn') as HTMLButtonElement;
const balanceDisplay = document.getElementById('balance-display') as HTMLElement;
const winDisplay = document.getElementById('win-display') as HTMLElement;
const winPanel = document.getElementById('win-panel') as HTMLElement;

async function init() {
  try {
    console.log('🎰 Initializing PixiJS...');
    
    // Initialize PixiJS
    await app.init({
      width: 1040,
      height: 720,
      backgroundColor: 0x000000,
      antialias: true,
    });

    console.log('✅ PixiJS initialized');

    // Add canvas to container
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.innerHTML = '';
      gameContainer.appendChild(app.canvas);
      console.log('✅ Canvas added to container');
    } else {
      console.error('❌ game-container not found!');
      return;
    }

    console.log('🎨 Loading assets...');

    // Load assets
    assetLoader = new AssetLoader();
    await assetLoader.load();

    console.log('✅ Assets loaded');

    // Initialize game controller
    const initialSeed = 12345;
    gameController = new GameController(assetLoader, initialSeed);

    console.log('🎮 Creating grid view...');

    // Create grid view
    gridView = new GridView(assetLoader);
    gridView.position.set(105, 105);
    app.stage.addChild(gridView);

    console.log('✅ Grid view added to stage');

    // Create payline overlay
    paylineOverlay = new PaylineOverlay();
    paylineOverlay.position.set(105, 105);
    app.stage.addChild(paylineOverlay);

    console.log('✅ Payline overlay added');

    // Show placeholder
    gridView.showPlaceholder();

    console.log('✅ Placeholder shown');

    updateUI();

    // Enable spin button
    spinBtn.disabled = false;
    spinBtn.addEventListener('click', handleSpin);

    // Space bar triggers spin
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleSpin();
      }
    });

    console.log('✅ Game ready! Canvas size:', app.canvas.width, 'x', app.canvas.height);
    
    app.ticker.add((ticker) => {
      gridView.update(ticker.deltaTime);
    });
  } catch (error) {
    console.error('❌ Initialization error:', error);
  }
}

// ── State Machine ──
enum SpinState {
  IDLE = 'IDLE',
  SPINNING = 'SPINNING',
  SKIP_REQUESTED = 'SKIP_REQUESTED',
  COMPLETING = 'COMPLETING'
}

let currentState: SpinState = SpinState.IDLE;
let currentSpinData: SpinOutput | null = null;
let skipEnableTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
const SAFETY_TIMEOUT_MS = 10000;

function resetState() {
  currentState = SpinState.IDLE;
  canSkip = false;
  spinBtn.disabled = false;
  
  if (skipEnableTimer) { clearTimeout(skipEnableTimer); skipEnableTimer = null; }
  if (safetyTimeout) { clearTimeout(safetyTimeout); safetyTimeout = null; }
}

async function handleSpin() {
  // ── HURRY UP: double click speeds up landing ──
  if (currentState === SpinState.SPINNING && canSkip) {
    canSkip = false;
    spinBtn.disabled = true;
    gridView.hurryUp();
    return;
  }
  
  // ── NEW SPIN ──
  if (currentState !== SpinState.IDLE) return;
  
  currentState = SpinState.SPINNING;
  spinBtn.disabled = true;
  paylineOverlay.clear();
  winPanel.classList.remove('visible');
  canSkip = false;

  const spinOutput = gameController.spin();
  currentSpinData = spinOutput;

  // After 0.25s, unlock button for hurry-up
  skipEnableTimer = setTimeout(() => {
    if (currentState === SpinState.SPINNING) {
      canSkip = true;
      spinBtn.disabled = false;
    }
  }, 250);
  
  safetyTimeout = setTimeout(() => resetState(), SAFETY_TIMEOUT_MS);

  try {
    // ── Phase 1: Spin & land the INITIAL grid (with tarot columns visible) ──
    await gridView.spinToGrid(spinOutput.initialGrid, spinOutput.tarotColumns);

    // ── Phase 2: If a feature triggered, animate the transformation ──
    if (spinOutput.feature && spinOutput.feature.type === 'T_FOOL' && spinOutput.foolResult) {
      // Brief pause so player sees the Fool columns before they transform
      await delay(800);

      // Swap the Fool columns to show WILDs + PREMIUMs
      gridView.updateColumns(spinOutput.finalGrid, spinOutput.feature.columns);

      // Another brief pause for the player to see the new symbols
      await delay(400);
    }

    // ── Phase 3: Show results ──
    await showResults();
  } catch (error) {
    console.error('❌ Spin error:', error);
  }
  resetState();
}

async function showResults() {
  if (!currentSpinData) return;

  if (currentSpinData.wins.length > 0) {
    setTimeout(() => {
      paylineOverlay.showWinningPaylines(currentSpinData!.wins);
    }, 200);
  }
  
  updateUI();
  
  console.log('Grid:', currentSpinData.finalGrid);
  console.log('Tarots:', currentSpinData.tarotColumns);
  if (currentSpinData.feature) {
    console.log(`🃏 Feature: ${currentSpinData.feature.type} ×${currentSpinData.feature.count}`);
  }
  if (currentSpinData.wins.length > 0) {
    console.log('💰 Wins:', currentSpinData.wins);
    if (currentSpinData.multiplier > 1) {
      console.log(`💫 Multiplier: ×${currentSpinData.multiplier}`);
    }
    console.log(`🎉 Total Win: ${currentSpinData.totalWin.toFixed(4)} EUR`);
  }
}

function updateUI() {
  balanceDisplay.textContent = gameController.balance.toFixed(2) + ' €';
  
  if (gameController.lastWin > 0) {
    const multiplier = currentSpinData?.multiplier ?? 1;
    if (multiplier > 1) {
      winDisplay.textContent = gameController.lastWin.toFixed(2) + ' € (×' + multiplier + ')';
    } else {
      winDisplay.textContent = gameController.lastWin.toFixed(2) + ' €';
    }
    winPanel.classList.add('visible');
  } else {
    winPanel.classList.remove('visible');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the game
init().catch(console.error);
