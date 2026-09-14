export interface TelemetryEvent {
  id: string;
  eventType: 'ai_inference' | 'db_transaction' | 'system_error' | 'user_action' | 'channel_msg' | 'system_boot';
  durationMs: number;
  success: boolean;
  metadata: any;
  timestamp: number;
}

/**
 * Enterprise Metrics Engine (Phase J)
 * Global real-time event tracker for the dashboard.
 */
export class MetricsEngine {
  private events: TelemetryEvent[] = [];

  constructor() {
    this.track({
        eventType: 'system_boot',
        durationMs: 0,
        success: true,
        metadata: { startup: true }
    });
  }

  track(event: Omit<TelemetryEvent, 'id' | 'timestamp'>) {
    const fullEvent: TelemetryEvent = {
      ...event,
      id: Math.random().toString(36).substring(2, 15),
      timestamp: Date.now()
    };
    
    this.events.push(fullEvent);
    
    // Rotating memory buffer to prevent memory leaks (keep last 5000)
    if (this.events.length > 5000) {
      this.events = this.events.slice(-1000); 
    }

    // Emit event to update React dashboards in real-time
    if (typeof window !== 'undefined') {
       window.dispatchEvent(new CustomEvent('nexus_metrics_update'));
    }
  }

  getRecent(limit: number = 50) {
    return [...this.events].reverse().slice(0, limit);
  }

  getMetricsSummary() {
    const aiEvents = this.events.filter(e => e.eventType === 'ai_inference');
    const totalAiTime = aiEvents.reduce((acc, curr) => acc + curr.durationMs, 0);
    const avgAiResponse = aiEvents.length > 0 ? (totalAiTime / aiEvents.length).toFixed(2) : '0.00';
    
    const dbEvents = this.events.filter(e => e.eventType === 'db_transaction');
    const msgEvents = this.events.filter(e => e.eventType === 'channel_msg');

    return {
      totalEvents: this.events.length,
      aiRequests: aiEvents.length,
      avgAiResponseMs: avgAiResponse,
      dbOperations: dbEvents.length,
      messagesProcessed: msgEvents.length,
      errors: this.events.filter(e => e.eventType === 'system_error').length,
    };
  }
}

// Singleton global instance
export const GlobalMetrics = new MetricsEngine();
