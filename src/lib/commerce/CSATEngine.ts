/**
 * CSATEngine — Customer Satisfaction Scoring System
 * CSAT (1-5 stars) + NPS (0-10) + CES (1-5) + AI sentiment on comments
 */
import { NexusDB } from '../database/NexusDB';
import { NexusUnifiedCore } from '../core/NexusUnifiedCore';
import { EventBus } from '../core/events/NexusEventBus';

export interface CSATEntry {
  id: string; userId: string;
  type: 'order' | 'support' | 'return' | 'general';
  referenceId: string; rating: number;
  nps?: number; ces?: number; comment?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  sentimentScore?: number; tags?: string[];
  channel: string; createdAt: string;
}

export interface CSATSummary {
  totalResponses: number; csatScore: number; avgRating: number;
  npsScore: number; avgCES: number;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  ratingDistribution: Record<number, number>;
  topPositiveThemes: string[]; topNegativeThemes: string[];
  trend: 'improving' | 'stable' | 'declining';
}

export class CSATEngine {
  private static readonly COLLECTION = 'csat_responses';

  static async submit(data: {
    userId: string; type: CSATEntry['type']; referenceId: string;
    rating: number; nps?: number; ces?: number; comment?: string; channel?: string;
  }): Promise<{ id: string; analyzed: boolean }> {
    if (data.rating < 1 || data.rating > 5) throw new Error('Rating must be 1-5');

    let sentiment: CSATEntry['sentiment'] = data.rating >= 4 ? 'positive' : data.rating === 3 ? 'neutral' : 'negative';
    let sentimentScore = data.rating >= 4 ? 0.6 : data.rating === 3 ? 0 : -0.6;
    let tags: string[] = [];
    let analyzed = false;

    if (data.comment && data.comment.trim().length > 10) {
      try {
        const res = await NexusUnifiedCore.process(
          `Analyze feedback (rating ${data.rating}/5): "${data.comment.slice(0, 300)}"\nJSON only: {"sentiment":"positive"|"neutral"|"negative","score":-1.0to1.0,"tags":["max3tags"]}`,
          { agentRole: 'analyst', userId: 'csat_engine', systemInstruction: 'JSON only, no markdown.' }
        );
        const p = JSON.parse(res.text.replace(/```json?|```/g, '').trim());
        sentiment = p.sentiment || sentiment;
        sentimentScore = Math.max(-1, Math.min(1, p.score || sentimentScore));
        tags = Array.isArray(p.tags) ? p.tags.slice(0, 3) : [];
        analyzed = true;
      } catch { /* use rating-based sentiment */ }
    }

    const entry: CSATEntry = {
      id: `csat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: data.userId, type: data.type, referenceId: data.referenceId,
      rating: data.rating, nps: data.nps, ces: data.ces, comment: data.comment,
      sentiment, sentimentScore, tags, channel: data.channel || 'web',
      createdAt: new Date().toISOString(),
    };

    await NexusDB.set(this.COLLECTION, entry.id, entry as unknown as Record<string, unknown>);
    EventBus.emit('csat.submitted', { userId: data.userId, rating: data.rating, sentiment });
    if (data.rating <= 2 && sentiment === 'negative') {
      EventBus.emit('csat.alert', { severity: 'warning', userId: data.userId, rating: data.rating, type: data.type });
    }
    return { id: entry.id, analyzed };
  }

  static async getSummary(opts: { type?: CSATEntry['type']; since?: Date } = {}): Promise<CSATSummary> {
    const where = opts.type ? [{ field: 'type', op: '==' as const, value: opts.type }] : undefined;
    let entries = await NexusDB.find(this.COLLECTION, { where, orderBy: 'createdAt', orderDir: 'desc', limit: 1000 }) as unknown as CSATEntry[];
    if (opts.since) entries = entries.filter(e => new Date(e.createdAt) >= opts.since!);
    if (!entries.length) return { totalResponses: 0, csatScore: 0, avgRating: 0, npsScore: 0, avgCES: 0, sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 }, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, topPositiveThemes: [], topNegativeThemes: [], trend: 'stable' };

    const csatScore = Math.round(entries.filter(e => e.rating >= 4).length / entries.length * 100);
    const avgRating = Math.round(entries.reduce((a, e) => a + e.rating, 0) / entries.length * 10) / 10;
    const npsArr = entries.filter(e => e.nps !== undefined);
    const npsScore = npsArr.length ? Math.round((npsArr.filter(e => (e.nps ?? 0) >= 9).length - npsArr.filter(e => (e.nps ?? 0) <= 6).length) / npsArr.length * 100) : 0;
    const cesArr = entries.filter(e => e.ces !== undefined);
    const avgCES = cesArr.length ? Math.round(cesArr.reduce((a, e) => a + (e.ces ?? 0), 0) / cesArr.length * 10) / 10 : 0;
    const sb = { positive: 0, neutral: 0, negative: 0 };
    const rd: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const pt: Record<string, number> = {}, nt: Record<string, number> = {};
    for (const e of entries) {
      sb[e.sentiment || 'neutral']++;
      rd[Math.round(e.rating)]++;
      for (const t of e.tags || []) { (e.rating >= 4 ? pt : nt)[t] = ((e.rating >= 4 ? pt : nt)[t] || 0) + 1; }
    }
    const now = Date.now(), week = 604800000;
    const recent = entries.filter(e => now - new Date(e.createdAt).getTime() < week);
    const prev = entries.filter(e => { const a = now - new Date(e.createdAt).getTime(); return a >= week && a < 2 * week; });
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (recent.length >= 3 && prev.length >= 3) {
      const ra = recent.reduce((a, e) => a + e.rating, 0) / recent.length;
      const pa = prev.reduce((a, e) => a + e.rating, 0) / prev.length;
      trend = ra > pa + 0.2 ? 'improving' : ra < pa - 0.2 ? 'declining' : 'stable';
    }
    return { totalResponses: entries.length, csatScore, avgRating, npsScore, avgCES, sentimentBreakdown: sb, ratingDistribution: rd, topPositiveThemes: Object.entries(pt).sort(([,a],[,b])=>b-a).slice(0,3).map(([t])=>t), topNegativeThemes: Object.entries(nt).sort(([,a],[,b])=>b-a).slice(0,3).map(([t])=>t), trend };
  }
}
