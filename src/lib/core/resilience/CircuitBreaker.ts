export enum CircuitState {
  CLOSED,   // Flowing normally
  OPEN,     // Tripped, failing fast
  HALF_OPEN // Testing recovery
}

/**
 * Enterprise Circuit Breaker Pattern
 * Protects downstream services (like AI APIs or DBs) from catastrophic cascade failures.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  
  constructor(
    private threshold: number = 5, 
    private resetTimeoutMs: number = 30000 // 30 seconds
  ) {}

  async execute<T>(action: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        // Time to test if the service is back
        this.state = CircuitState.HALF_OPEN;
        console.log(`[CircuitBreaker] Transitioning to HALF_OPEN to test service recovery.`);
      } else {
        // Still open, reject immediately or fallback
        if (fallback) return fallback();
        throw new Error("Circuit Breaker is OPEN. Service unavailable.");
      }
    }

    try {
      const result = await action();
      // If we were half open and it succeeded, reset completely.
      if (this.state === CircuitState.HALF_OPEN) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        console.log(`[CircuitBreaker] Service recovered. Transitioning to CLOSED.`);
      }
      return result;
    } catch (e) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.threshold) {
        this.state = CircuitState.OPEN;
        console.error(`[CircuitBreaker] Failure threshold reached (${this.failureCount}). Transitioning to OPEN.`);
      }
      
      if (fallback) return fallback();
      throw e;
    }
  }
}
