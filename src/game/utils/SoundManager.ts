/**
 * Centralized sound manager — single audio authority for the entire game.
 * Handles background music, feature music, one-shot SFX, looping SFX, and fading.
 */

export class SoundManager {
  private context: AudioContext | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();

  private bgSource: AudioBufferSourceNode | null = null;
  private bgGain: GainNode | null = null;
  private bgStarted = false;

  private featureSource: AudioBufferSourceNode | null = null;
  private featureGain: GainNode | null = null;

  private loopingSources: Map<string, { source: AudioBufferSourceNode; gain: GainNode }> = new Map();

  private static readonly SFX_PATHS: Record<string, string> = {
    'bg-music':           '/assets/sound/bg-music.wav',
    'land-normal':        '/assets/sound/land-normal.wav',
    'jester-trigger':     '/assets/sound/jester-trigger.wav',
    'cups-trigger':       '/assets/sound/cups_trigger.wav',
    'lovers-trigger':     '/assets/sound/lovers_trigger.wav',
    'priestess-trigger':  '/assets/sound/priestess_trigger.wav',
    'death-trigger':      '/assets/sound/death_trigger.wav',
    'model-spawn':        '/assets/sound/model_spawn.wav',
    'model-despawn':      '/assets/sound/model_despawn.wav',
    'lovers-background':  '/assets/sound/lovers_background.wav',
    'death-slash':        '/assets/sound/death-slash.wav',
    'symbol-glow':        '/assets/sound/symbol-glow.wav',
    'tear-tarot':         '/assets/sound/tear-tarot.wav',
    'tarot-flip':         '/assets/sound/tarot-flip.wav',
    'tarot-land':         '/assets/sound/tarot-land.wav',
    'payline-win':        '/assets/sound/payline-win.wav',
    'win-countup':        '/assets/sound/win-countup.wav',
    'anchor-move':        '/assets/sound/anchor-move.wav',
    'anticipation':       '/assets/sound/anticipation.wav',
  };

  async init(): Promise<void> {
    if (this.context) return;
    try {
      this.context = new AudioContext();
    } catch (e) {
      console.warn('Could not create AudioContext:', e);
    }
  }

  async preloadAll(): Promise<void> {
    await this.init();
    if (!this.context) return;
    const entries = Object.entries(SoundManager.SFX_PATHS);
    await Promise.all(entries.map(([key, path]) => this.loadBuffer(key, path)));
    console.log(`🔊 ${this.buffers.size} sounds preloaded`);
  }

  private async loadBuffer(key: string, path: string): Promise<void> {
    if (!this.context) return;
    try {
      const resp = await fetch(path);
      const ab = await resp.arrayBuffer();
      this.buffers.set(key, await this.context.decodeAudioData(ab));
    } catch (e) {
      console.warn(`Could not load sound: ${path}`, e);
    }
  }

  private ensureResumed(): void {
    if (this.context?.state === 'suspended') this.context.resume();
  }

  getContext(): AudioContext | null {
    return this.context;
  }

  getBuffer(key: string): AudioBuffer | null {
    return this.buffers.get(key) ?? null;
  }

  // ── One-shot SFX ──

  play(key: string, volume = 0.6): void {
    const buffer = this.buffers.get(key);
    if (!this.context || !buffer) return;
    this.ensureResumed();
    const src = this.context.createBufferSource();
    src.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.context.destination);
    src.start(0);
  }

  // ── Background Music ──

  startBgMusic(volume = 0.35, fadeIn = 0): void {
    if (!this.context || this.bgStarted) return;
    const buffer = this.buffers.get('bg-music');
    if (!buffer) return;

    this.bgGain = this.context.createGain();
    this.bgGain.gain.value = fadeIn > 0 ? 0 : volume;
    this.bgGain.connect(this.context.destination);

    this.bgSource = this.context.createBufferSource();
    this.bgSource.buffer = buffer;
    this.bgSource.loop = true;
    this.bgSource.connect(this.bgGain);
    this.bgSource.start(0);
    this.bgStarted = true;

    if (fadeIn > 0) {
      this.bgGain.gain.linearRampToValueAtTime(volume, this.context.currentTime + fadeIn);
    }
  }

  async stopBgMusic(fadeOut = 0): Promise<void> {
    if (!this.bgSource || !this.bgGain || !this.context) return;
    if (fadeOut > 0) {
      const now = this.context.currentTime;
      this.bgGain.gain.setValueAtTime(this.bgGain.gain.value, now);
      this.bgGain.gain.linearRampToValueAtTime(0, now + fadeOut);
      await this.waitMs(fadeOut * 1000 + 50);
    }
    try { this.bgSource.stop(); } catch (_) {}
    this.bgSource = null;
  }

  restartBgMusic(volume = 0.35, fadeIn = 0): void {
    if (!this.context || !this.bgGain) return;
    const buffer = this.buffers.get('bg-music');
    if (!buffer) return;

    this.bgSource = this.context.createBufferSource();
    this.bgSource.buffer = buffer;
    this.bgSource.loop = true;
    this.bgSource.connect(this.bgGain);

    if (fadeIn > 0) {
      this.bgGain.gain.setValueAtTime(0, this.context.currentTime);
      this.bgGain.gain.linearRampToValueAtTime(volume, this.context.currentTime + fadeIn);
    } else {
      this.bgGain.gain.value = volume;
    }
    this.bgSource.start(0);
  }

  get isBgMusicStarted(): boolean {
    return this.bgStarted;
  }

  // ── Feature Background Music (e.g. Lovers) ──

  startFeatureMusic(key: string, volume = 0.35, fadeIn = 0): void {
    if (!this.context) return;
    const buffer = this.buffers.get(key);
    if (!buffer) return;

    this.featureGain = this.context.createGain();
    this.featureGain.gain.value = fadeIn > 0 ? 0 : volume;
    this.featureGain.connect(this.context.destination);

    this.featureSource = this.context.createBufferSource();
    this.featureSource.buffer = buffer;
    this.featureSource.loop = true;
    this.featureSource.connect(this.featureGain);
    this.featureSource.start(0);

    if (fadeIn > 0) {
      this.featureGain.gain.linearRampToValueAtTime(volume, this.context.currentTime + fadeIn);
    }
  }

  async stopFeatureMusic(fadeOut = 0): Promise<void> {
    if (!this.featureSource || !this.featureGain || !this.context) return;
    if (fadeOut > 0) {
      const now = this.context.currentTime;
      this.featureGain.gain.setValueAtTime(this.featureGain.gain.value, now);
      this.featureGain.gain.linearRampToValueAtTime(0, now + fadeOut);
      await this.waitMs(fadeOut * 1000 + 50);
    }
    try { this.featureSource.stop(); } catch (_) {}
    this.featureSource = null;
    this.featureGain = null;
  }

  // ── Looping SFX (e.g. win count-up) ──

  startLoop(key: string, volume = 0.35): void {
    if (!this.context) return;
    const buffer = this.buffers.get(key);
    if (!buffer) return;
    this.ensureResumed();

    const gain = this.context.createGain();
    gain.gain.value = volume;
    gain.connect(this.context.destination);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start(0);

    this.loopingSources.set(key, { source, gain });
  }

  stopLoop(key: string, fadeOut = 0.15): void {
    const entry = this.loopingSources.get(key);
    if (!entry || !this.context) return;
    this.loopingSources.delete(key);

    if (fadeOut > 0) {
      const now = this.context.currentTime;
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
      entry.gain.gain.linearRampToValueAtTime(0, now + fadeOut);
      setTimeout(() => {
        try { entry.source.stop(); } catch (_) {}
        entry.gain.disconnect();
      }, fadeOut * 1000 + 50);
    } else {
      try { entry.source.stop(); } catch (_) {}
      entry.gain.disconnect();
    }
  }

  private waitMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const soundManager = new SoundManager();
