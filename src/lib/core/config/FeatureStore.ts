/**
 * FeatureStore — the real, server-side source of truth for feature flags.
 *
 * WHY THIS EXISTS: the previous FeatureGate (src/lib/core/security/FeatureGate.ts)
 * is a zustand store — in-memory, browser-only. It was being imported into
 * BOTH React components (fine, browser-only there) AND server-side code
 * (Orchestrator.ts) — but a Node process and a user's browser are different
 * machines. Toggling a flag in the dashboard updated only that browser tab's
 * copy; the server's copy stayed on its hardcoded defaults forever, no
 * matter what an admin did in the UI. `enableCognitiveRouting` — which
 * actually gates which AI routing path Orchestrator.ts takes — could never
 * really be controlled by anyone.
 *
 * This store is what the server actually reads. Hydrated from NexusDB once
 * at boot (so a restart doesn't silently reset every flag to default), kept
 * in a memory cache for zero-latency reads on every AI request, and written
 * through to NexusDB on every change so it survives restarts and works
 * identically on every supported database provider.
 */
import { NexusDB } from '../../database/NexusDB';

const COLLECTION = 'settings';
const DOC_ID = 'nexus_features';

export interface SystemFeatureFlags {
  enableCognitiveRouting: boolean;
  enableOfflineBrainstem: boolean;
  enableStrictRBAC: boolean;
  enableDeepAnalytics: boolean;
  enableHyperCompression: boolean;
  enableAutoArchive: boolean;
  enableMoEPredictor: boolean;
  enableNeuroplasticity: boolean;
  enableEmotionalResonance: boolean;
  enableVendorFailover: boolean;
  [key: string]: boolean; // forward-compatible with SystemFeatures in FeatureContext.tsx, which has additional keys
}

const DEFAULTS: SystemFeatureFlags = {
  enableCognitiveRouting: true,
  enableOfflineBrainstem: true,
  enableStrictRBAC: true,
  enableDeepAnalytics: false,
  enableHyperCompression: true,
  enableAutoArchive: true,
  enableMoEPredictor: true,
  enableNeuroplasticity: true,
  enableEmotionalResonance: true,
  enableVendorFailover: true,
};

class FeatureStoreImpl {
  private cache: SystemFeatureFlags = { ...DEFAULTS };
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  /** Called once at server boot — loads whatever was last saved, so a restart doesn't reset flags to default. */
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydrating) return this.hydrating;
    this.hydrating = (async () => {
      try {
        const doc = await NexusDB.get(COLLECTION, DOC_ID);
        if (doc?.features) this.cache = { ...DEFAULTS, ...doc.features };
      } catch {
        // No saved doc yet, or DB not reachable — defaults already in cache, nothing to do.
      }
      this.hydrated = true;
    })();
    return this.hydrating;
  }

  /** Synchronous read for hot paths (e.g. every AI request in Orchestrator.ts) — safe to call before hydrate() finishes; returns defaults until then, which is the same behavior the old code always had. */
  isEnabled(flag: string): boolean {
    return this.cache[flag] ?? false;
  }

  async getAll(): Promise<SystemFeatureFlags> {
    await this.hydrate();
    return { ...this.cache };
  }

  async setMany(updates: Record<string, boolean>, updatedBy?: string): Promise<SystemFeatureFlags> {
    await this.hydrate();
    this.cache = { ...this.cache, ...updates };
    await NexusDB.set(COLLECTION, DOC_ID, { features: this.cache, updatedAt: new Date().toISOString(), updatedBy });
    return { ...this.cache };
  }

  /** Call once at server startup so the very first AI request already sees real, saved flags instead of hardcoded defaults. */
  async warmUp(): Promise<void> {
    await this.hydrate();
  }
}

export const FeatureStore = new FeatureStoreImpl();
