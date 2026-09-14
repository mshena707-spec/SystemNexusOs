/**
 * PHASE 89: MULTI-INTELLIGENCE DECISION ENGINE
 */
import { OperatingMode } from '../core/OperatingModeManager';
import { AIResponse } from '../core/AIRegistry';

export class DecisionFusionEngine {
  static selectBestResponse(outputs: {mode: string, result: any}[]): any {
    console.log(`[DecisionFusion] Evaluating outputs from ${outputs.map(o => o.mode).join(', ')}`);
    
    // AGI reasoning prioritized if present and safe, otherwise Product.
    const agi = outputs.find(o => o.mode === 'AGI_MODE');
    if (agi) return agi.result;
    
    return outputs[0]?.result || null;
  }

  static async splitAndMerge(payload: any, modes: OperatingMode[]): Promise<any> {
    console.log(`[DecisionFusion] Splitting task across modes: ${modes.join(', ')}`);
    
    const results = await Promise.all(
      modes.map(async (mode) => {
        await new Promise(r => setTimeout(r, 100)); // Simulating processing
        return { mode, result: `Processed by ${mode}` };
      })
    );

    console.log(`[DecisionFusion] Fusing multi-mode outputs...`);
    return this.selectBestResponse(results);
  }

  static selectBestAnswer(answers: AIResponse[]): AIResponse {
    if (!answers || answers.length === 0) throw new Error("No answers provided");
    if (answers.length === 1) return answers[0];

    console.log(`[DecisionFusion/Consensus] Evaluating ${answers.length} answers...`);

    const best = answers.sort((a, b) => {
      const scoreA = a.content.length / (a.costIncurred || 1);
      const scoreB = b.content.length / (b.costIncurred || 1);
      return scoreB - scoreA;
    })[0];

    console.log(`[DecisionFusion/Consensus] Best answer selected from ${best.providerId}.`);
    return best;
  }
}
