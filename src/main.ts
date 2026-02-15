import { Application } from 'pixi.js';
import { AssetLoader } from './game/AssetLoader';
import { GameController, SpinOutput } from './game/GameController';
import { GridView } from './game/render/GridView';
import { PaylineOverlay } from './game/render/PaylineOverlay';
import { FoolRevealAnimation } from './game/render/FoolRevealAnimation';
import { CupsRevealAnimation } from './game/render/CupsRevealAnimation';
import { LoversRevealAnimation } from './game/render/LoversRevealAnimation';
import { PriestessRevealAnimation } from './game/render/PriestessRevealAnimation';
import { DeathRevealAnimation } from './game/render/DeathRevealAnimation';
import { ThreeBackground } from './threeBackground';
import { ReelSpinner } from './game/render/ReelSpinner';
import { TarotTitleDisplay } from './game/render/TarotTitleDisplay';
import { DEBUG } from './game/config/debug';
import { DebugMenu } from './game/config/DebugMenu';
import { soundManager } from './game/utils/SoundManager';
import { wait } from './game/utils/AnimationUtils';

// Initialize PixiJS Application
const app = new Application();

// Game instances
let assetLoader: AssetLoader;
let gameController: GameController;
let gridView: GridView;
let paylineOverlay: PaylineOverlay;
let canSkip: boolean = false;
let priestessFeatureActive: boolean = false;
let deathFeatureActive: boolean = false;

// UI Elements
const spinBtn = document.getElementById('spin-btn') as HTMLButtonElement;
const balanceDisplay = document.getElementById('balance-display') as HTMLElement;
const winDisplay = document.getElementById('win-display') as HTMLElement;
const winPanel = document.getElementById('win-panel') as HTMLElement;
const betMinusBtn = document.getElementById('bet-minus') as HTMLButtonElement;
const betPlusBtn = document.getElementById('bet-plus') as HTMLButtonElement;
const betDisplay = document.getElementById('bet-display') as HTMLElement;

// Bet steps
const BET_STEPS = [0.20, 0.40, 0.80, 1, 1.20, 1.60, 2, 2.50, 5, 10, 15, 20, 50, 100];
let currentBetIndex = 0; // starts at 0.20

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

    // Enable zIndex sorting on stage
    app.stage.sortableChildren = true;

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

    // Loading screen elements
    const loadingBar = document.getElementById('loading-bar') as HTMLElement;
    const loadingScreen = document.getElementById('loading-screen') as HTMLElement;

    // ── Loading progress: track max so bar only moves forward ──
    let currentBarPercent = 0;
    const setBarProgress = (percent: number) => {
      if (percent > currentBarPercent) {
        currentBarPercent = percent;
        loadingBar.style.width = `${Math.round(percent)}%`;
      }
    };

    // ── Start Three.js 3D model loading EARLY (in parallel with texture loading) ──
    if (DEBUG.BG_ENABLED) {
      const threeCanvas = document.getElementById('three-canvas') as HTMLCanvasElement;
      if (threeCanvas) {
        threeBg = new ThreeBackground({
          canvas: threeCanvas,
          modelPath: '/assets/3d/free_game_character_-the_ancient_woman_titan.glb',
          animate: DEBUG.BG_ANIMATE_CAMERA,
        });
        console.log('✅ Three.js 3D background initialized (models loading in parallel)');

        // Track 3D model loading progress (40%–100% of loading bar)
        threeBg.onModelProgress = (progress) => {
          setBarProgress(40 + progress * 60);
        };
      }
    }

    // Load PixiJS assets with progress (textures = first 40%)
    assetLoader = new AssetLoader();
    await assetLoader.load((progress) => {
      setBarProgress(progress * 40);
    });

    console.log('✅ Assets loaded');

    // Initialize game controller
    const initialSeed = 12345;
    gameController = new GameController(assetLoader, initialSeed);

    console.log('🎮 Creating grid view...');

    // Create grid view
    gridView = new GridView(assetLoader);
    gridView.position.set(105, 105);
    gridView.zIndex = 10;
    app.stage.addChild(gridView);

    console.log('✅ Grid view added to stage');

    // Create payline overlay (zIndex > frame's 100 so it renders in front)
    paylineOverlay = new PaylineOverlay();
    paylineOverlay.position.set(105, 105);
    paylineOverlay.zIndex = 150;
    app.stage.addChild(paylineOverlay);

    console.log('✅ Payline overlay added');

    // Show placeholder
    gridView.showPlaceholder();

    console.log('✅ Placeholder shown');

    updateUI();

    // Enable spin button
    spinBtn.disabled = false;
    spinBtn.addEventListener('click', handleSpin);

    // Space bar triggers spin or skips win count-up
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        // If win display is counting up, skip to final value
        if (activeWinDisplay) {
          activeWinDisplay.requestSkip();
          return;
        }
        handleSpin();
      }
    });

    // Bet +/- buttons
    betMinusBtn.addEventListener('click', () => changeBet(-1));
    betPlusBtn.addEventListener('click', () => changeBet(1));
    updateBetUI();

    // ── Debug menu (toggle with ` key) ──
    new DebugMenu();

    console.log('✅ Game ready! Canvas size:', app.canvas.width, 'x', app.canvas.height);
    
    app.ticker.add((ticker) => {
      gridView.update(ticker.deltaTime);
    });

    // ── Preload all sounds via SoundManager (in parallel with 3D model wait) ──
    ReelSpinner.loadLandSound();
    const soundsReady = soundManager.preloadAll();

    // ── Background music starts on first user interaction ──
    const startBgMusic = () => {
      if (soundManager.isBgMusicStarted) return;
      soundManager.startBgMusic(0.35);
    };
    window.addEventListener('click', startBgMusic);
    window.addEventListener('keydown', startBgMusic);

    // ── Wait for main 3D model AND sounds before dismissing loading screen ──
    await soundsReady; // sounds in parallel with model loading
    if (threeBg) {
      await threeBg.mainModelReady;
      loadingBar.style.width = '100%';
      console.log('✅ Main 3D model loaded — feature models loading in background');

      // Death debug mode: activate Death visual state persistently
      if (DEBUG.DEATH_MODE) {
        threeBg.setFeatureColor('T_DEATH');
        threeBg.swapToDeath().then(() => {
          console.log('💀 DEBUG: Death mode visuals activated (3D model + color tint)');
        });
      }
    }

    // ── Hide loading screen with fade-out ──
    loadingScreen.classList.add('hidden');
    setTimeout(() => loadingScreen.remove(), 600);
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
let featureSoundPlayed: boolean = false; // Prevent double-fire of feature trigger sound
let foolFeatureActive: boolean = false; // Track if Fool feature is currently running
let cupsFeatureActive: boolean = false; // Track if Cups feature is currently running
let loversFeatureActive: boolean = false; // Track if Lovers feature is currently running
let currentCupsAnimation: CupsRevealAnimation | null = null; // Reference to active Cups animation
let activeWinDisplay: import('./game/render/WinDisplay').WinDisplay | null = null; // Track active win display for skip
let currentPriestessAnimation: PriestessRevealAnimation | null = null; // Reference to active Priestess animation
let currentDeathAnimation: DeathRevealAnimation | null = null; // Reference to active Death animation
let threeBg: ThreeBackground | null = null;

/** Wraps a feature animation with 3D model swap, color tinting, and column restore. */
async function runFeature(
  featureType: string,
  swapIn: () => Promise<void>,
  swapOut: () => Promise<void>,
  body: () => Promise<void>,
  options?: { skipRestore?: boolean }
): Promise<void> {
  threeBg?.setFeatureColor(featureType);
  soundManager.play('model-spawn', 0.6);
  await swapIn();
  await body();
  if (!options?.skipRestore) {
    threeBg?.clearFeatureColor();
    soundManager.play('model-despawn', 0.6);
    await swapOut();
    gridView.restoreAllColumnsVisible();
  }
}

function resetState() {
  currentState = SpinState.IDLE;
  canSkip = false;
  spinBtn.disabled = false;
  
  if (skipEnableTimer) { clearTimeout(skipEnableTimer); skipEnableTimer = null; }
  if (safetyTimeout) { clearTimeout(safetyTimeout); safetyTimeout = null; }
}

async function handleSpin() {
  // ── FOOL FEATURE ACTIVE: Block all spin input ──
  if (foolFeatureActive) return;

  // ── LOVERS FEATURE ACTIVE: Block all spin input ──
  if (loversFeatureActive) return;

  // ── DEATH FEATURE ACTIVE: Hurry up reel spin ──
  if (deathFeatureActive && currentDeathAnimation) {
    if (currentDeathAnimation.isReelSpinActive()) {
      console.log('⚡ Hurrying up Death reel spin');
      currentDeathAnimation.requestHurryUp();
    }
    return;
  }

  // ── PRIESTESS FEATURE ACTIVE: Hurry up reel spin ──
  if (priestessFeatureActive && currentPriestessAnimation) {
    if (currentPriestessAnimation.isReelSpinActive()) {
      console.log('⚡ Hurrying up Priestess reel spin');
      currentPriestessAnimation.requestHurryUp();
    }
    return;
  }

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
  featureSoundPlayed = false; // Reset for this spin

  // Debug: Force feature if enabled (works every spin when toggled in debug menu)
  let spinOutput: SpinOutput;
  if (DEBUG.FORCE_CUPS) {
    console.log('🔧 DEBUG: Forcing Cups feature');
    spinOutput = gameController.forceTarotSpin('T_CUPS', DEBUG.CUPS_COLUMNS);
  } else if (DEBUG.FORCE_LOVERS) {
    console.log('🔧 DEBUG: Forcing Lovers feature');
    spinOutput = gameController.forceTarotSpin('T_LOVERS', DEBUG.LOVERS_COLUMNS);
  } else if (DEBUG.FORCE_PRIESTESS) {
    console.log('🔧 DEBUG: Forcing Priestess feature');
    spinOutput = gameController.forceTarotSpin('T_PRIESTESS', DEBUG.PRIESTESS_COLUMNS);
  } else if (DEBUG.FORCE_DEATH) {
    console.log('🔧 DEBUG: Forcing Death feature');
    spinOutput = gameController.forceTarotSpin('T_DEATH', DEBUG.DEATH_COLUMNS);
  } else if (DEBUG.FORCE_FOOL_BIG_WIN) {
    console.log('🔧 DEBUG: Forcing Fool BIG WIN feature');
    spinOutput = gameController.forceFoolBigWin(DEBUG.FOOL_BIG_WIN_COLUMNS);
  } else if (DEBUG.FORCE_FOOL) {
    console.log('🔧 DEBUG: Forcing Fool feature');
    spinOutput = gameController.forceTarotSpin('T_FOOL', DEBUG.FOOL_COLUMNS);
  } else {
    spinOutput = gameController.spin();
  }
  hasSpunOnce = true;
  currentSpinData = spinOutput;

  // After 0.25s, unlock button for hurry-up (but not during features or title card)
  skipEnableTimer = setTimeout(() => {
    if (currentState === SpinState.SPINNING && !foolFeatureActive && !loversFeatureActive && !cupsFeatureActive && !priestessFeatureActive && !deathFeatureActive) {
      canSkip = true;
      spinBtn.disabled = false;
    }
  }, 250);
  
  safetyTimeout = setTimeout(() => resetState(), SAFETY_TIMEOUT_MS);

  try {
    // ── Phase 1: Spin & land the INITIAL grid (cardbacks shown for tarot columns) ──
    // Set up tarot land sound callback before spinning
    const tarotColSet = new Set(spinOutput.tarotColumns.map(tc => tc.col));
    gridView.setOnReelLand((col: number) => {
      if (tarotColSet.has(col)) {
        soundManager.play('tarot-land', 0.5);
      }
    });
    await gridView.spinToGrid(spinOutput.initialGrid, spinOutput.tarotColumns);
    gridView.setOnReelLand(null); // Clear callback after spin completes

    // ── Phase 1.5: Flip cardbacks to reveal tarot faces ──
    if (spinOutput.tarotColumns.length > 0) {
      canSkip = false; // Disable hurry-up during reveal
      spinBtn.disabled = true; // Lock button during reveal sequence
      await wait(400); // Suspense pause — player sees cardbacks
      soundManager.play('tarot-flip', 0.5);
      await gridView.flipTarotColumns(spinOutput.tarotColumns);
      await wait(300); // Brief pause to admire revealed tarots

      // Play feature trigger sound once after tarot cards are revealed, before title card
      if (spinOutput.feature && !featureSoundPlayed) {
        featureSoundPlayed = true;
        switch (spinOutput.feature.type) {
          case 'T_FOOL':      soundManager.play('jester-trigger', 0.6); break;
          case 'T_CUPS':      soundManager.play('cups-trigger', 0.6); break;
          case 'T_LOVERS':
            soundManager.play('lovers-trigger', 0.6);
            soundManager.stopBgMusic(2.0).then(() => soundManager.startFeatureMusic('lovers-background', 0.35, 2.0));
            break;
          case 'T_PRIESTESS': soundManager.play('priestess-trigger', 0.6); break;
          case 'T_DEATH':     soundManager.play('death-trigger', 0.6); break;
        }
      }
    }

    // ── Phase 1.75: Show tarot title card if a feature triggered ──
    if (spinOutput.feature) {
      canSkip = false; // Disable hurry-up during title card
      spinBtn.disabled = true; // Lock button during title card
      const titleDisplay = new TarotTitleDisplay();
      const gridCenter = gridView.getGridScreenCenter(app.canvas as HTMLCanvasElement);
      await titleDisplay.show(spinOutput.feature.type, 400, 1000, 400, gridCenter);
    }

    if (spinOutput.feature && spinOutput.feature.type === 'T_FOOL' && spinOutput.foolResult) {
      foolFeatureActive = true;
      spinBtn.disabled = true;
      await runFeature('T_FOOL',
        () => threeBg?.swapToModel() ?? Promise.resolve(),
        () => threeBg?.restoreModel() ?? Promise.resolve(),
        async () => {
          const foolReveal = new FoolRevealAnimation(
            gridView, gridView.getReelSpinners(), assetLoader,
            gridView.getCellSize(), gridView.getPadding(),
            gridView.getCols(), gridView.getRows(),
            threeBg, app.canvas as HTMLCanvasElement,
          );
          await foolReveal.play(
            spinOutput.feature!, spinOutput.foolResult!,
            spinOutput.finalGrid, spinOutput.multiplier,
            spinOutput.wins, spinOutput.totalWin, gameController.betAmount
          );
        }
      );
      foolFeatureActive = false;
    }

    if (spinOutput.feature && spinOutput.feature.type === 'T_CUPS' && spinOutput.cupsResult) {
      spinBtn.disabled = false;
      cupsFeatureActive = true;
      let cupsPayout = 0;
      await runFeature('T_CUPS',
        () => threeBg?.swapToSol() ?? Promise.resolve(),
        () => threeBg?.restoreSol() ?? Promise.resolve(),
        async () => {
          const cupsReveal = new CupsRevealAnimation(
            gridView, gridView.getReelSpinners(), assetLoader,
            gridView.getCellSize(), gridView.getPadding(),
            gridView.getCols(), gridView.getRows(),
            gameController.getCurrentSeed(),
            threeBg, app.canvas as HTMLCanvasElement
          );
          currentCupsAnimation = cupsReveal;
          cupsPayout = await cupsReveal.play(
            spinOutput.feature!, spinOutput.cupsResult!, gameController.betAmount
          );
        }
      );
      cupsFeatureActive = false;
      currentCupsAnimation = null;
      gameController.balance += cupsPayout;
      gameController.lastWin = cupsPayout;
      currentSpinData.totalWin = cupsPayout;
    }

    if (spinOutput.feature && spinOutput.feature.type === 'T_PRIESTESS' && spinOutput.priestessResult) {
      spinBtn.disabled = false;
      priestessFeatureActive = true;
      let priestessPayout = 0;
      const priestessResult = spinOutput.priestessResult;
      await runFeature('T_PRIESTESS',
        () => threeBg?.swapToQueen() ?? Promise.resolve(),
        () => threeBg?.restoreQueen() ?? Promise.resolve(),
        async () => {
          const priestessReveal = new PriestessRevealAnimation(
            gridView, gridView.getReelSpinners(), assetLoader,
            gridView.getCellSize(), gridView.getPadding(),
            gridView.getCols(), gridView.getRows(),
            gridView, threeBg, app.canvas as HTMLCanvasElement,
          );
          currentPriestessAnimation = priestessReveal;
          priestessPayout = await priestessReveal.play(
            spinOutput.feature!, priestessResult,
            () => gameController.generateFreshGrid(),
            (grid, cells) => gameController.applyPriestessSpin(grid, priestessResult, cells),
            gameController.betAmount
          );
        }
      );
      priestessFeatureActive = false;
      currentPriestessAnimation = null;
      gameController.balance += priestessPayout;
      gameController.lastWin = priestessPayout;
      currentSpinData.totalWin = priestessPayout;
    }

    if (spinOutput.feature && spinOutput.feature.type === 'T_LOVERS' && spinOutput.loversResult) {
      spinBtn.disabled = true;
      loversFeatureActive = true;
      await runFeature('T_LOVERS',
        () => threeBg?.swapToLovers() ?? Promise.resolve(),
        () => threeBg?.restoreLovers() ?? Promise.resolve(),
        async () => {
          const loversReveal = new LoversRevealAnimation(
            gridView, gridView.getReelSpinners(), assetLoader,
            gridView.getCellSize(), gridView.getPadding(),
            gridView.getCols(), gridView.getRows(),
            gridView, threeBg, app.canvas as HTMLCanvasElement,
          );
          const feature = spinOutput.feature!;
          const loversResult = spinOutput.loversResult!;
          let finalGrid = spinOutput.finalGrid;
          await loversReveal.play(feature, loversResult,
            (selectedIndex: number) => {
              const result = gameController.applyLoversSelection(
                finalGrid, feature, loversResult, selectedIndex
              );
              finalGrid = result.finalGrid;
              currentSpinData!.finalGrid = result.finalGrid;
              currentSpinData!.wins = result.wins;
              currentSpinData!.totalWin = result.totalWin;
              currentSpinData!.multiplier = result.multiplier;
              return result;
            },
            () => { finalGrid = gameController.generateFreshGrid(); return finalGrid; },
            gameController.betAmount
          );
          loversFeatureActive = false;
          await soundManager.stopFeatureMusic(2.0);
          soundManager.restartBgMusic(0.35, 2.0);
        }
      );
    }

    if (spinOutput.feature && spinOutput.feature.type === 'T_DEATH' && spinOutput.deathResult) {
      spinBtn.disabled = false;
      deathFeatureActive = true;
      let deathPayout = 0;
      const deathResult = spinOutput.deathResult;
      await runFeature('T_DEATH',
        () => threeBg?.swapToDeath() ?? Promise.resolve(),
        () => threeBg?.restoreDeath() ?? Promise.resolve(),
        async () => {
          const deathReveal = new DeathRevealAnimation(
            gridView, gridView.getReelSpinners(), assetLoader,
            gridView.getCellSize(), gridView.getPadding(),
            gridView.getCols(), gridView.getRows(),
            gridView, threeBg, app.canvas as HTMLCanvasElement,
          );
          currentDeathAnimation = deathReveal;
          deathPayout = await deathReveal.play(
            spinOutput.feature!, deathResult,
            (cols, rows, stickyWilds) => gameController.generateDeathGrid(cols, rows, stickyWilds),
            (grid, dr) => gameController.applyDeathSpin(grid, dr),
            gameController.betAmount
          );
        },
        { skipRestore: DEBUG.DEATH_MODE }
      );
      deathFeatureActive = false;
      currentDeathAnimation = null;
      gridView.restoreDefaultGrid();
      gridView.restoreAllColumnsVisible();
      gameController.balance += deathPayout;
      gameController.lastWin = deathPayout;
      currentSpinData.totalWin = deathPayout;
    }

    // ── Phase 2.9: Highlight winning symbols, then show win display ──
    // Only for non-feature spins and Fool (which doesn't show its own win display).
    // Cups, Priestess, Death, and Lovers handle wins internally — skip to avoid double display.
    const featureType = spinOutput.feature?.type;
    const skipWinDisplay = featureType === 'T_CUPS' || featureType === 'T_PRIESTESS' || featureType === 'T_DEATH' || featureType === 'T_LOVERS';

    if (currentSpinData && currentSpinData.wins.length > 0 && !skipWinDisplay) {
      // First: radiate outlines on winning symbols
      soundManager.play('payline-win', 0.4);
      paylineOverlay.showWinningPaylines(currentSpinData.wins, gridView.getReelSpinners());
      await wait(1000); // Let the radiating outline animation play fully

      // Clear outlines before showing win display (so they don't overlap the dim screen)
      paylineOverlay.clear();

      const { width: tw, height: th } = gridView.getGridDimensions();
      const { WinDisplay } = await import('./game/render/WinDisplay');
      const winDisplayInstance = new WinDisplay(gridView);
      activeWinDisplay = winDisplayInstance;
      await winDisplayInstance.show(
        currentSpinData.wins,
        currentSpinData.multiplier,
        currentSpinData.totalWin,
        gameController.betAmount,
        tw,
        th
      );
      activeWinDisplay = null;
    }

    // ── Phase 3: Show results ──
    await showResults();
  } catch (error) {
    console.error('❌ Spin error:', error);
    // Ensure reels are visible on error too
    for (let col = 0; col < gridView.getCols(); col++) {
      gridView.getReelSpinners()[col].setColumnVisible(true);
    }
  }
  resetState();
  spinBtn.disabled = false;
}

async function showResults() {
  if (!currentSpinData) return;

  // Payline highlighting is already shown in Phase 2.9 before payout
  
  updateUI();
  
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

function changeBet(direction: number): void {
  // Don't allow bet changes during a spin or feature
  if (currentState !== SpinState.IDLE || foolFeatureActive || cupsFeatureActive || loversFeatureActive || priestessFeatureActive || deathFeatureActive) return;

  const newIndex = currentBetIndex + direction;
  if (newIndex < 0 || newIndex >= BET_STEPS.length) return;

  currentBetIndex = newIndex;
  gameController.betAmount = BET_STEPS[currentBetIndex];
  updateBetUI();
}

function updateBetUI(): void {
  const bet = BET_STEPS[currentBetIndex];
  betDisplay.textContent = bet.toFixed(2) + ' €';
  betMinusBtn.disabled = currentBetIndex === 0;
  betPlusBtn.disabled = currentBetIndex === BET_STEPS.length - 1;
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

// Start the game
init().catch(console.error);
