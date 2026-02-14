/**
 * Centralized sound manager for all game audio.
 * Handles background music, sound effects, and per-feature background tracks.
 * All audio goes through a single AudioContext to avoid browser limitations.
 */

export class SoundManager {
  private context: AudioContext | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();

  private bgMusicSource: AudioBufferSourceNode | null = null;
  private bgMusicGain: GainNode | null = null;
  private bgMusicStarted = false;

  private featureBgSource: AudioBufferSourceNode | null = null;
  private featureBgGain: GainNode | null = null;

  /** Sound effect paths — loaded during init */
  private static readonly SFX_PATHS: Record<string, string> = {
    'bg-music':          '/assets/sound/bg-music.wav',
    'land-normal':       '/assets/sound/land-normal.wav',
    'jester-trigger':    '/assets/sound/jester-trigger.wav',
    'cups-trigger':      '/assets/sound/cups_trigger.wav',
    'lovers-trigger':    '/assets/sound/lovers_trigger.wav',
    'priestess-trigger': '/assets/sound/priestess_trigger.wav',
    'death-trigger':     '/assets/sound/death_trigger.wav',
    'model-spawn':       '/assets/sound/model_spawn.wav',
    'model-despawn':     '/assets/sound/model_despawn.wav',
    'lovers-background': '/assets/sound/lovers_background.wav',
    'death-slash':       '/assets/sound/death-slash.wav',
    'symbol-glow':       '/assets/sound/symbol-glow.wav',
    'tear-tarot':        '/assets/sound/tear-tarot.wav',
  };

  /** Initialize the audio context. Must be called after a user gesture. */
  async init(): Promise<void> {
    if (this.context) return;
    try {
      this.context = new AudioContext();
      console.log('🔊 SoundManager initialized');
    } catch (e) {
      console.warn('🔊 Could not create AudioContext:', e);
    }
  }

  /** Preload all sound effects. */
  async preloadAll(): Promise<void> {
    await this.init();
    if (!this.context) return;

    const promises = Object.entries(SoundManager.SFX_PATHS).map(
      ([key, path]) => this.loadBuffer(key, path)
    );
    await Promise.all(promises);
    console.log(`🔊 ${this.buffers.size} sounds preloaded`);
  }

  /** Load a single audio buffer by key and path. */
  private async loadBuffer(key: string, path: string): Promise<void> {
    if (!this.context) return;
    try {
      const resp = await fetch(path);
      const arrayBuffer = await resp.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
      this.buffers.set(key, audioBuffer);
    } catch (e) {
      console.warn(`🔊 Could not load sound: ${path}`, e);
    }
  }

  /** Get a preloaded audio buffer by key. */
  getBuffer(key: string): AudioBuffer | null {
    return this.buffers.get(key) ?? null;
  }

  /** Ensure context is resumed (browser autoplay policy). */
  private ensureResumed(): void {
    if (this.context?.state === 'suspended') {
      this.context.resume();
    }
  }

  /**
   * Play a one-shot sound effect.
   * @param key - Buffer key (e.g. 'death-slash')
   * @param volume - Gain value (0-1, default 0.6)
   */
  playSfx(key: string, volume: number = 0.6): void {
    if (!this.context) return;
    const buffer = this.buffers.get(key);
    if (!buffer) return;
    this.ensureResumed();

    const src = this.context.createBufferSource();
    src.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this.context.destination);
    src.start(0);
  }

  /**
   * Play a one-shot from a raw AudioBuffer (for compatibility with existing code).
   * @param buffer - AudioBuffer to play
   * @param volume - Gain value
   */
  playBuffer(buffer: AudioBuffer | null, volume: number = 0.6): void {
    if (!this.context || !buffer) return;
    this.ensureResumed();

    const src = this.context.createBufferSource();
    src.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this.context.destination);
    src.start(0);
  }

  /** Start background music (gapless loop). */
  startBgMusic(volume: number = 0.35): void {
    if (!this.context || this.bgMusicStarted) return;
    const buffer = this.buffers.get('bg-music');
    if (!buffer) return;

    this.bgMusicGain = this.context.createGain();
    this.bgMusicGain.gain.value = volume;
    this.bgMusicGain.connect(this.context.destination);

    this.bgMusicSource = this.context.createBufferSource();
    this.bgMusicSource.buffer = buffer;
    this.bgMusicSource.loop = true;
    this.bgMusicSource.connect(this.bgMusicGain);
    this.bgMusicSource.start(0);
    this.bgMusicStarted = true;
    console.log('🎵 Background music started');
  }

  /** Stop background music. */
  stopBgMusic(): void {
    if (this.bgMusicSource) {
      try { this.bgMusicSource.stop(); } catch (_) { /* already stopped */ }
      this.bgMusicSource = null;
    }
    console.log('🎵 Background music stopped');
  }

  /** Restart background music after a feature ends. */
  restartBgMusic(): void {
    if (!this.context || !this.bgMusicGain) return;
    const buffer = this.buffers.get('bg-music');
    if (!buffer) return;

    this.bgMusicSource = this.context.createBufferSource();
    this.bgMusicSource.buffer = buffer;
    this.bgMusicSource.loop = true;
    this.bgMusicSource.connect(this.bgMusicGain);
    this.bgMusicSource.start(0);
    console.log('🎵 Background music restarted');
  }

  /** Start a looping feature background track (e.g. Lovers). */
  startFeatureBg(key: string, volume: number = 0.35): void {
    if (!this.context) return;
    const buffer = this.buffers.get(key);
    if (!buffer) return;

    this.featureBgGain = this.context.createGain();
    this.featureBgGain.gain.value = volume;
    this.featureBgGain.connect(this.context.destination);

    this.featureBgSource = this.context.createBufferSource();
    this.featureBgSource.buffer = buffer;
    this.featureBgSource.loop = true;
    this.featureBgSource.connect(this.featureBgGain);
    this.featureBgSource.start(0);
    console.log(`🎵 Feature background started: ${key}`);
  }

  /** Stop the current feature background track. */
  stopFeatureBg(): void {
    if (this.featureBgSource) {
      try { this.featureBgSource.stop(); } catch (_) { /* already stopped */ }
      this.featureBgSource = null;
      this.featureBgGain = null;
    }
    console.log('🎵 Feature background stopped');
  }

  /** Whether background music has been started at least once. */
  get isBgMusicStarted(): boolean {
    return this.bgMusicStarted;
  }

  /** Get the AudioContext (for ReelSpinner land sound compatibility). */
  getContext(): AudioContext | null {
    return this.context;
  }
}

/** Global singleton instance. */
export const soundManager = new SoundManager();
