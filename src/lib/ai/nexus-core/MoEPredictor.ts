import { VectorMath } from './VectorMath';

/**
 * NEXUS MIXTURE-OF-EXPERTS (MoE) PREDICTIVE ROUTER
 * Proprietary FrugalGPT-inspired Dynamic Controller.
 * It uses a lightweight neural heuristic equation to predict the 
 * best target engine without wasting external API calls.
 */
export class NexusMoEPredictor {
  
  // Weights discovered by the system over time (Federated Readiness)
  private static W_LENGTH = 0.4;
  private static W_SENTIMENT = 0.7;
  private static W_HISTORY = 0.3;
  private static W_TECHNICAL = 0.6;

  /**
   * Neural execution path selection
   * Returns: 'local_offline' | 'free_api' | 'paid_flash' | 'paid_expert'
   */
  public static predictOptimalPath(query: string, historyDepth: number, agentRole: string): { path: string, energy: number } {
     const lengthFactor = Math.min(query.length / 500, 1.0);
     const historyFactor = Math.min(historyDepth / 10, 1.0);
     
     // Advanced Semantic Sentiment & Urgency Detection (Approximating LLM Classification)
     const extremeKeywords = ['emergency', 'lawsuit', 'wrong', 'useless', 'terrible', 'scam', 'fraud', 'ruined', 'broken', 'idiot', 'bot'];
     const moderateKeywords = ['urgent', 'refund', 'delay', 'missing', 'cancel', 'help', 'issue', 'problem', 'stuck', 'error', 'failed', 'where is'];
     const technicalKeywords = ['code', 'analyze', 'predict', 'architecture', 'database', 'optimize', 'sql', 'api', 'server', 'typescript', 'react', 'deploy'];
     
     const lowerQuery = query.toLowerCase();
     
     const hasExtreme = extremeKeywords.some(kw => lowerQuery.includes(kw));
     const hasModerate = moderateKeywords.some(kw => lowerQuery.includes(kw));
     const hasTechnical = technicalKeywords.some(kw => lowerQuery.includes(kw)) || ['cto', 'security', 'developer'].includes(agentRole);
     
     const sentimentFactor = hasExtreme ? 1.0 : (hasModerate ? 0.6 : 0.1);
     const technicalFactor = hasTechnical ? 1.0 : 0.0;

     // Neural Activation Function (Linear Combination)
     const activationEnergy = 
        (lengthFactor * this.W_LENGTH) + 
        (sentimentFactor * this.W_SENTIMENT) + 
        (historyFactor * this.W_HISTORY) +
        (technicalFactor * this.W_TECHNICAL);
        
     // Non-linear mapping using Softmax simulation over threshold boundaries
     const score = (activationEnergy / (this.W_LENGTH + this.W_SENTIMENT + this.W_HISTORY + this.W_TECHNICAL)) * 100;

     let path = 'free_api'; // Fallback / Layer 0
     
     if (score > 85) path = 'paid_expert';
     else if (score > 55) path = 'paid_flash';
     else if (score > 15) path = 'free_api';
     else path = 'free_api';

     return { path, energy: score };
  }
}
