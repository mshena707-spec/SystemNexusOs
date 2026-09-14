/**
 * NEXUS BUSINESS INTELLIGENCE — Public API
 * Phase 7: Analytics, Forecasting, Recommendations
 * Phase 10: Autonomous Evolution
 */

export { BIEngine } from './analytics/BIEngine';
export { RecommendationEngine } from './recommendations/RecommendationEngine';
export { EvolutionEngine } from './autonomy/AutonomousEvolutionEngine';

export type {
  RevenueMetrics, CustomerMetrics, RevenueForecast,
  CustomerScore, ProductInsight, DailyReport,
} from './analytics/BIEngine';

export type {
  ProductRecommendation,
} from './recommendations/RecommendationEngine';

export type {
  EvolutionProposal, LearningInsight,
  SystemEvolutionReport, ProposalStatus,
} from './autonomy/AutonomousEvolutionEngine';
