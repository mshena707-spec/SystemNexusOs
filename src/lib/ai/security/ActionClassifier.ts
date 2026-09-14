import { AIRequest } from '../types';

export enum ActionRiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export class ActionClassifier {
  static classify(request: AIRequest): { actionType: string; riskLevel: ActionRiskLevel; requiresConfirmation: boolean } {
    const text = request.prompt.toLowerCase();
    
    if (text.includes('delete') || text.includes('remove') || text.includes('drop')) {
      return { actionType: 'delete', riskLevel: ActionRiskLevel.HIGH, requiresConfirmation: true };
    }
    if (text.includes('send') || text.includes('transfer') || text.includes('pay')) {
      return { actionType: 'send', riskLevel: ActionRiskLevel.MEDIUM, requiresConfirmation: true };
    }
    if (text.includes('override') || text.includes('bypass') || text.includes('system prompt')) {
      return { actionType: 'system_override', riskLevel: ActionRiskLevel.CRITICAL, requiresConfirmation: false };
    }
    if (text.includes('update') || text.includes('edit') || text.includes('modify')) {
      return { actionType: 'update', riskLevel: ActionRiskLevel.MEDIUM, requiresConfirmation: true };
    }
    
    return { actionType: 'read', riskLevel: ActionRiskLevel.LOW, requiresConfirmation: false };
  }
}
