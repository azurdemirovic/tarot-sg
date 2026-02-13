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

    // Bet +/- buttons
    betMinusBtn.addEventListener('click', () => changeBet(-1));
    betPlusBtn.addEventListener('click', () => changeBet(1));
    updateBetUI();

    console.log('✅ Game ready! Canvas size:', app.canvas.width, 'x', app.canvas.height);
    
    app.ticker.add((ticker) => {
      gridView.update(ticker.deltaTime);
    });

    // ── Load reel landing sound ──
    ReelSpinner.loadLandSound();

    // ── Preload sound effects ──
    preloadSoundEffects();

    // ── Background music (gapless loop via Web Audio API, starts on first user interaction) ──
    const startBgMusic = async () => {
      if (bgMusicStarted) return;
      bgMusicStarted = true; // prevent multiple attempts

      try {
        bgMusicContext = new AudioContext();
        const response = await fetch('/assets/sound/bg-music.wav');
        const arrayBuffer = await response.arrayBuffer();
        bgMusicBuffer = await bgMusicContext.decodeAudioData(arrayBuffer);

        bgMusicGain = bgMusicContext.createGain();
        bgMusicGain.gain.value = 0.35;
        bgMusicGain.connect(bgMusicContext.destination);

        bgMusicSource = bgMusicContext.createBufferSource();
        bgMusicSource.buffer = bgMusicBuffer;
        bgMusicSource.loop = true;
        bgMusicSource.connect(bgMusicGain);
        bgMusicSource.start(0);
        console.log('🎵 Background music started (Web Audio API, gapless loop)');
      } catch (e) {
        bgMusicStarted = false; // allow retry on next interaction
        console.warn('🎵 Could not start background music, will retry:', e);
      }
    };

    // Start music on any user interaction
    window.addEventListener('click', startBgMusic);
    window.addEventListener('keydown', startBgMusic);

    // ── Initialize Three.js 3D background ──
    if (DEBUG.BG_ENABLED) {
      const threeCanvas = document.getElementById('three-canvas') as HTMLCanvasElement;
      if (threeCanvas) {
        threeBg = new ThreeBackground({
          canvas: threeCanvas,
          modelPath: '/assets/3d/free_game_character_-the_ancient_woman_titan.glb',
          animate: DEBUG.BG_ANIMATE_CAMERA,
        });
        console.log('✅ Three.js 3D background initialized');

        // Death debug mode: activate Death visual state persistently
        if (DEBUG.DEATH_MODE) {
          threeBg.setFeatureColor('T_DEATH');
          threeBg.swapToDeath().then(() => {
            console.log('💀 DEBUG: Death mode visuals activated (3D model + color tint)');
          });
        }
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
let featureSoundPlayed: boolean = false; // Prevent double-fire of feature trigger sound
let foolFeatureActive: boolean = false; // Track if Fool feature is currently running
let cupsFeatureActive: boolean = false; // Track if Cups feature is currently running
let loversFeatureActive: boolean = false; // Track if Lovers feature is currently running
let currentCupsAnimation: CupsRevealAnimation | null = null; // Reference to active Cups animation
let currentPriestessAnimation: PriestessRevealAnimation | null = null; // Reference to active Priestess animation
let currentDeathAnimation: DeathRevealAnimation | null = null; // Reference to active Death animation
let threeBg: ThreeBackground | null = null; // Reference to 3D background
let bgMusicContext: AudioContext | null = null; // Web Audio API for gapless looping
let bgMusicStarted = false;
let bgMusicSource: AudioBufferSourceNode | null = null;
let bgMusicGain: GainNode | null = null;
let bgMusicBuffer: AudioBuffer | null = null; // Store buffer for restart after pause

// ── Preloaded sound effects ──
let sfxContext: AudioContext | null = null;
let jesterTriggerBuffer: AudioBuffer | null = null;
let cupsTriggerBuffer: AudioBuffer | null = null;
let loversTriggerBuffer: AudioBuffer | null = null;
let priestessTriggerBuffer: AudioBuffer | null = null;
let deathTriggerBuffer: AudioBuffer | null = null;
let modelSpawnBuffer: AudioBuffer | null = null;
let modelDespawnBuffer: AudioBuffer | null = null;
let loversBackgroundBuffer: AudioBuffer | null = null;
let loversBackgroundSource: AudioBufferSourceNode | null = null;
let loversBackgroundGain: GainNode | null = null;
let deathSlashBuffer: AudioBuffer | null = null;
let symbolGlowBuffer: AudioBuffer | null = null;

async function loadSfxBuffer(url: string): Promise<AudioBuffer | null> {
  try {
    const resp = await fetch(url);
    const arrayBuffer = await resp.arrayBuffer();
    return await sfxContext!.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.warn(`🔊 Could not load sound: ${url}`, e);
    return null;
  }
}

async function preloadSoundEffects(): Promise<void> {
  try {
    sfxContext = new AudioContext();
    // Feature trigger sounds
    jesterTriggerBuffer = await loadSfxBuffer('/assets/sound/jester-trigger.wav');
    cupsTriggerBuffer = await loadSfxBuffer('/assets/sound/cups_trigger.wav');
    loversTriggerBuffer = await loadSfxBuffer('/assets/sound/lovers_trigger.wav');
    priestessTriggerBuffer = await loadSfxBuffer('/assets/sound/priestess_trigger.wav');
    deathTriggerBuffer = await loadSfxBuffer('/assets/sound/death_trigger.wav');
    // Model spawn/despawn sounds (shared across all features)
    modelSpawnBuffer = await loadSfxBuffer('/assets/sound/model_spawn.wav');
    modelDespawnBuffer = await loadSfxBuffer('/assets/sound/model_despawn.wav');
    // Feature-specific background music
    loversBackgroundBuffer = await loadSfxBuffer('/assets/sound/lovers_background.wav');
    // Placeholder sounds
    deathSlashBuffer = await loadSfxBuffer('/assets/sound/death-slash.wav');
    symbolGlowBuffer = await loadSfxBuffer('/assets/sound/symbol-glow.wav');
    console.log('🔊 Sound effects preloaded');
  } catch (e) {
    console.warn('🔊 Could not preload sound effects:', e);
  }
}

function playSfx(buffer: AudioBuffer | null, volume: number = 0.6): void {
  if (!sfxContext || !buffer) return;
  if (sfxContext.state === 'suspended') sfxContext.resume();
  const src = sfxContext.createBufferSource();
  src.buffer = buffer;
  const gain = sfxContext.createGain();
  gain.gain.value = volume;
  src.connect(gain);
  gain.connect(sfxContext.destination);
  src.start(0);
}

/** Stop default background music (for feature-specific BG music swap) */
function stopBgMusic(): void {
  if (bgMusicSource) {
    try { bgMusicSource.stop(); } catch (_) { /* already stopped */ }
    bgMusicSource = null;
  }
  console.log('🎵 Default background music stopped');
}

/** Restart default background music after a feature ends */
function restartBgMusic(): void {
  if (!bgMusicContext || !bgMusicBuffer || !bgMusicGain) return;
  bgMusicSource = bgMusicContext.createBufferSource();
  bgMusicSource.buffer = bgMusicBuffer;
  bgMusicSource.loop = true;
  bgMusicSource.connect(bgMusicGain);
  bgMusicSource.start(0);
  console.log('🎵 Default background music restarted');
}

/** Start Lovers background music (looping) */
function startLoversBackground(): void {
  if (!sfxContext || !loversBackgroundBuffer) return;
  loversBackgroundGain = sfxContext.createGain();
  loversBackgroundGain.gain.value = 0.35;
  loversBackgroundGain.connect(sfxContext.destination);
  loversBackgroundSource = sfxContext.createBufferSource();
  loversBackgroundSource.buffer = loversBackgroundBuffer;
  loversBackgroundSource.loop = true;
  loversBackgroundSource.connect(loversBackgroundGain);
  loversBackgroundSource.start(0);
  console.log('🎵 Lovers background music started');
}

/** Stop Lovers background music */
function stopLoversBackground(): void {
  if (loversBackgroundSource) {
    try { loversBackgroundSource.stop(); } catch (_) { /* already stopped */ }
    loversBackgroundSource = null;
    loversBackgroundGain = null;
  }
  console.log('🎵 Lovers background music stopped');
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

  // Debug: Force feature if enabled (only on first spin)
  let spinOutput: SpinOutput;
  if (!hasSpunOnce && DEBUG.FORCE_CUPS) {
    console.log('🔧 DEBUG: Forcing Cups feature (first spin only)');
    hasSpunOnce = true;
    spinOutput = gameController.forceTarotSpin('T_CUPS', DEBUG.CUPS_COLUMNS);
  } else if (!hasSpunOnce && DEBUG.FORCE_LOVERS) {
    console.log('🔧 DEBUG: Forcing Lovers feature (first spin only)');
    hasSpunOnce = true;
    spinOutput = gameController.forceTarotSpin('T_LOVERS', DEBUG.LOVERS_COLUMNS);
  } else if (!hasSpunOnce && DEBUG.FORCE_PRIESTESS) {
    console.log('🔧 DEBUG: Forcing Priestess feature (first spin only)');
    hasSpunOnce = true;
    spinOutput = gameController.forceTarotSpin('T_PRIESTESS', DEBUG.PRIESTESS_COLUMNS);
  } else if (!hasSpunOnce && DEBUG.FORCE_DEATH) {
    console.log('🔧 DEBUG: Forcing Death feature (first spin only)');
    hasSpunOnce = true;
    spinOutput = gameController.forceTarotSpin('T_DEATH', DEBUG.DEATH_COLUMNS);
  } else if (!hasSpunOnce && DEBUG.FORCE_FOOL) {
    console.log('🔧 DEBUG: Forcing Fool feature (first spin only)');
    hasSpunOnce = true;
    spinOutput = gameController.forceTarotSpin('T_FOOL', DEBUG.FOOL_COLUMNS);
  } else {
    spinOutput = gameController.spin();
    hasSpunOnce = true;
  }
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
    await gridView.spinToGrid(spinOutput.initialGrid, spinOutput.tarotColumns);

    // ── Phase 1.5: Flip cardbacks to reveal tarot faces ──
    if (spinOutput.tarotColumns.length > 0) {
      canSkip = false; // Disable hurry-up during reveal
      spinBtn.disabled = true; // Lock button during reveal sequence
      await delay(400); // Suspense pause — player sees cardbacks
      await gridView.flipTarotColumns(spinOutput.tarotColumns);
      await delay(300); // Brief pause to admire revealed tarots

      // Play feature trigger sound once after tarot cards are revealed, before title card
      if (spinOutput.feature && !featureSoundPlayed) {
        featureSoundPlayed = true;
        switch (spinOutput.feature.type) {
          case 'T_FOOL':      playSfx(jesterTriggerBuffer, 0.6); break;
          case 'T_CUPS':      playSfx(cupsTriggerBuffer, 0.6); break;
          case 'T_LOVERS':
            playSfx(loversTriggerBuffer, 0.6);
            stopBgMusic();
            startLoversBackground();
            break;
          case 'T_PRIESTESS': playSfx(priestessTriggerBuffer, 0.6); break;
          case 'T_DEATH':     playSfx(deathTriggerBuffer, 0.6); break;
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

    // ── Phase 2: If a Fool feature triggered, play the reveal animation ──
    if (spinOutput.feature && spinOutput.feature.type === 'T_FOOL' && spinOutput.foolResult) {
      foolFeatureActive = true;
      spinBtn.disabled = true; // Lock button during reveal
      threeBg?.setFeatureColor('T_FOOL');

      // Swap 3D model to nightmare jester
      playSfx(modelSpawnBuffer, 0.6);
      await threeBg?.swapToModel();

      const foolReveal = new FoolRevealAnimation(
        gridView,
        gridView.getReelSpinners(),
        assetLoader,
        gridView.getCellSize(),
        gridView.getPadding(),
        gridView.getCols(),
        gridView.getRows(),
        threeBg,
        app.canvas as HTMLCanvasElement,
        playSfx,
        symbolGlowBuffer
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

      foolFeatureActive = false;
      threeBg?.clearFeatureColor();
      playSfx(modelDespawnBuffer, 0.6);
      await threeBg?.restoreModel();
    }

    // ── Phase 2b: If a Cups feature triggered, play the multiplier collection animation ──
    if (spinOutput.feature && spinOutput.feature.type === 'T_CUPS' && spinOutput.cupsResult) {
      spinBtn.disabled = false; // Allow clicking to speed up Cups spins
      cupsFeatureActive = true; // Mark Cups as active
      threeBg?.setFeatureColor('T_CUPS');

      // Swap 3D model to sol (drops in from above)
      playSfx(modelSpawnBuffer, 0.6);
      await threeBg?.swapToSol();

      const cupsReveal = new CupsRevealAnimation(
        gridView,
        gridView.getReelSpinners(),
        assetLoader,
        gridView.getCellSize(),
        gridView.getPadding(),
        gridView.getCols(),
        gridView.getRows(),
        gameController.getCurrentSeed(),
        threeBg,
        app.canvas as HTMLCanvasElement
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
      threeBg?.clearFeatureColor();
      playSfx(modelDespawnBuffer, 0.6);
      await threeBg?.restoreSol();

      // Restore all reel columns to visible
      for (let col = 0; col < gridView.getCols(); col++) {
        gridView.getReelSpinners()[col].setColumnVisible(true);
      }

      // Update balance with Cups payout
      gameController.balance += cupsPayout;
      gameController.lastWin = cupsPayout;
      currentSpinData.totalWin = cupsPayout;
    }

    // ── Phase 2c: If a Priestess feature triggered, play the mystery reveal ──
    if (spinOutput.feature && spinOutput.feature.type === 'T_PRIESTESS' && spinOutput.priestessResult) {
      spinBtn.disabled = false; // Allow spin button for hurry-up during reel spins
      priestessFeatureActive = true;
      threeBg?.setFeatureColor('T_PRIESTESS');

      // Swap 3D model to queen of swords (scales up)
      playSfx(modelSpawnBuffer, 0.6);
      await threeBg?.swapToQueen();

      const priestessReveal = new PriestessRevealAnimation(
        gridView,
        gridView.getReelSpinners(),
        assetLoader,
        gridView.getCellSize(),
        gridView.getPadding(),
        gridView.getCols(),
        gridView.getRows(),
        gridView,
        threeBg,
        app.canvas as HTMLCanvasElement,
        playSfx,
        symbolGlowBuffer
      );

      currentPriestessAnimation = priestessReveal; // Store reference for hurry-up

      const priestessResult = spinOutput.priestessResult;

      const priestessPayout = await priestessReveal.play(
        spinOutput.feature,
        priestessResult,
        () => {
          return gameController.generateFreshGrid();
        },
        (grid, existingMysteryCells) => {
          return gameController.applyPriestessSpin(grid, priestessResult, existingMysteryCells);
        },
        gameController.betAmount
      );

      priestessFeatureActive = false;
      currentPriestessAnimation = null;
      threeBg?.clearFeatureColor();
      playSfx(modelDespawnBuffer, 0.6);
      await threeBg?.restoreQueen();

      // Restore all reel columns to visible
      for (let col = 0; col < gridView.getCols(); col++) {
        gridView.getReelSpinners()[col].setColumnVisible(true);
      }

      // Apply total payout to balance at the end (per-spin was notification only)
      gameController.balance += priestessPayout;
      gameController.lastWin = priestessPayout;
      currentSpinData.totalWin = priestessPayout;
    }

    // ── Phase 2d: If a Lovers feature triggered, play the reveal animation ──
    if (spinOutput.feature && spinOutput.feature.type === 'T_LOVERS' && spinOutput.loversResult) {
      spinBtn.disabled = true;
      loversFeatureActive = true;
      threeBg?.setFeatureColor('T_LOVERS');
      playSfx(modelSpawnBuffer, 0.6);
      await threeBg?.swapToLovers();

      const loversReveal = new LoversRevealAnimation(
        gridView,
        gridView.getReelSpinners(),
        assetLoader,
        gridView.getCellSize(),
        gridView.getPadding(),
        gridView.getCols(),
        gridView.getRows(),
        gridView,
        threeBg,
        app.canvas as HTMLCanvasElement
      );

      const feature = spinOutput.feature;
      const loversResult = spinOutput.loversResult;
      let finalGrid = spinOutput.finalGrid;

      await loversReveal.play(
        feature,
        loversResult,
        (selectedIndex: number) => {
          // Player picked a card — apply the bond fill to the current fresh grid
          const result = gameController.applyLoversSelection(
            finalGrid, feature, loversResult, selectedIndex
          );
          // Update spinOutput with the new results
          finalGrid = result.finalGrid;
          currentSpinData!.finalGrid = result.finalGrid;
          currentSpinData!.wins = result.wins;
          currentSpinData!.totalWin = result.totalWin;
          currentSpinData!.multiplier = result.multiplier;
          return result;
        },
        () => {
          // Generate a fresh grid for each Lovers spin
          finalGrid = gameController.generateFreshGrid();
          return finalGrid;
        },
        gameController.betAmount
      );
      loversFeatureActive = false;
      stopLoversBackground();
      restartBgMusic();
      threeBg?.clearFeatureColor();
      playSfx(modelDespawnBuffer, 0.6);
      await threeBg?.restoreLovers();

      // Restore all reel columns to visible after Lovers
      for (let col = 0; col < gridView.getCols(); col++) {
        gridView.getReelSpinners()[col].setColumnVisible(true);
      }
    }

    // ── Phase 2e: If a Death feature triggered, play the reaping animation ──
    if (spinOutput.feature && spinOutput.feature.type === 'T_DEATH' && spinOutput.deathResult) {
      spinBtn.disabled = false; // Allow spin button for hurry-up during reel spins
      deathFeatureActive = true;
      threeBg?.setFeatureColor('T_DEATH');

      // Bring in the Death 3D model
      playSfx(modelSpawnBuffer, 0.6);
      await threeBg?.swapToDeath();

      const deathReveal = new DeathRevealAnimation(
        gridView,
        gridView.getReelSpinners(),
        assetLoader,
        gridView.getCellSize(),
        gridView.getPadding(),
        gridView.getCols(),
        gridView.getRows(),
        gridView,
        threeBg,
        app.canvas as HTMLCanvasElement,
        playSfx,
        deathSlashBuffer,
      );

      currentDeathAnimation = deathReveal;

      const deathResult = spinOutput.deathResult;

      const deathPayout = await deathReveal.play(
        spinOutput.feature,
        deathResult,
        (cols, rows, stickyWilds) => {
          return gameController.generateDeathGrid(cols, rows, stickyWilds);
        },
        (grid, dr) => {
          return gameController.applyDeathSpin(grid, dr);
        },
        gameController.betAmount
      );

      deathFeatureActive = false;
      currentDeathAnimation = null;

      // In Death debug mode, keep the visual state (3D model + color tint) active
      if (!DEBUG.DEATH_MODE) {
        threeBg?.clearFeatureColor();
        playSfx(modelDespawnBuffer, 0.6);
        await threeBg?.restoreDeath();
      }

      // Restore grid to default 5×3 layout
      gridView.restoreDefaultGrid();

      // Restore all reel columns to visible
      for (let col = 0; col < gridView.getCols(); col++) {
        gridView.getReelSpinners()[col].setColumnVisible(true);
      }

      // Apply total payout to balance
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
      paylineOverlay.showWinningPaylines(currentSpinData.wins, gridView.getReelSpinners());
      await delay(1000); // Let the radiating outline animation play fully

      // Clear outlines before showing win display (so they don't overlap the dim screen)
      paylineOverlay.clear();

      // Then: show big win display with headline (FATE BREAKER, etc.)
      const totalWidth = gridView.getCols() * (gridView.getCellSize() + gridView.getPadding()) - gridView.getPadding();
      const totalHeight = gridView.getRows() * (gridView.getCellSize() + gridView.getPadding()) - gridView.getPadding();
      const { WinDisplay } = await import('./game/render/WinDisplay');
      const winDisplay = new WinDisplay(gridView);
      await winDisplay.show(
        currentSpinData.wins,
        currentSpinData.multiplier,
        currentSpinData.totalWin,
        gameController.betAmount,
        totalWidth,
        totalHeight
      );
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the game
init().catch(console.error);
