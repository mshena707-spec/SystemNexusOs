import { z } from 'zod';
import { TraceTracker } from '../observability/Telemetry';

export type AITier = 'local_offline' | 'free_api' | 'paid_api';

// Enterprise standard Zod schema for strict runtime validation
export const AIRequestSchema = z.object({
  prompt: z.string().min(1).max(5000),
  history: z.array(z.any()).optional(), // keeping any for legacy compat, but structured in adapters
  images: z.array(z.string()).optional(),
  agentRole: z.string().default('customer'),
  userId: z.string().optional(),
  userRole: z.string().optional(),
  systemInstruction: z.string().optional(),
  trace: z.any().optional(), // Telemetry tracker
  onChunk: z.any().optional() // Streaming callback
});

export type AIRequest = z.infer<typeof AIRequestSchema>;

export interface AIResponse {
  text: string;
  tierUsed: AITier;
  costEstimate: number;
  confidence: number;
  processingTimeMs: number;
  modelName: string;
}
