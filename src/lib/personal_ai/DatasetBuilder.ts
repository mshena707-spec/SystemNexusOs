/**
 * PHASE: PERSONAL AI BRAIN SYSTEM
 * Converts raw interaction logs into training datasets.
 */
import { InteractionRecord } from './DataCollector';

export class DatasetBuilder {
  static buildJSONL(records: InteractionRecord[]): string {
    return records.map(record => {
      const trainingObject = {
        instruction: record.prompt,
        response: record.final_answer
      };
      return JSON.stringify(trainingObject);
    }).join('\\n');
  }
}
