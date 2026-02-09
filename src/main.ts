import { Application } from 'pixi.js';
import { AssetLoader } from './game/AssetLoader';
import { GameController, SpinOutput } from './game/GameController';
import { GridView } from './game/render/GridView';
import { PaylineOverlay } from './game/render/PaylineOverlay';
import { FoolRevealAnimation } from './game/render/FoolRevealAnimation';
import { CupsRevealAnimation } from './game/render/CupsRevealAnimation';
import { ThreeBackground } from './threeBackground';
import { DEBUG } from './game/config/debug';

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
    
    // Initialize PixiJS (transparent so 3D background shows through)
    await app.init({
      width: 1040,
      height: 720,
      backgroundAlpha: DEBUG.BG_ENABLED ? 0 : 1,
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

    // ── Initialize Three.js 3D background ──
    if (DEBUG.BG_ENABLED) {
      const threeCanvas = document.getElementById('three-canvas') as HTMLCanvasElement;
      if (threeCanvas) {
        new ThreeBackground({
          canvas: threeCanvas,
          modelPath: '/assets/3d/free_game_character_-the_ancient_woman_titan.glb',
          animate: DEBUG.BG_ANIMATE_CAMERA,
        });
        console.log('✅ Three.js 3D background initialized');
      }
    }
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
let hasSpunOnce: boolean = false; // Track if any spin has happened
let cupsFeatureActive: boolean = false; // Track if Cups feature is currently running
let currentCupsAnimation: CupsRevealAnimation | null = null; // Reference to active Cups animation

function resetState() {
  currentState = SpinState.IDLE;
  canSkip = false;
  spinBtn.disabled = false;
  
  if (skipEnableTimer) { clearTimeout(skipEnableTimer); skipEnableTimer = null; }
  if (safetyTimeout) { clearTimeout(safetyTimeout); safetyTimeout = null; }
}

async function handleSpin() {
  // ── CUPS FEATURE ACTIVE: Speed up current collection spin ──
  if (cupsFeatureActive && currentCupsAnimation) {
    console.log('⚡ Speeding up Cups collection spin');
    currentCupsAnimation.skipCurrentSpin();
    return;
  }
  
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

  // Debug: Force Cups feature if enabled (only on first spin)
  let spinOutput: SpinOutput;
  if (DEBUG.FORCE_CUPS && !hasSpunOnce) {
    console.log('🔧 DEBUG: Forcing Cups feature (first spin only)');
    hasSpunOnce = true;
    spinOutput = gameController.forceTarotSpin('T_CUPS', DEBUG.CUPS_COLUMNS);
  } else {
    spinOutput = gameController.spin();
    hasSpunOnce = true;
  }
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
    // ── Phase 1: Spin & land the INITIAL grid (cardbacks shown for tarot columns) ──
    await gridView.spinToGrid(spinOutput.initialGrid, spinOutput.tarotColumns);

    // ── Phase 1.5: Flip cardbacks to reveal tarot faces ──
    if (spinOutput.tarotColumns.length > 0) {
      spinBtn.disabled = true; // Lock button during reveal sequence
      await delay(400); // Suspense pause — player sees cardbacks
      await gridView.flipTarotColumns(spinOutput.tarotColumns);
      await delay(300); // Brief pause to admire revealed tarots
    }

    // ── Phase 2: If a Fool feature triggered, play the reveal animation ──
    if (spinOutput.feature && spinOutput.feature.type === 'T_FOOL' && spinOutput.foolResult) {
      spinBtn.disabled = true; // Lock button during reveal

      const foolReveal = new FoolRevealAnimation(
        gridView,
        gridView.getReelSpinners(),
        assetLoader,
        gridView.getCellSize(),
        gridView.getPadding(),
        gridView.getCols(),
        gridView.getRows()
      );

      await foolReveal.play(
        spinOutput.feature,
        spinOutput.foolResult,
        spinOutput.finalGrid,
        spinOutput.multiplier,
        spinOutput.wins,
        spinOutput.totalWin,
        gameController.betAmount
      );
    }

    // ── Phase 2b: If a Cups feature triggered, play the multiplier collection animation ──
    if (spinOutput.feature && spinOutput.feature.type === 'T_CUPS' && spinOutput.cupsResult) {
      spinBtn.disabled = false; // Allow clicking to speed up Cups spins
      cupsFeatureActive = true; // Mark Cups as active

      const cupsReveal = new CupsRevealAnimation(
        gridView,
        gridView.getReelSpinners(),
        assetLoader,
        gridView.getCellSize(),
        gridView.getPadding(),
        gridView.getCols(),
        gridView.getRows(),
        gameController.getCurrentSeed()
      );
      
      currentCupsAnimation = cupsReveal; // Store reference for skip functionality

      const cupsPayout = await cupsReveal.play(
        spinOutput.feature,
        spinOutput.cupsResult,
        gameController.betAmount
      );

      // Cups feature finished
      cupsFeatureActive = false;
      currentCupsAnimation = null;

      // Update balance with Cups payout
      gameController.balance += cupsPayout;
      gameController.lastWin = cupsPayout;
      currentSpinData.totalWin = cupsPayout;
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
