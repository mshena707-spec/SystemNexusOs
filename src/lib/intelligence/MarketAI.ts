import { NexusUnifiedCore } from '../core/NexusUnifiedCore';

export class MarketAI {
  static async analyzeTrends(category: string): Promise<string[]> {
    const prompt = `What are the top 3 high-demand e-commerce products in the ${category} category right now? Output as a plain comma-separated list.`;
    const response = await NexusUnifiedCore.process(prompt, { agentRole: 'master_analytics' });
    return response.text.split(',').map(s => s.trim());
  }
}
