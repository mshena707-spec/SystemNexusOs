import { AIRequest } from '../types';
import { ActionClassifier } from './ActionClassifier';

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export class RiskEngine {
  static evaluate(request: AIRequest): { level: RiskLevel; score: number; flags: string[] } {
    let score = 0;
    const flags: string[] = [];
    const text = request.prompt.toLowerCase();

    // 1. Check for dangerous keywords (SQLi, Command Injection, System overrides)
    const criticalPatterns = [
      /drop\s+table/i, /rm\s+-rf/i, /ignore\s+previous\s+instructions/i,
      /system\s+prompt/i, /bypass/i, /delete\s+from/i, /truncate\s+table/i
    ];
    
    for (const pattern of criticalPatterns) {
      if (pattern.test(text)) {
        score += 100;
        flags.push(`Critical pattern matched: ${pattern.source}`);
      }
    }

    // 2. Check for high-risk actions
    const highRiskWords = ['delete', 'execute', 'send', 'transfer', 'grant', 'admin', 'root'];
    let highRiskCount = 0;
    for (const word of highRiskWords) {
      if (text.includes(word)) highRiskCount++;
    }
    if (highRiskCount > 0) {
      score += highRiskCount * 20;
      flags.push(`High risk keywords found: ${highRiskCount}`);
    }

    // 3. Action Classification Input
    const actionClass = ActionClassifier.classify(request);
    if (actionClass.riskLevel === 'CRITICAL') {
      score += 100;
      flags.push(`Critical action intent detected: ${actionClass.actionType}`);
    } else if (actionClass.riskLevel === 'HIGH') {
      score += 60;
      flags.push(`High risk action intent detected: ${actionClass.actionType}`);
    } else if (actionClass.riskLevel === 'MEDIUM') {
      score += 20;
    }

    // 4. Determine Level
    let level = RiskLevel.LOW;
    if (score >= 100) level = RiskLevel.CRITICAL;
    else if (score >= 60) level = RiskLevel.HIGH;
    else if (score >= 20) level = RiskLevel.MEDIUM;

    return { level, score, flags };
  }
}
