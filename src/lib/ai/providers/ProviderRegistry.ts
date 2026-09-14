/**
 * UNIVERSAL AI PROVIDER REGISTRY
 *
 * Add any LLM model at runtime — free, paid, or custom tier.
 * The registry automatically selects the best available model
 * based on cost tier, capability, and health.
 *
 * Usage (register a new model):
 *   GlobalProviderRegistry.register('my-model', new MyAdapter(), {
 *     costTier: 'free',
 *     intelligence: 'advanced',
 *     speed: 'fast',
 *     supportsStreaming: true,
 *     supportsVision: false,
 *     supportsTools: false,
 *     contextWindowLength: 8192,
 *     maxOutputTokens: 2048,
 *     description: 'My custom LLaMA model',
 *   });
 *
 * Manual routing override (set in Admin → AI Config Panel):
 *   GlobalProviderRegistry.setPrimaryForRole('customer_support', 'gemini-flash');
 */

import { IAIProvider } from '../../core/interfaces/IAIProvider';

export type CostTier = 'free' | 'low' | 'medium' | 'high' | 'enterprise';
export type SpeedRating = 'instant' | 'fast' | 'balanced' | 'slow';
export type IntelligenceRating = 'basic' | 'intermediate' | 'advanced' | 'expert';

export interface ProviderCapability {
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  contextWindowLength: number;
  maxOutputTokens?: number;
  costTier: CostTier;
  speed: SpeedRating;
  intelligence: IntelligenceRating;
  description?: string;
  /** Estimated cost per 1k tokens in USD (0 for free) */
  costPer1kTokens?: number;
}

export interface RegisteredProvider {
  id: string;
  provider: IAIProvider;
  capabilities: ProviderCapability;
  isHealthy: boolean;
  failureCount: number;
  lastFailureAt: number | null;
  /** If set, this provider is used for this role regardless of auto-selection */
  manualRoleOverrides: Set<string>;
  addedAt: number;
}

/** Selection criteria for findBestProvider */
export interface ProviderRequirements {
  costTier?: CostTier;
  maxCostTier?: CostTier;   // "no higher than medium"
  intelligence?: IntelligenceRating;
  minIntelligence?: IntelligenceRating;
  supportsVision?: boolean;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  preferSpeed?: boolean;
  speed?: 'fast' | 'balanced' | 'precise'; // alias used by PaidAgent + AIGateway callers
  role?: string;            // checks manual role overrides first
}

const TIER_ORDER: CostTier[] = ['free', 'low', 'medium', 'high', 'enterprise'];
const INTEL_ORDER: IntelligenceRating[] = ['basic', 'intermediate', 'advanced', 'expert'];

function tierIndex(t: CostTier) { return TIER_ORDER.indexOf(t); }
function intelIndex(i: IntelligenceRating) { return INTEL_ORDER.indexOf(i); }

class ProviderRegistry {
  private providers = new Map<string, RegisteredProvider>();
  /** role → provider id manual overrides set from Admin UI */
  private roleOverrides = new Map<string, string>();

  /** Register a new AI provider. Can be called at any time (runtime). */
  register(id: string, provider: IAIProvider, capabilities: ProviderCapability) {
    if (this.providers.has(id)) {
      console.warn(`[ProviderRegistry] Overwriting existing provider: ${id}`);
    }
    this.providers.set(id, {
      id,
      provider,
      capabilities,
      isHealthy: true,
      failureCount: 0,
      lastFailureAt: null,
      manualRoleOverrides: new Set(),
      addedAt: Date.now(),
    });
    console.log(`[ProviderRegistry] ✅ Registered: ${id} | tier=${capabilities.costTier} | intel=${capabilities.intelligence}`);
  }

  /** Remove a provider (e.g. API key revoked) */
  unregister(id: string) {
    this.providers.delete(id);
    // Remove any role overrides pointing to this provider
    for (const [role, pid] of this.roleOverrides.entries()) {
      if (pid === id) this.roleOverrides.delete(role);
    }
    console.log(`[ProviderRegistry] Removed provider: ${id}`);
  }

  /** Get all registered providers (for Admin UI display) */
  listAll(): RegisteredProvider[] {
    return Array.from(this.providers.values());
  }

  /** Get a specific provider by ID */
  getProvider(id: string): IAIProvider | undefined {
    return this.providers.get(id)?.provider;
  }

  /** Manually pin a role to a specific provider (from Admin → AI Config) */
  setPrimaryForRole(role: string, providerId: string) {
    this.roleOverrides.set(role, providerId);
    console.log(`[ProviderRegistry] Role override: "${role}" → "${providerId}"`);
  }

  /** Remove a manual role override (go back to auto-selection) */
  clearRoleOverride(role: string) {
    this.roleOverrides.delete(role);
    console.log(`[ProviderRegistry] Cleared role override for: "${role}"`);
  }

  getRoleOverrides(): Record<string, string> {
    return Object.fromEntries(this.roleOverrides);
  }

  /** Mark provider as unhealthy after a failure */
  reportFailure(id: string) {
    const p = this.providers.get(id);
    if (!p) return;
    p.failureCount++;
    p.lastFailureAt = Date.now();
    if (p.failureCount >= 3) {
      p.isHealthy = false;
      console.warn(`[ProviderRegistry] ❌ ${id} marked unhealthy after ${p.failureCount} failures`);
    }
  }

  /**
   * Added during CTO Audit Part 3 response (2026-07-19): FreeAgent.ts and PaidAgent.ts
   * were already calling GlobalProviderRegistry.markUnhealthy(id) — confirmed missing
   * by tsc in the Part 2 audit round (see docs/governance/TECHNICAL_DEBT_REGISTER.md).
   * Deliberately NOT an alias for reportFailure(): those call sites are mid-request
   * retry loops ("failed, marking unhealthy and trying next provider") that need this
   * provider excluded from the *rest of this same request* immediately — waiting for
   * reportFailure's 3-strike threshold would let the same broken provider get retried
   * within one request. reportFailure remains the right call for longer-horizon health
   * tracking (e.g. a scheduled health-check sweep); this is for "not now, this request."
   */
  markUnhealthy(id: string) {
    const p = this.providers.get(id);
    if (!p) return;
    p.isHealthy = false;
    p.failureCount++;
    p.lastFailureAt = Date.now();
    console.warn(`[ProviderRegistry] ⚠️ ${id} marked unhealthy immediately (mid-request failure)`);
  }

  /** Mark provider as healthy again (called after a successful call) */
  reportSuccess(id: string) {
    const p = this.providers.get(id);
    if (!p) return;
    p.isHealthy = true;
    p.failureCount = 0;
  }

  /**
   * Find the best available provider matching the given requirements.
   * Priority:
   *   1. Manual role override (if set by admin)
   *   2. Hard constraints (vision, streaming, tools, max cost tier)
   *   3. Soft scoring (intelligence match, speed preference, cost efficiency)
   */
  findBestProvider(requirements: ProviderRequirements = {}): IAIProvider {
    // 1. Manual role override
    if (requirements.role && this.roleOverrides.has(requirements.role)) {
      const overrideId = this.roleOverrides.get(requirements.role)!;
      const override = this.providers.get(overrideId);
      if (override?.isHealthy) {
        console.log(`[ProviderRegistry] Using manual override for role "${requirements.role}": ${overrideId}`);
        return override.provider;
      }
      console.warn(`[ProviderRegistry] Override provider "${overrideId}" is unhealthy, falling back to auto-select`);
    }

    let candidates = Array.from(this.providers.values()).filter(p => p.isHealthy);

    // 2. Hard constraints
    if (requirements.supportsVision) candidates = candidates.filter(p => p.capabilities.supportsVision);
    if (requirements.supportsStreaming) candidates = candidates.filter(p => p.capabilities.supportsStreaming);
    if (requirements.supportsTools) candidates = candidates.filter(p => p.capabilities.supportsTools);
    if (requirements.maxCostTier) {
      const maxIdx = tierIndex(requirements.maxCostTier);
      candidates = candidates.filter(p => tierIndex(p.capabilities.costTier) <= maxIdx);
    }
    if (requirements.minIntelligence) {
      const minIdx = intelIndex(requirements.minIntelligence);
      candidates = candidates.filter(p => intelIndex(p.capabilities.intelligence) >= minIdx);
    }

    if (candidates.length === 0) {
      // Last resort: return any healthy provider
      const anyHealthy = Array.from(this.providers.values()).find(p => p.isHealthy);
      if (anyHealthy) {
        console.warn('[ProviderRegistry] No provider matched constraints, using fallback');
        return anyHealthy.provider;
      }
      throw new Error('[ProviderRegistry] No healthy AI providers available. Check your API keys.');
    }

    // 3. Soft scoring
    const targetTier = requirements.costTier;
    const targetIntel = requirements.intelligence;

    const scored = candidates.map(p => {
      let score = 0;
      const cap = p.capabilities;

      // Prefer exact tier match, penalize over-spending
      if (targetTier && cap.costTier === targetTier) score += 20;
      if (targetTier && tierIndex(cap.costTier) < tierIndex(targetTier)) score += 5; // cheaper is ok
      if (targetTier && tierIndex(cap.costTier) > tierIndex(targetTier)) score -= 30; // penalize overspending

      // Intelligence
      if (targetIntel && cap.intelligence === targetIntel) score += 20;
      if (targetIntel && intelIndex(cap.intelligence) > intelIndex(targetIntel)) score += 5; // smarter is ok

      // Speed preference
      if (requirements.preferSpeed) {
        const speedMap: Record<SpeedRating, number> = { instant: 10, fast: 8, balanced: 5, slow: 2 };
        score += speedMap[cap.speed] || 0;
      }

      // Prefer lower cost among equals
      score -= (cap.costPer1kTokens || 0) * 10;

      return { provider: p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].provider;
    console.log(`[ProviderRegistry] Selected: ${best.id} (score=${scored[0].score})`);
    return best.provider;
  }

  /**
   * Added during CTO Audit Part 3 response: neither the pre-existing reportFailure()
   * nor the markUnhealthy() added above this method had any automatic path back to
   * healthy — a provider stayed excluded from findBestProvider() until it happened to
   * be manually retried and succeeded, which never happens for a provider findBestProvider
   * is actively avoiding. This sweep uses IAIProvider's optional ping() to give every
   * unhealthy provider a real chance to recover. Call on a schedule (e.g. every 5 min
   * via cron — see server.ts) rather than per-request, since ping() is a real network
   * call for most providers.
   */
  async runHealthCheckSweep(): Promise<{ checked: number; recovered: number }> {
    const unhealthy = Array.from(this.providers.values()).filter(p => !p.isHealthy);
    let recovered = 0;
    for (const p of unhealthy) {
      if (!p.provider.ping) continue; // no ping support — can't verify, leave as-is
      try {
        const ok = await p.provider.ping();
        if (ok) {
          this.reportSuccess(p.id);
          recovered++;
          console.log(`[ProviderRegistry] ✅ ${p.id} recovered via health-check sweep`);
        }
      } catch {
        // still unhealthy — no action needed, already excluded
      }
    }
    return { checked: unhealthy.length, recovered };
  }

  /** Health summary for Admin UI */
  getHealthSummary() {
    const all = Array.from(this.providers.values());
    return {
      total: all.length,
      healthy: all.filter(p => p.isHealthy).length,
      unhealthy: all.filter(p => !p.isHealthy).length,
      providers: all.map(p => ({
        id: p.id,
        isHealthy: p.isHealthy,
        tier: p.capabilities.costTier,
        intelligence: p.capabilities.intelligence,
        failureCount: p.failureCount,
        description: p.capabilities.description,
      })),
    };
  }
}

export const GlobalProviderRegistry = new ProviderRegistry();
