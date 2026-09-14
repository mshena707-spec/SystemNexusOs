/**
 * PHASE 81: TRI-MODE OPERATING CORE
 */
export type OperatingMode = 'ENTERPRISE_MODE' | 'AGI_MODE' | 'PRODUCT_MODE';

export class OperatingModeManager {
  private static activeModes: Set<OperatingMode> = new Set(['ENTERPRISE_MODE', 'AGI_MODE', 'PRODUCT_MODE']);

  static enableMode(mode: OperatingMode) {
    this.activeModes.add(mode);
    console.log(`[OperatingMode] Enabled mode: ${mode}`);
  }

  static disableMode(mode: OperatingMode) {
    if (this.activeModes.size > 1) {
      this.activeModes.delete(mode);
      console.log(`[OperatingMode] Disabled mode: ${mode}`);
    } else {
      console.warn(`[OperatingMode] Cannot disable last active mode.`);
    }
  }

  static isModeActive(mode: OperatingMode): boolean {
    return this.activeModes.has(mode);
  }

  static getActiveModes(): OperatingMode[] {
    return Array.from(this.activeModes);
  }

  static isHybridFull(): boolean {
    return this.activeModes.size === 3;
  }
}
