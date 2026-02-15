import { Assets, Texture, TextureSource } from 'pixi.js';
import symbolsConfig from './config/symbols.json';
import { SymbolsConfig } from './Types';

/** Mapping: tarot symbol ID → cardback texture ID */
const CARDBACK_MAP: Record<string, string> = {
  T_FOOL:      'CARDBACK_FOOL',
  T_CUPS:      'CARDBACK_CUPS',
  T_LOVERS:    'CARDBACK_LOVERS',
  T_PRIESTESS: 'CARDBACK_PRIESTESS',
  T_DEATH:     'CARDBACK_DEATH',
};

export class AssetLoader {
  private textures: Map<string, Texture> = new Map();
  public config: SymbolsConfig = symbolsConfig as SymbolsConfig;

  async load(onProgress?: (progress: number) => void): Promise<void> {
    console.log('🎨 Loading assets...');

    // Use linear (bilinear) filtering for smooth downscaling — avoids grainy look
    TextureSource.defaultOptions.scaleMode = 'linear';

    // Build a flat list of all assets to load (for progress tracking)
    const loadItems: { id: string; path: string }[] = [];

    for (const symbol of this.config.symbols) {
      const path = symbol.isTarot 
        ? `/assets/tarots/${symbol.filename}`
        : `/assets/symbols/${symbol.filename}`;
      loadItems.push({ id: symbol.id, path });
    }

    const cardbackNames = ['FOOL', 'CUPS', 'LOVERS', 'PRIESTESS', 'DEATH'];
    for (const name of cardbackNames) {
      const id = `CARDBACK_${name}`;
      loadItems.push({ id, path: `/assets/tarots/${id}.jpg` });
    }

    loadItems.push({ id: 'MYSTERY', path: '/assets/symbols/MYSTERY.png' });

    // Load all assets sequentially with progress
    let loaded = 0;
    const total = loadItems.length;

    for (const item of loadItems) {
      try {
        const texture = await Assets.load(item.path);
        this.textures.set(item.id, texture);
        console.log(`✓ Loaded: ${item.id} from ${item.path}`);
      } catch (error) {
        console.error(`✗ Failed to load ${item.id}:`, error);
      }
      loaded++;
      onProgress?.(loaded / total);
    }

    console.log(`✅ Loaded ${this.textures.size} textures`);
  }

  /** Get the cardback texture ID for a given tarot symbol ID (e.g. T_FOOL → CARDBACK_FOOL) */
  getCardbackId(tarotSymbolId: string): string | undefined {
    return CARDBACK_MAP[tarotSymbolId];
  }

  getTexture(symbolId: string): Texture | undefined {
    return this.textures.get(symbolId);
  }

  getSymbol(symbolId: string) {
    return this.config.symbols.find(s => s.id === symbolId);
  }

  getSymbolsByTier(tier: string) {
    return this.config.symbols.filter(s => s.tier === tier);
  }

  /** Symbols eligible for normal spins (excludes tarots and Lovers-only anchors) */
  private static readonly LOVERS_ANCHOR_IDS = new Set(['MALE', 'FEMALE']);

  getNormalSymbols() {
    return this.config.symbols.filter(s => !s.isTarot && !AssetLoader.LOVERS_ANCHOR_IDS.has(s.id));
  }

  getTarotSymbols() {
    return this.config.symbols.filter(s => s.isTarot);
  }
}
