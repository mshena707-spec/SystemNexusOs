/**
 * PHASE 82: MODE ROUTING ENGINE
 */
import { OperatingModeManager, OperatingMode } from './OperatingModeManager';
import { DecisionFusionEngine } from '../intelligence/DecisionFusionEngine';

export class ModeRouter {
  static routeRequest(payload: any): { strategies: OperatingMode[], execute: () => Promise<any> } {
    const active = OperatingModeManager.getActiveModes();
    
    if (active.length > 1) {
      return {
        strategies: active,
        execute: () => DecisionFusionEngine.splitAndMerge(payload, active)
      };
    }

    return {
      strategies: active,
      execute: () => this.fallbackExecution(payload, active[0])
    };
  }

  private static async fallbackExecution(payload: any, mode: OperatingMode) {
    console.log(`[ModeRouter] Single mode execution via ${mode}`);
    return `Executed via ${mode}`;
  }
}
