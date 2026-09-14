/**
 * EXTRA 1: AI FAILURE RECOVERY SYSTEM
 * Fallback logic if primary models fail.
 */
import { LocalModelAdapter } from '../personal_ai/LocalModelAdapter';

export class FailoverManager {
  static async executeWithFallback(primaryTask: () => Promise<any>): Promise<any> {
    try {
      return await primaryTask();
    } catch (error) {
      console.error(`[FailoverManager] Primary task failed:`, error);
      console.log(`[FailoverManager] Engaging local fallback engine.`);
      
      if (LocalModelAdapter.isAvailable()) {
         return await LocalModelAdapter.generate("EMERGENCY FALLBACK: System overloaded. Please hold.");
      }
      
      throw new Error("Complete AI System Failure. No fallbacks available.");
    }
  }
}
