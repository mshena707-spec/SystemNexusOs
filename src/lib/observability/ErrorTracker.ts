/**
 * PHASE 44: ERROR MONITORING SYSTEM
 * Tracks real-time issues, failed AI responses, crashes, API failures.
 */
import { SystemObserver } from './SystemObserver';

export class ErrorTracker {
  static logError(context: string, error: any) {
    SystemObserver.log('error', context, error?.message || 'Unknown Error', { error });
    // In production, this pipes to Sentry or Datadog
  }

  static logAIFailure(provider: string, prompt: string) {
    SystemObserver.log('error', 'AI_Failure', `Model ${provider} failed to respond.`, { prompt });
  }

  static trackSystemCrash(reason: string) {
    SystemObserver.log('critical', 'SystemCrash', `Fatal Crash: ${reason}`);
  }
}
