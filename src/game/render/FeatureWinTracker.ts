import { easeOutCubic } from '../utils/AnimationUtils';

// ═══════════════════════════════════════════════════════════════
//  FeatureWinTracker
//  Persistent "WON" + cumulative total display below the frame
//  during multi-spin features (Priestess, Death, Lovers).
//
//  - Pops up on first win with a scale-in animation
//  - Each subsequent win counts up from current total to new total
//  - Automatically hides when dispose() is called
// ═══════════════════════════════════════════════════════════════

export class FeatureWinTracker {
  private winPanel: HTMLElement;
  private winLabel: HTMLElement;
  private winValue: HTMLElement;
  private currentTotal: number = 0;
  private isVisible: boolean = false;
  private originalLabelText: string = '';
  private countUpAnimId: number = 0;

  constructor() {
    this.winPanel = document.getElementById('win-panel') as HTMLElement;
    this.winLabel = this.winPanel.querySelector('.info-label') as HTMLElement;
    this.winValue = document.getElementById('win-display') as HTMLElement;

    // Save original label text so we can restore it later
    this.originalLabelText = this.winLabel.textContent || 'Win';
  }

  /**
   * Add a win amount to the running total.
   * On first call: pops up the panel with scale animation.
   * On subsequent calls: counts up from current total to new total.
   */
  async addWin(amount: number): Promise<void> {
    if (amount <= 0) return;

    const previousTotal = this.currentTotal;
    this.currentTotal += amount;

    if (!this.isVisible) {
      // First win — pop up the panel
      this.isVisible = true;
      this.winLabel.textContent = 'Won';
      this.winValue.textContent = '0.00 €';
      this.winValue.style.color = '#FFD700';
      this.winPanel.classList.add('visible');

      // Pop-in animation via CSS transform
      this.winPanel.style.transform = 'scale(0)';
      this.winPanel.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      // Force reflow so the initial scale(0) applies before transitioning
      void this.winPanel.offsetHeight;
      this.winPanel.style.transform = 'scale(1)';

      // Wait for pop-in to finish
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    // Count up from previous total to new total
    await this.countUp(previousTotal, this.currentTotal);
  }

  /**
   * Animate counting up from `from` to `to`.
   */
  private countUp(from: number, to: number): Promise<void> {
    // Cancel any in-progress count-up
    cancelAnimationFrame(this.countUpAnimId);

    const duration = Math.min(1200, Math.max(400, (to - from) * 50));

    return new Promise(resolve => {
      const start = performance.now();

      const frame = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);
        const ease = easeOutCubic(t);

        const currentValue = from + (to - from) * ease;
        this.winValue.textContent = `${currentValue.toFixed(2)} €`;

        // Subtle pulse — scale the value text during count-up
        const scale = 1 + 0.1 * Math.sin(t * Math.PI);
        this.winValue.style.transform = `scale(${scale})`;

        if (t < 1) {
          this.countUpAnimId = requestAnimationFrame(frame);
        } else {
          this.winValue.textContent = `${to.toFixed(2)} €`;
          this.winValue.style.transform = 'scale(1)';
          resolve();
        }
      };

      this.countUpAnimId = requestAnimationFrame(frame);
    });
  }

  /** Get the current accumulated total */
  getTotal(): number {
    return this.currentTotal;
  }

  /**
   * Clean up — restore the original win panel state.
   * Call this when the feature ends.
   */
  dispose(): void {
    cancelAnimationFrame(this.countUpAnimId);
    this.winLabel.textContent = this.originalLabelText;
    this.winValue.style.color = '';
    this.winValue.style.transform = '';
    this.winPanel.style.transform = '';
    this.winPanel.style.transition = '';

    // Don't hide the panel — main.ts will handle showing the final total
    // through its normal updateUI() flow
  }
}
