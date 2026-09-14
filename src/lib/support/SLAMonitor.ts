/**
 * SLAMonitor — Support Response Time Tracking & Auto-Escalation
 */
import { NexusDB } from '../database/NexusDB';
import { EventBus } from '../core/events/NexusEventBus';

export type SLATier = 'urgent' | 'high' | 'medium' | 'low';

const SLA_TARGETS_MINUTES: Record<SLATier, number> = {
  urgent: 5, high: 30, medium: 120, low: 1440,
};

export interface SLARecord {
  conversationId: string; userId: string; channel: string; tier: SLATier;
  firstMessageAt: string; firstResponseAt?: string; resolvedAt?: string;
  responseTimeMs?: number; resolutionTimeMs?: number; slaTargetMinutes: number;
  slaMet?: boolean; breachedAt?: string; assignedAgent?: string;
  escalations: number; status: 'open' | 'responded' | 'resolved' | 'breached';
}

export class SLAMonitor {
  private static readonly COL = 'sla_records';

  static async startTimer(conversationId: string, userId: string, channel: string, content: string): Promise<void> {
    const existing = await NexusDB.get(this.COL, conversationId);
    if (existing) return;
    const tier = this.classifyTier(content);
    const targetMinutes = SLA_TARGETS_MINUTES[tier];
    await NexusDB.set(this.COL, conversationId, {
      conversationId, userId, channel, tier, firstMessageAt: new Date().toISOString(),
      slaTargetMinutes: targetMinutes, escalations: 0, status: 'open',
    });
    setTimeout(() => this.checkBreach(conversationId), targetMinutes * 60_000);
    setTimeout(() => this.sendWarning(conversationId), targetMinutes * 60_000 * 0.7);
  }

  static async recordResponse(conversationId: string, agentId: string): Promise<void> {
    const record = await NexusDB.get(this.COL, conversationId) as SLARecord | null;
    if (!record || record.firstResponseAt) return;
    const now = new Date();
    const responseTimeMs = now.getTime() - new Date(record.firstMessageAt).getTime();
    const slaMet = responseTimeMs <= record.slaTargetMinutes * 60_000;
    await NexusDB.update(this.COL, conversationId, {
      firstResponseAt: now.toISOString(), responseTimeMs, slaMet,
      assignedAgent: agentId, status: 'responded',
    });
    EventBus.emit('sla.responded', { conversationId, tier: record.tier, responseTimeMs, slaMet, agentId });
  }

  static async markResolved(conversationId: string): Promise<void> {
    const record = await NexusDB.get(this.COL, conversationId) as SLARecord | null;
    if (!record) return;
    const now = new Date();
    await NexusDB.update(this.COL, conversationId, {
      resolvedAt: now.toISOString(),
      resolutionTimeMs: now.getTime() - new Date(record.firstMessageAt).getTime(),
      status: 'resolved',
    });
  }

  private static async checkBreach(conversationId: string): Promise<void> {
    const record = await NexusDB.get(this.COL, conversationId) as SLARecord | null;
    if (!record || record.firstResponseAt || record.status === 'resolved') return;
    await NexusDB.update(this.COL, conversationId, {
      status: 'breached', breachedAt: new Date().toISOString(),
      escalations: record.escalations + 1,
    });
    EventBus.emit('sla.breached', {
      conversationId, userId: record.userId, tier: record.tier,
      channel: record.channel, minutesElapsed: record.slaTargetMinutes,
    });
    setTimeout(() => this.checkBreach(conversationId), 15 * 60_000);
  }

  private static async sendWarning(conversationId: string): Promise<void> {
    const record = await NexusDB.get(this.COL, conversationId) as SLARecord | null;
    if (!record || record.firstResponseAt || record.status === 'resolved') return;
    EventBus.emit('sla.warning', {
      conversationId, tier: record.tier, channel: record.channel,
      minutesRemaining: Math.round(record.slaTargetMinutes * 0.3),
    });
  }

  private static classifyTier(content: string): SLATier {
    const lower = content.toLowerCase();
    if (['payment failed','charged twice','fraud','hacked','urgent','emergency'].some(k => lower.includes(k))) return 'urgent';
    if (['not received','wrong item','refund','broken','damaged'].some(k => lower.includes(k))) return 'high';
    if (['question','how to','tracking','status','when will'].some(k => lower.includes(k))) return 'medium';
    return 'low';
  }

  static async getStats(since?: Date): Promise<{ total: number; metSLA: number; breached: number; avgResponseMs: number }> {
    const all = await NexusDB.find(this.COL, { orderBy: 'firstMessageAt', orderDir: 'desc', limit: 5000 }) as unknown as SLARecord[];
    const filtered = since ? all.filter(r => new Date(r.firstMessageAt) >= since) : all;
    const responded = filtered.filter(r => r.firstResponseAt);
    return {
      total: filtered.length,
      metSLA: responded.filter(r => r.slaMet).length,
      breached: filtered.filter(r => r.status === 'breached').length,
      avgResponseMs: responded.length ? responded.reduce((a, r) => a + (r.responseTimeMs ?? 0), 0) / responded.length : 0,
    };
  }
}
