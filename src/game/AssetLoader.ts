import { Assets, Texture } from 'pixi.js';
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

  async load(): Promise<void> {
    console.log('🎨 Loading assets...');

    // Load all symbol textures
    for (const symbol of this.config.symbols) {
      const path = symbol.isTarot 
        ? `/assets/tarots/${symbol.filename}`
        : `/assets/symbols/${symbol.filename}`;
      
      try {
        const texture = await Assets.load(path);
        this.textures.set(symbol.id, texture);
        console.log(`✓ Loaded: ${symbol.id} from ${path}`);
      } catch (error) {
        console.error(`✗ Failed to load ${symbol.id}:`, error);
      }
    }

    // Load cardback textures (one per tarot type)
    const cardbackNames = ['FOOL', 'CUPS', 'LOVERS', 'PRIESTESS', 'DEATH'];
    for (const name of cardbackNames) {
      const id = `CARDBACK_${name}`;
      const path = `/assets/tarots/${id}.jpg`;
      try {
        const texture = await Assets.load(path);
        this.textures.set(id, texture);
        console.log(`✓ Loaded: ${id}`);
      } catch (error) {
        console.error(`✗ Failed to load ${id}:`, error);
      }
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

  getNormalSymbols() {
    return this.config.symbols.filter(s => !s.isTarot);
  }

  getTarotSymbols() {
    return this.config.symbols.filter(s => s.isTarot);
  }
}
