import { Application } from 'pixi.js';
import { AssetLoader } from './game/AssetLoader';
import { GameController } from './game/GameController';
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
      // Clear any existing content
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

// Proper State Machine
enum SpinState {
  IDLE = 'IDLE',
  SPINNING = 'SPINNING',
  SKIP_REQUESTED = 'SKIP_REQUESTED',
  COMPLETING = 'COMPLETING'
}

let currentState: SpinState = SpinState.IDLE;
let currentSpinData: any = null;
let skipEnableTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
const SAFETY_TIMEOUT_MS = 10000; // 10 second safety timeout

function resetState() {
  currentState = SpinState.IDLE;
  canSkip = false;
  spinBtn.disabled = false;
  
  if (skipEnableTimer) {
    clearTimeout(skipEnableTimer);
    skipEnableTimer = null;
  }
  if (safetyTimeout) {
    clearTimeout(safetyTimeout);
    safetyTimeout = null;
  }
}

async function handleSpin() {
  // ── HURRY UP: double click speeds up landing ──
  if (currentState === SpinState.SPINNING && canSkip) {
    canSkip = false;
    spinBtn.disabled = true; // Lock button until spin finishes
    gridView.hurryUp();     // Speed up remaining reels
    return;                  // spinToGrid() await in the original call will still resolve
  }
  
  // ── NEW SPIN ──
  if (currentState !== SpinState.IDLE) return;
  
  currentState = SpinState.SPINNING;
  spinBtn.disabled = true; // Lock button immediately
  paylineOverlay.clear();
  winPanel.classList.remove('visible');
  canSkip = false;

  const { grid, tarotColumns, wins, totalWin } = gameController.spin();
  currentSpinData = { grid, tarotColumns, wins, totalWin };

  // After 0.25s, unlock button for hurry-up
  skipEnableTimer = setTimeout(() => {
    if (currentState === SpinState.SPINNING) {
      canSkip = true;
      spinBtn.disabled = false;
    }
  }, 250);
  
  safetyTimeout = setTimeout(() => resetState(), SAFETY_TIMEOUT_MS);

  try {
    // This await resolves when ALL reels have stopped + bounced
    // Whether natural or hurried, the same promise resolves
    await gridView.spinToGrid(grid);
    await showResults();
  } catch (error) {
    console.error('❌ Spin error:', error);
  }
  resetState();
}

async function showResults() {
  if (currentSpinData && currentSpinData.wins.length > 0) {
    setTimeout(() => {
      paylineOverlay.showWinningPaylines(currentSpinData.wins);
    }, 200);
  }
  
  updateUI();
  
  if (currentSpinData) {
    console.log('Grid:', currentSpinData.grid);
    console.log('Tarots:', currentSpinData.tarotColumns);
    if (currentSpinData.wins.length > 0) {
      console.log('💰 Wins:', currentSpinData.wins);
      console.log(`🎉 Total Win: ${currentSpinData.totalWin} EUR`);
    }
  }
}

function updateUI() {
  balanceDisplay.textContent = gameController.balance.toFixed(2) + ' €';
  
  if (gameController.lastWin > 0) {
    winDisplay.textContent = gameController.lastWin.toFixed(2) + ' €';
    winPanel.classList.add('visible');
  } else {
    winPanel.classList.remove('visible');
  }
}


// Start the game
init().catch(console.error);
