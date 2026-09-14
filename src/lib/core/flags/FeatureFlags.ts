/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NEXUS FEATURE FLAGS                                                     ║
 * ║  Answers CTO Audit Part 2, section 8.                                    ║
 * ║                                                                           ║
 * ║  Replaces src/lib/core/FeatureFlagManager.ts, which — despite its name — ║
 * ║  was dead code: a 20-line in-memory Map, zero importers anywhere in the  ║
 * ║  codebase, resets on every process restart, and doesn't survive running  ║
 * ║  more than one instance (see docs/architecture/SCALING_GUIDE.md). That   ║
 * ║  file is left in place with a deprecation notice rather than deleted,    ║
 * ║  in case something outside this audited snapshot references it.         ║
 * ║                                                                           ║
 * ║  This version persists via NexusDB (works across every DB_PROVIDER      ║
 * ║  backend for free — see docs/architecture/DATABASE_SCHEMA.md), so a     ║
 * ║  flag flip survives a restart and is shared across every instance in a  ║
 * ║  horizontally-scaled deployment — which the old Map-based version       ║
 * ║  silently was not.                                                       ║
 * ║                                                                           ║
 * ║  USAGE:                                                                  ║
 * ║    import { FeatureFlags } from '@/lib/core/flags/FeatureFlags';        ║
 * ║    await FeatureFlags.load();              // once, at boot             ║
 * ║    if (FeatureFlags.isEnabled('ENABLE_SUPERVISOR')) { ... }             ║
 * ║    await FeatureFlags.set('ENABLE_MARKETING_AI', true, 'CEOCommand');   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { NexusDB } from '../../database/NexusDB';
import { EventBus } from '../events/NexusEventBus';
import { logger } from '../logging/NexusLogger';

const log = logger.child('FeatureFlags');
const COLLECTION = 'feature_flags';

export interface FeatureFlagDefinition {
  key: string;
  description: string;
  /** Default value if nothing is persisted yet — lets a flag ship "off" safely. */
  defaultValue: boolean;
}

/**
 * The known flags for this system, named per CTO Audit Part 2 section 8, plus the
 * three that were real (if unwired) in the old stub. Register a new flag here before
 * using it — this list doubles as living documentation of every kill-switch that exists.
 */
export const KNOWN_FLAGS: FeatureFlagDefinition[] = [
  { key: 'ENABLE_LOCAL_AI', description: 'Route AI requests to Ollama/WebLLM instead of Gemini.', defaultValue: true },
  { key: 'ENABLE_BACKUP_AGENT', description: 'Allow BACKUP_AI-level agents to act (see AgentHierarchy).', defaultValue: false },
  { key: 'ENABLE_SUPERVISOR', description: 'Route agent tasks through SupervisorAgent orchestration.', defaultValue: true },
  { key: 'ENABLE_MARKETING_AI', description: 'Allow marketing-domain agents to send autonomous campaigns.', defaultValue: false },
  { key: 'ENABLE_MEMORY_V2', description: 'Use the taxonomy in MemoryTypes.ts over any legacy memory path.', defaultValue: true },
  { key: 'ENABLE_LOYALTY_ADVISOR', description: 'Load the loyalty-advisor example plugin (src/plugins/loyalty-advisor). Off by default — see that plugin for why.', defaultValue: false },
  // Carried over from the old FeatureFlagManager stub for continuity:
  { key: 'ENABLE_SHADOW_TESTING', description: 'Run ShadowTester.ts alongside live traffic.', defaultValue: true },
  { key: 'ENABLE_ULTRA_COMPRESSION', description: 'Use UltraCompressor.ts for memory/context payloads.', defaultValue: true },
];

interface FeatureFlagRecord {
  key: string;
  value: boolean;
  updatedAt: string;
  updatedBy: string;
}

class FeatureFlagsService {
  private cache = new Map<string, boolean>();
  private loaded = false;

  /** Call once at boot (see SystemBoot.ts). Falls back to defaults if the DB read fails,
   *  so a database hiccup degrades to "known-safe defaults," not a crash. */
  async load(): Promise<void> {
    for (const flag of KNOWN_FLAGS) {
      this.cache.set(flag.key, flag.defaultValue);
    }
    try {
      const records = (await NexusDB.find(COLLECTION, {})) as unknown as FeatureFlagRecord[];
      for (const record of records) {
        this.cache.set(record.key, record.value);
      }
      this.loaded = true;
      log.info('Feature flags loaded', { count: this.cache.size });
    } catch (err) {
      log.warn('Feature flag load failed — using compiled-in defaults', { error: (err as Error)?.message });
    }
  }

  /** Synchronous by design — this is called on hot paths (route handlers, agent
   *  decisions) and must never block on a DB round-trip. Call load() at boot first. */
  isEnabled(key: string): boolean {
    if (!this.loaded) {
      log.warn(`FeatureFlags.isEnabled('${key}') called before load() — using compiled-in default`);
    }
    const known = KNOWN_FLAGS.find((f) => f.key === key);
    return this.cache.get(key) ?? known?.defaultValue ?? false;
  }

  async set(key: string, value: boolean, updatedBy: string): Promise<void> {
    const previous = this.cache.get(key);
    this.cache.set(key, value);
    await NexusDB.update(COLLECTION, key, { key, value, updatedAt: new Date().toISOString(), updatedBy });
    log.info(`Flag ${key} set to ${value}`, { previous, updatedBy });
    // Reuses the existing 'system.config.changed' event (a flag flip is a config change)
    // rather than fragmenting the taxonomy in docs/architecture/EVENT_BUS.md with a new
    // type. Lets any listening module (an admin dashboard, or an agent that should stop
    // acting mid-flight) react immediately instead of polling.
    EventBus.emit('system.config.changed', { key, value, previous, updatedBy, kind: 'feature_flag' }, 'FeatureFlags');
  }

  /** For the admin UI — CEOCommandCenter.tsx / OwnerAIControlApp.tsx are the natural
   *  place to surface this, per docs/architecture/NAMING_CONVENTIONS.md's mapping of
   *  those files to real admin surfaces. */
  listAll(): Array<FeatureFlagDefinition & { value: boolean }> {
    return KNOWN_FLAGS.map((f) => ({ ...f, value: this.isEnabled(f.key) }));
  }
}

export const FeatureFlags = new FeatureFlagsService();
