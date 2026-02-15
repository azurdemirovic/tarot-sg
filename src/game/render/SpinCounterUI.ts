/**
 * SpinCounterUI — HTML-based spin counter displayed below the spin button.
 * Used by Lovers, Priestess, and Death features.
 */

const FEATURE_COLORS: Record<string, string> = {
  T_LOVERS: '#FF69B4',
  T_PRIESTESS: '#c084fc',
  T_DEATH: '#ff4444',
};

const FEATURE_LABELS: Record<string, string> = {
  T_LOVERS: 'SPIN',
  T_PRIESTESS: 'MYSTERY SPIN',
  T_DEATH: 'DEATH SPIN',
};

export class SpinCounterUI {
  private container: HTMLElement;
  private textEl: HTMLElement;
  private featureType: string;

  constructor(featureType: string) {
    this.featureType = featureType;
    this.container = document.getElementById('spin-counter') as HTMLElement;
    this.textEl = document.getElementById('spin-counter-text') as HTMLElement;

    const color = FEATURE_COLORS[featureType] || '#FFD700';
    this.textEl.style.color = color;
    this.container.style.display = 'none';
  }

  /** Show or update the spin counter */
  update(spinNum: number, total: number): void {
    const remaining = total - spinNum;
    const label = FEATURE_LABELS[this.featureType] || 'SPIN';
    this.textEl.textContent = `${label} ${spinNum} / ${total}  •  ${remaining} LEFT`;
    this.container.style.display = 'block';
  }

  /** Hide and reset the spin counter */
  dispose(): void {
    this.container.style.display = 'none';
    this.textEl.textContent = '';
  }
}
