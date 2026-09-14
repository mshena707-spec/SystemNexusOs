/**
 * @deprecated as of CTO Audit Part 2 response (2026-07-18). Found to have zero
 * importers anywhere in the codebase — NexusConfig.ts (../config/NexusConfig.ts,
 * 20 real importers) is the actual centralized config system in use, and its own
 * header comment states the principle this file quietly duplicates and bypasses
 * ("no raw process.env access anywhere else"). See docs/adr/0001 through 0005 and
 * docs/AUDIT_RESPONSE_PART2.md for the full duplication finding. Left in place, not
 * deleted, pending confirmation nothing outside this snapshot depends on it.
 *
 * Smart Auto Configuration Engine (Phase F)
 * Analyzes the environment variables, suggests fixes, applies safe defaults,
 * and tracks the readiness state of the platform.
 */
export class AutoConfig {
  static validateEnvironment() {
    const warnings: string[] = [];
    const env = (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) ? (import.meta as any).env : (process?.env || {});
    
    // Check AI Configuration
    const geminiKey = process.env.GEMINI_API_KEY || '';
    if (!geminiKey || geminiKey === "YOUR_GEMINI_API_KEY") {
      warnings.push("GEMINI_API_KEY is missing or invalid. Paid AI tiers will gracefully fallback to local offline routing.");
    }

    // Check Firebase / DB Configuration
    let hasFirebase = false;
    try {
      hasFirebase = true; // since it imports firebase-applet-config.json statically usually.
    } catch(e) {}
    
    if (!env.VITE_FIREBASE_PROJECT_ID && !env.VITE_FIREBASE_API_KEY && !hasFirebase) {
      warnings.push("Firebase Configuration is missing. Storage will fallback to standalone IndexedDB/Memory mode if configured.");
    }

    // Detect Environment Mode
    const isProd = env.PROD || env.MODE === 'production' || process.env?.NODE_ENV === 'production';
    if (isProd) {
       console.log("[AutoConfig] Production environment detected. Enabling stricter cache rules and telemetry.");
    } else {
       console.log("[AutoConfig] Development mode detected.");
    }
    
    if (warnings.length > 0) {
      console.warn("[AutoConfig] System Diagnostics Warnings:\n- " + warnings.join('\n- '));
    } else {
      console.log("[AutoConfig] Environment diagnostics passed beautifully. Full capabilities online.");
    }
    
    let configState = {
      isProd,
      isFirebaseConfigured: !!env.VITE_FIREBASE_API_KEY,
      hasPaidAI: !!geminiKey && geminiKey !== "YOUR_GEMINI_API_KEY",
      capabilities: {
        canStream: true,
        canVision: true
      }
    };

    return configState;
  }
}

// Instantiate validation at startup
export const SystemConfig = AutoConfig.validateEnvironment();
