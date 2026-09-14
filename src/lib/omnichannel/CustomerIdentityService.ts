/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CUSTOMER IDENTITY SERVICE — Phase G                                 ║
 * ║                                                                      ║
 * ║  Resolves a customer's identity across all channels into a single   ║
 * ║  unified customer profile.                                          ║
 * ║                                                                      ║
 * ║  Problem: A customer messages on WhatsApp ("wa_8801XXXXXXXXX"),      ║
 * ║  then later on Telegram ("tg_123456789"), then logs into the web    ║
 * ║  app with email. Without identity resolution, these are 3 separate  ║
 * ║  "customers" with no shared history.                                ║
 * ║                                                                      ║
 * ║  Solution: a `customer_identities` collection mapping every          ║
 * ║  channel-specific ID to one canonical `customerId`.                  ║
 * ║                                                                      ║
 * ║  Resolution strategies (in priority order):                          ║
 * ║   1. Exact channel ID match (returning customer on same channel)     ║
 * ║   2. Phone number match (WhatsApp/Rocket/bKash/Nagad all use phone)  ║
 * ║   3. Email match (web account, Facebook, email channel)              ║
 * ║   4. New customer — create canonical ID, link this channel           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import type { PlatformType } from '../integrations/OmniConnector';

export interface ChannelIdentity {
  platform: PlatformType;
  channelId: string;       // e.g. "wa_8801712345678", "tg_123456789", "user_abc123" (Firebase uid)
  displayName?: string;
  phone?: string;          // normalized E.164: +8801XXXXXXXXX
  email?: string;
  linkedAt: string;
}

export interface CustomerIdentity {
  customerId: string;       // canonical ID — generated once, never changes
  channels: ChannelIdentity[];
  primaryPhone?: string;
  primaryEmail?: string;
  displayName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastActivePlatform?: PlatformType;
  segments?: string[];      // marketing segments (Phase I will populate)
}

/** Normalize phone number to E.164-ish format for matching. */
function normalizePhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  let p = phone.replace(/[\s\-()]/g, '');
  if (p.startsWith('01')) p = '+880' + p.slice(1);          // Bangladeshi local -> intl
  if (p.startsWith('880') && !p.startsWith('+')) p = '+' + p;
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

export class CustomerIdentityService {

  /**
   * Resolve (or create) a canonical customer identity for an inbound message.
   * Returns the `customerId` to use for memory, preferences, order history, etc.
   */
  static async resolve(input: {
    platform: PlatformType;
    channelId: string;       // e.g. "wa_8801712345678"
    displayName?: string;
    phone?: string;
    email?: string;
  }): Promise<CustomerIdentity> {
    const { NexusDB } = await import('../database/NexusDB');
    const normalizedPhone = normalizePhone(input.phone);

    // ── Strategy 1: Exact channel ID match ────────────────────────────
    // array-contains on nested objects is unreliable across Firestore/
    // PostgreSQL/MongoDB adapters, so we scan recent identities and filter
    // client-side. customer_identities is expected to stay in the
    // thousands, not millions, so this is acceptable for Phase G.
    const candidates = await NexusDB.find('customer_identities', { limit: 1000 }) as CustomerIdentity[];
    let existing = candidates.find(c =>
      c.channels?.some(ch => ch.platform === input.platform && ch.channelId === input.channelId)
    );

    if (existing) {
      await this._touchLastSeen(existing.customerId, input.platform);
      return existing;
    }

    // ── Strategy 2: Phone number match ─────────────────────────────────
    if (normalizedPhone) {
      const byPhone = await NexusDB.find('customer_identities', {
        where: [{ field: 'primaryPhone', op: '==', value: normalizedPhone }],
        limit: 1,
      }) as CustomerIdentity[];
      if (byPhone.length > 0) {
        await this._linkChannel(byPhone[0].customerId, input, normalizedPhone);
        return (await NexusDB.get('customer_identities', byPhone[0].customerId)) as unknown as CustomerIdentity;
      }
    }

    // ── Strategy 3: Email match ──────────────────────────────────────────
    if (input.email) {
      const byEmail = await NexusDB.find('customer_identities', {
        where: [{ field: 'primaryEmail', op: '==', value: input.email.toLowerCase() }],
        limit: 1,
      }) as CustomerIdentity[];
      if (byEmail.length > 0) {
        await this._linkChannel(byEmail[0].customerId, input, normalizedPhone);
        return (await NexusDB.get('customer_identities', byEmail[0].customerId)) as unknown as CustomerIdentity;
      }
    }

    // ── Strategy 4: New customer ─────────────────────────────────────────
    const customerId = `cust_${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
    const now = new Date().toISOString();
    const identity: CustomerIdentity = {
      customerId,
      channels: [{
        platform: input.platform, channelId: input.channelId,
        displayName: input.displayName, phone: normalizedPhone, email: input.email?.toLowerCase(),
        linkedAt: now,
      }],
      primaryPhone: normalizedPhone,
      primaryEmail: input.email?.toLowerCase(),
      displayName: input.displayName,
      firstSeenAt: now,
      lastSeenAt: now,
      lastActivePlatform: input.platform,
    };
    await NexusDB.set('customer_identities', customerId, identity, true);
    return identity;
  }

  /**
   * Link an additional channel to an existing customer (e.g. customer who
   * messaged on WhatsApp now logs into the web app with the same phone).
   */
  private static async _linkChannel(
    customerId: string,
    input: { platform: PlatformType; channelId: string; displayName?: string; phone?: string; email?: string },
    normalizedPhone?: string,
  ): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    const existing = await NexusDB.get('customer_identities', customerId) as unknown as CustomerIdentity | null;
    if (!existing) return;

    const alreadyLinked = existing.channels?.some(ch => ch.platform === input.platform && ch.channelId === input.channelId);
    const channels = alreadyLinked ? existing.channels : [
      ...(existing.channels ?? []),
      { platform: input.platform, channelId: input.channelId, displayName: input.displayName, phone: normalizedPhone, email: input.email?.toLowerCase(), linkedAt: new Date().toISOString() },
    ];

    await NexusDB.update('customer_identities', customerId, {
      channels,
      lastSeenAt: new Date().toISOString(),
      lastActivePlatform: input.platform,
      ...(normalizedPhone && !existing.primaryPhone ? { primaryPhone: normalizedPhone } : {}),
      ...(input.email && !existing.primaryEmail ? { primaryEmail: input.email.toLowerCase() } : {}),
    });

    if (!alreadyLinked) {
      console.log(`[IdentityService] Linked ${input.platform}:${input.channelId} -> ${customerId}`);
    }
  }

  /** Update lastSeenAt / lastActivePlatform for a returning customer. */
  private static async _touchLastSeen(customerId: string, platform: PlatformType): Promise<void> {
    const { NexusDB } = await import('../database/NexusDB');
    await NexusDB.update('customer_identities', customerId, {
      lastSeenAt: new Date().toISOString(),
      lastActivePlatform: platform,
    });
  }

  /** Get a customer's full identity by canonical ID. */
  static async getById(customerId: string): Promise<CustomerIdentity | null> {
    const { NexusDB } = await import('../database/NexusDB');
    return (await NexusDB.get('customer_identities', customerId)) as unknown as CustomerIdentity | null;
  }

  /**
   * Manually merge two customer identities (admin-initiated, e.g. when a
   * customer reports "my orders are split across two accounts").
   * Merges channels, picks earliest firstSeenAt, keeps the `keepId` as canonical.
   */
  static async merge(keepId: string, mergeId: string): Promise<{ success: boolean; error?: string }> {
    if (keepId === mergeId) return { success: false, error: 'Cannot merge identity with itself' };
    const { NexusDB } = await import('../database/NexusDB');
    const keep  = await NexusDB.get('customer_identities', keepId)  as unknown as CustomerIdentity | null;
    const merge = await NexusDB.get('customer_identities', mergeId) as unknown as CustomerIdentity | null;
    if (!keep || !merge) return { success: false, error: 'One or both identities not found' };

    const mergedChannels = [
      ...keep.channels,
      ...merge.channels.filter(mc => !keep.channels.some(kc => kc.platform === mc.platform && kc.channelId === mc.channelId)),
    ];

    await NexusDB.update('customer_identities', keepId, {
      channels: mergedChannels,
      primaryPhone: keep.primaryPhone ?? merge.primaryPhone,
      primaryEmail: keep.primaryEmail ?? merge.primaryEmail,
      firstSeenAt: keep.firstSeenAt < merge.firstSeenAt ? keep.firstSeenAt : merge.firstSeenAt,
      mergedFrom: [...(keep as any).mergedFrom ?? [], mergeId],
    });

    // Re-point conversation sessions and orders from mergeId -> keepId
    const sessions = await NexusDB.find('conversation_sessions', { where: [{ field: 'userId', op: '==', value: mergeId }], limit: 1000 });
    for (const s of sessions) await NexusDB.update('conversation_sessions', (s as any).id, { userId: keepId, mergedFromCustomerId: mergeId });

    await NexusDB.delete('customer_identities', mergeId);
    return { success: true };
  }

  // ── Phase U: Confidence Scoring ────────────────────────────────────────
  /**
   * Score how likely a candidate CustomerIdentity is to match a set of
   * inbound signals. Returns 0.0–1.0.
   *
   * SCORE WEIGHTS:
   *   Exact channel ID match    → 1.0  (definitive, returned early in resolve())
   *   Exact phone match         → 0.85 (phone is a strong single identifier)
   *   Exact email match         → 0.80 (email is strong, but typos happen)
   *   Name similarity ≥ 0.8     → +0.10 bonus
   *   Name similarity 0.5–0.8   → +0.05 bonus
   *   Same platform             → +0.05 bonus
   *   Multiple weak signals     → additive, capped at 0.95 (never 1.0 for fuzzy)
   *
   * Used by resolveWithConfidence() to surface ambiguous matches for admin
   * review instead of silently creating a new identity or wrong-merging.
   */
  static scoreMatch(
    candidate: CustomerIdentity,
    input: { platform?: string; channelId?: string; phone?: string; email?: string; displayName?: string },
  ): number {
    const normalizedInputPhone = normalizePhone(input.phone);
    let score = 0;

    // Exact channel ID
    if (input.platform && input.channelId) {
      if (candidate.channels?.some(ch => ch.platform === input.platform && ch.channelId === input.channelId)) {
        return 1.0;
      }
    }

    // Phone match
    if (normalizedInputPhone && candidate.primaryPhone) {
      if (candidate.primaryPhone === normalizedInputPhone) {
        score = Math.max(score, 0.85);
      } else {
        // Partial phone: last 8 digits match (handles +880 vs 0 prefix variations)
        const a = normalizedInputPhone.replace(/\D/g, '').slice(-8);
        const b = candidate.primaryPhone.replace(/\D/g, '').slice(-8);
        if (a.length >= 7 && a === b) score = Math.max(score, 0.65);
      }
    }

    // Email match
    if (input.email && candidate.primaryEmail) {
      if (candidate.primaryEmail === input.email.toLowerCase()) {
        score = Math.max(score, 0.80);
      }
    }

    // Name similarity bonus (only additive, never primary signal)
    if (input.displayName && candidate.displayName && score > 0) {
      const sim = _nameSimilarity(input.displayName, candidate.displayName);
      if (sim >= 0.8) score = Math.min(0.95, score + 0.10);
      else if (sim >= 0.5) score = Math.min(0.95, score + 0.05);
    }

    // Same platform bonus
    if (input.platform && score > 0) {
      if (candidate.channels?.some(ch => ch.platform === input.platform)) {
        score = Math.min(0.95, score + 0.05);
      }
    }

    return Math.round(score * 100) / 100;
  }

  /**
   * Returns the top matching identities with confidence scores for a given
   * set of input signals. Scores below `minScore` (default 0.5) are excluded.
   * Results are sorted descending by score.
   *
   * Use case: admin deduplication UI, or before merge() to confirm the right
   * candidate.
   */
  static async findWithConfidence(
    input: { platform?: string; channelId?: string; phone?: string; email?: string; displayName?: string },
    opts: { limit?: number; minScore?: number } = {},
  ): Promise<Array<{ identity: CustomerIdentity; score: number; reason: string }>> {
    const { NexusDB } = await import('../database/NexusDB');
    const candidates = await NexusDB.find('customer_identities', { limit: 2000 }) as unknown as CustomerIdentity[];

    const scored = candidates
      .map(c => {
        const score = this.scoreMatch(c, input);
        const reasons: string[] = [];
        if (score === 1.0) reasons.push('exact channel match');
        else {
          if (score >= 0.80) reasons.push('phone/email match');
          if (score >= 0.65 && score < 0.80) reasons.push('partial phone match');
          if (input.displayName && candidate_name_matches(c.displayName, input.displayName)) reasons.push('similar name');
        }
        return { identity: c, score, reason: reasons.join(', ') || 'weak signals' };
      })
      .filter(r => r.score >= (opts.minScore ?? 0.5))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit ?? 10);

    return scored;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function candidate_name_matches(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return _nameSimilarity(a, b) >= 0.5;
}

/** Normalized Levenshtein-based name similarity 0.0–1.0. */
function _nameSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  return (maxLen - _levenshtein(s1, s2)) / maxLen;
}

function _levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

