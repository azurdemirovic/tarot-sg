import { DEBUG } from './debug';

/**
 * Toggleable in-game debug menu.
 * Press ` (backtick) to show/hide.
 * Allows runtime toggling of all debug flags and force-feature dropdowns.
 */
export class DebugMenu {
  private container: HTMLDivElement;
  private visible = false;

  constructor() {
    this.container = this.buildUI();
    document.body.appendChild(this.container);

    // Toggle with backtick key
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
  }

  private buildUI(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'debug-menu';
    panel.style.cssText = `
      display: none;
      position: fixed;
      top: 10px;
      right: 10px;
      width: 280px;
      max-height: 90vh;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.92);
      border: 1px solid #444;
      border-radius: 8px;
      padding: 12px;
      z-index: 99999;
      font-family: monospace;
      font-size: 12px;
      color: #ccc;
      user-select: none;
    `;

    // Title
    const title = document.createElement('div');
    title.textContent = '🔧 DEBUG MENU';
    title.style.cssText = 'font-size: 14px; font-weight: bold; color: #FFD700; margin-bottom: 10px; text-align: center; letter-spacing: 2px;';
    panel.appendChild(title);

    const hint = document.createElement('div');
    hint.textContent = 'Press ` to toggle';
    hint.style.cssText = 'font-size: 10px; color: #666; text-align: center; margin-bottom: 12px;';
    panel.appendChild(hint);

    // ── Visual Settings ──
    this.addSectionHeader(panel, 'Visual');
    this.addToggle(panel, 'Show Tarots on Start', 'showTarotsOnStart');
    this.addToggle(panel, '3D Background', 'BG_ENABLED');
    this.addToggle(panel, 'Camera Animation', 'BG_ANIMATE_CAMERA');
    this.addToggle(panel, 'Show Paylines', 'SHOW_PAYLINES');
    this.addToggle(panel, 'Death Mode', 'DEATH_MODE');

    // ── Anticipation Testing ──
    this.addSectionHeader(panel, 'Anticipation Test');
    this.addToggle(panel, 'Force 2 Tarots', 'FORCE_2_TAROTS');
    this.addToggle(panel, 'Force 3 Tarots', 'FORCE_3_TAROTS');

    // ── Force Features ──
    this.addSectionHeader(panel, 'Force Feature (next spin)');
    this.addForceFeatureDropdown(panel);

    // ── Column Config ──
    this.addSectionHeader(panel, 'Feature Columns');
    this.addColumnInput(panel, 'Cups Columns', 'CUPS_COLUMNS');
    this.addColumnInput(panel, 'Lovers Columns', 'LOVERS_COLUMNS');
    this.addColumnInput(panel, 'Priestess Columns', 'PRIESTESS_COLUMNS');
    this.addColumnInput(panel, 'Death Columns', 'DEATH_COLUMNS');
    this.addColumnInput(panel, 'Fool Columns', 'FOOL_COLUMNS');
    this.addColumnInput(panel, 'Fool Big Win Cols', 'FOOL_BIG_WIN_COLUMNS');

    return panel;
  }

  private addSectionHeader(parent: HTMLElement, text: string): void {
    const header = document.createElement('div');
    header.textContent = text;
    header.style.cssText = 'font-size: 11px; font-weight: bold; color: #888; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 6px 0; border-top: 1px solid #333; padding-top: 8px;';
    parent.appendChild(header);
  }

  private addToggle(parent: HTMLElement, label: string, key: keyof typeof DEBUG): void {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin: 4px 0; padding: 4px 6px; border-radius: 4px;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'color: #bbb;';

    const toggle = document.createElement('div');
    const isOn = DEBUG[key] as boolean;
    toggle.style.cssText = `
      width: 36px; height: 18px; border-radius: 9px; cursor: pointer; position: relative; transition: background 0.2s;
      background: ${isOn ? '#4CAF50' : '#555'};
    `;

    const knob = document.createElement('div');
    knob.style.cssText = `
      width: 14px; height: 14px; border-radius: 50%; background: #fff; position: absolute; top: 2px; transition: left 0.2s;
      left: ${isOn ? '20px' : '2px'};
    `;
    toggle.appendChild(knob);

    toggle.addEventListener('click', () => {
      const newVal = !(DEBUG[key] as boolean);
      (DEBUG as any)[key] = newVal;
      toggle.style.background = newVal ? '#4CAF50' : '#555';
      knob.style.left = newVal ? '20px' : '2px';
      console.log(`🔧 DEBUG.${key} = ${newVal}`);
    });

    row.appendChild(lbl);
    row.appendChild(toggle);
    parent.appendChild(row);
  }

  private addForceFeatureDropdown(parent: HTMLElement): void {
    const row = document.createElement('div');
    row.style.cssText = 'margin: 6px 0;';

    const select = document.createElement('select');
    select.style.cssText = `
      width: 100%; padding: 6px 8px; background: #222; color: #fff; border: 1px solid #555;
      border-radius: 4px; font-family: monospace; font-size: 12px; cursor: pointer;
    `;

    const options = [
      { label: 'None (random)', value: 'NONE' },
      { label: '☕ Force Cups', value: 'FORCE_CUPS' },
      { label: '💕 Force Lovers', value: 'FORCE_LOVERS' },
      { label: '🔮 Force Priestess', value: 'FORCE_PRIESTESS' },
      { label: '💀 Force Death', value: 'FORCE_DEATH' },
      { label: '🃏 Force Fool', value: 'FORCE_FOOL' },
      { label: '🃏💰 Force Fool Big Win', value: 'FORCE_FOOL_BIG_WIN' },
    ];

    // Find current selection
    let currentValue = 'NONE';
    const forceKeys = ['FORCE_CUPS', 'FORCE_LOVERS', 'FORCE_PRIESTESS', 'FORCE_DEATH', 'FORCE_FOOL', 'FORCE_FOOL_BIG_WIN'] as const;
    for (const k of forceKeys) {
      if (DEBUG[k]) { currentValue = k; break; }
    }

    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      if (opt.value === currentValue) el.selected = true;
      select.appendChild(el);
    }

    select.addEventListener('change', () => {
      // Turn off all force flags
      for (const k of forceKeys) {
        (DEBUG as any)[k] = false;
      }
      // Turn on selected
      if (select.value !== 'NONE') {
        (DEBUG as any)[select.value] = true;
        console.log(`🔧 Force feature: ${select.value}`);
      } else {
        console.log('🔧 Force feature: OFF (random spins)');
      }
    });

    row.appendChild(select);
    parent.appendChild(row);
  }

  private addColumnInput(parent: HTMLElement, label: string, key: keyof typeof DEBUG): void {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin: 3px 0; padding: 2px 6px;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'color: #999; font-size: 11px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = (DEBUG[key] as number[]).join(', ');
    input.style.cssText = `
      width: 80px; padding: 3px 6px; background: #222; color: #fff; border: 1px solid #555;
      border-radius: 3px; font-family: monospace; font-size: 11px; text-align: center;
    `;

    input.addEventListener('change', () => {
      try {
        const cols = input.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        if (cols.length >= 2) {
          (DEBUG as any)[key] = cols;
          input.style.borderColor = '#4CAF50';
          console.log(`🔧 DEBUG.${key} = [${cols.join(', ')}]`);
        } else {
          input.style.borderColor = '#f44';
        }
      } catch {
        input.style.borderColor = '#f44';
      }
      setTimeout(() => { input.style.borderColor = '#555'; }, 1500);
    });

    row.appendChild(lbl);
    row.appendChild(input);
    parent.appendChild(row);
  }
}
