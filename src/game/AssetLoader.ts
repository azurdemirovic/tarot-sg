import { Assets, Texture } from 'pixi.js';
import symbolsConfig from './config/symbols.json';
import { SymbolsConfig } from './Types';

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

    console.log(`✅ Loaded ${this.textures.size} textures`);
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
