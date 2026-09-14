/**
 * @deprecated as of CTO Audit Part 2 response (2026-07-18). This was found to have
 * zero importers anywhere in the codebase and is in-memory only (doesn't persist
 * across restarts, doesn't share state across horizontally-scaled instances — see
 * docs/architecture/SCALING_GUIDE.md). Use FeatureFlags from
 * src/lib/core/flags/FeatureFlags.ts instead, which persists via NexusDB and covers
 * the flags named in CTO Audit Part 2, section 8. Left in place, not deleted, in case
 * something outside this audited snapshot still references it — remove once confirmed
 * unused in your actual deployment.
 *
 * EXTRA 3: FEATURE FLAG SYSTEM
 * Enable/Disable features dynamically.
 */
export class FeatureFlagManager {
  private static flags: Map<string, boolean> = new Map([
    ['enable_local_ai', true],
    ['enable_shadow_testing', true],
    ['enable_ultra_compression', true]
  ]);

  static isEnabled(flagName: string): boolean {
    return this.flags.get(flagName) || false;
  }

  static toggleFlag(flagName: string, state: boolean) {
    this.flags.set(flagName, state);
    console.log(`[FeatureFlags] ${flagName} set to ${state}`);
  }
}
