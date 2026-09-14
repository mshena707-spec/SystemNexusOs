/**
 * PHASE 25: MEMORY RANKING SYSTEM
 * Determines memory priority based on success rate, frequency of use, and recency.
 */
import { InteractionRecord } from './DataCollector';

export class MemoryRanker {
  static rank(record: InteractionRecord, usageFrequency: number): number {
    const now = Date.now();
    const ageInDays = (now - record.timestamp) / (1000 * 60 * 60 * 24);
    
    // Decay factor (older memories decay slightly unless frequently used)
    const recencyMultiplier = Math.max(0.1, 1 - (ageInDays * 0.01));
    
    // Frequency factor (caps at 2x boost)
    const frequencyMultiplier = Math.min(2.0, 1 + (usageFrequency * 0.1));
    
    const score = record.success_score * frequencyMultiplier * recencyMultiplier;
    
    return score;
  }

  static sortMemories(records: { record: InteractionRecord, frequency: number }[]): InteractionRecord[] {
    return records
      .map(item => ({ r: item.record, score: this.rank(item.record, item.frequency) }))
      .sort((a, b) => b.score - a.score)
      .map(item => item.r);
  }
}
