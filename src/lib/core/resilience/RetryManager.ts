/**
 * Enterprise Retry Manager (Phase G)
 * Wraps any async operation with exponential backoff and jitter.
 */
export class RetryManager {
  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await operation();
      } catch (error) {
        attempt++;
        if (attempt > maxRetries) {
          console.error(`[RetryManager] Exhausted all ${maxRetries} retries. Throwing.`);
          throw error;
        }
        // Exponential backoff with up to 500ms of random jitter to avoid thundering herd issues
        const jitter = Math.random() * 500;
        const delay = (baseDelayMs * Math.pow(2, attempt - 1)) + jitter;
        
        console.warn(`[RetryManager] Action failed. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error("Unreachable retry state");
  }
}
