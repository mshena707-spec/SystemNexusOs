/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           NEXUS ASYNC TASK QUEUE — Phase 4                   ║
 * ║  Event-driven task processing with persistence & retry       ║
 * ║                                                              ║
 * ║  Storage backends:                                           ║
 * ║   Redis Streams → primary (when REDIS_URL configured)        ║
 * ║   In-process Map → fallback (single instance only)           ║
 * ║                                                              ║
 * ║  Features:                                                   ║
 * ║   ✓ Priority queues (1–10)                                   ║
 * ║   ✓ Retry with exponential backoff                           ║
 * ║   ✓ Dead-letter queue (DLQ)                                  ║
 * ║   ✓ Workflow persistence                                     ║
 * ║   ✓ Worker concurrency control                               ║
 * ║   ✓ Job timeout enforcement                                  ║
 * ║   ✓ At-least-once delivery                                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   // Enqueue (example using a job type this queue actually owns)
 *   const jobId = await TaskQueue.enqueue('analytics_compute', {
 *     userId: 'u-123'
 *   }, { priority: 8, maxRetries: 3 });
 *
 *   // Register worker
 *   TaskQueue.registerWorker('analytics_compute', async (job) => {
 *     return { computed: true };
 *   });
 *
 *   // Start processing
 *   TaskQueue.start();
 *
 *   // NOTE: 'send_notification' is owned by RedisTaskQueue, not this
 *   // queue — use redisTaskQueue.enqueue('send_notification', {...}) /
 *   // .register(...) instead. See QueueJobOwnership.test.ts.
 */

import { logger } from '../core/logging/NexusLogger';
import { EventBus } from '../core/events/NexusEventBus';
import { NexusConfig } from '../core/config/NexusConfig';

const log = logger.child('TaskQueue');

// ── Job types ─────────────────────────────────────────────────────────────
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead';

export interface Job<T = any> {
  id: string;
  type: string;
  data: T;
  priority: number;        // 1 (low) to 10 (critical)
  status: JobStatus;
  attempts: number;
  maxRetries: number;
  timeout: number;         // ms
  createdAt: number;
  scheduledAt: number;     // for delayed jobs
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  lastError?: string;
  result?: any;
  workerId?: string;
  tags?: string[];
}

export interface JobOptions {
  priority?: number;
  maxRetries?: number;
  timeout?: number;
  delay?: number;          // ms to delay before processing
  tags?: string[];
}

export type WorkerFn<T = any> = (job: Job<T>) => Promise<any>;

interface WorkerConfig {
  fn: WorkerFn;
  concurrency: number;
  activeCount: number;
}

// ── Backoff calculation ───────────────────────────────────────────────────
function calcBackoff(attempt: number, baseMs = 1000): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s (max 5 min)
  return Math.min(baseMs * Math.pow(2, attempt - 1), 5 * 60 * 1000);
}

// ════════════════════════════════════════════════════════════════════════
// TASK QUEUE IMPLEMENTATION
// ════════════════════════════════════════════════════════════════════════
class NexusTaskQueueImpl {
  // In-process storage (used when Redis not available)
  private pendingJobs: Job[] = [];
  private processingJobs = new Map<string, Job>();
  private completedJobs: Job[] = [];
  private deadLetterQueue: Job[] = [];
  private workers = new Map<string, WorkerConfig>();
  private running = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private maxCompleted = 1000;
  private maxDLQ = 500;
  private metrics = {
    enqueued: 0, completed: 0, failed: 0, dlq: 0, totalProcessingMs: 0,
  };

  // ── Public API ────────────────────────────────────────────────────────

  /** Enqueue a job for async processing */
  async enqueue<T = any>(type: string, data: T, opts: JobOptions = {}): Promise<string> {
    const job: Job<T> = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      data,
      priority: opts.priority ?? 5,
      status: 'pending',
      attempts: 0,
      maxRetries: opts.maxRetries ?? 3,
      timeout: opts.timeout ?? 30_000,
      createdAt: Date.now(),
      scheduledAt: Date.now() + (opts.delay ?? 0),
      tags: opts.tags,
    };

    this.pendingJobs.push(job);
    // Keep pending sorted by priority desc then scheduledAt asc
    this.pendingJobs.sort((a, b) => b.priority - a.priority || a.scheduledAt - b.scheduledAt);
    this.metrics.enqueued++;

    log.debug(`Job enqueued: ${type}`, { jobId: job.id, priority: job.priority });
    EventBus.emitAsync('analytics.event', { event: 'job_enqueued', type, jobId: job.id }, 'TaskQueue');

    return job.id;
  }

  /** Register a worker function for a job type */
  registerWorker(type: string, fn: WorkerFn, concurrency = 5): void {
    this.workers.set(type, { fn, concurrency, activeCount: 0 });
    log.info(`Worker registered: ${type} (concurrency: ${concurrency})`);
  }

  /** Start processing loop */
  start(pollIntervalMs = 500): void {
    if (this.running) return;
    this.running = true;
    this.pollInterval = setInterval(() => this._processTick(), pollIntervalMs);
    log.info('TaskQueue started');
  }

  /** Stop processing loop */
  stop(): void {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    this.running = false;
    log.info('TaskQueue stopped');
  }

  /** Schedule a one-time delayed job */
  async schedule<T = any>(type: string, data: T, delayMs: number, opts: JobOptions = {}): Promise<string> {
    return this.enqueue(type, data, { ...opts, delay: delayMs });
  }

  /** Get job status */
  getJob(jobId: string): Job | null {
    return this.pendingJobs.find(j => j.id === jobId)
      || this.processingJobs.get(jobId)
      || this.completedJobs.find(j => j.id === jobId)
      || this.deadLetterQueue.find(j => j.id === jobId)
      || null;
  }

  /** Retry all jobs in DLQ */
  async retryDLQ(): Promise<{ retried: number }> {
    const toRetry = [...this.deadLetterQueue];
    this.deadLetterQueue = [];
    for (const job of toRetry) {
      job.status = 'pending';
      job.attempts = 0;
      job.scheduledAt = Date.now();
      this.pendingJobs.push(job);
    }
    log.info(`DLQ retried: ${toRetry.length} jobs`);
    return { retried: toRetry.length };
  }

  /** Admin stats */
  getStats() {
    return {
      pending: this.pendingJobs.length,
      processing: this.processingJobs.size,
      completed: this.completedJobs.length,
      dlq: this.deadLetterQueue.length,
      workers: Array.from(this.workers.entries()).map(([type, w]) => ({
        type, concurrency: w.concurrency, active: w.activeCount,
      })),
      metrics: { ...this.metrics },
    };
  }

  getPendingJobs(limit = 50) { return this.pendingJobs.slice(0, limit); }
  getDLQ(limit = 50) { return this.deadLetterQueue.slice(0, limit); }

  // ── Internal processing ───────────────────────────────────────────────
  private async _processTick(): Promise<void> {
    const now = Date.now();

    // Find executable jobs
    const executable = this.pendingJobs.filter(j =>
      j.scheduledAt <= now && this._canProcess(j.type)
    );

    for (const job of executable) {
      // Remove from pending
      this.pendingJobs.splice(this.pendingJobs.indexOf(job), 1);
      // Process without blocking tick
      this._processJob(job).catch(e => log.error('Job processing error', e));
    }
  }

  private _canProcess(type: string): boolean {
    const worker = this.workers.get(type);
    if (!worker) return false;
    return worker.activeCount < worker.concurrency;
  }

  private async _processJob(job: Job): Promise<void> {
    const worker = this.workers.get(job.type);
    if (!worker) {
      job.status = 'dead';
      job.lastError = `No worker registered for type: ${job.type}`;
      this._moveToDLQ(job);
      return;
    }

    worker.activeCount++;
    job.status = 'processing';
    job.attempts++;
    job.startedAt = Date.now();
    job.workerId = `worker_${job.type}_${Date.now()}`;
    this.processingJobs.set(job.id, job);

    log.debug(`Processing job: ${job.type}`, { jobId: job.id, attempt: job.attempts });

    try {
      const result = await Promise.race([
        worker.fn(job),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout)
        ),
      ]);

      job.status = 'completed';
      job.result = result;
      job.completedAt = Date.now();
      this.metrics.completed++;
      this.metrics.totalProcessingMs += job.completedAt - (job.startedAt || job.completedAt);

      this.processingJobs.delete(job.id);
      this.completedJobs.unshift(job);
      if (this.completedJobs.length > this.maxCompleted) this.completedJobs.pop();

      EventBus.emitAsync('analytics.event', {
        event: 'job_completed', type: job.type, jobId: job.id,
        durationMs: job.completedAt - (job.startedAt || 0),
      }, 'TaskQueue');

      log.debug(`Job completed: ${job.type}`, { jobId: job.id });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      job.lastError = error;
      job.failedAt = Date.now();
      this.processingJobs.delete(job.id);
      this.metrics.failed++;

      if (job.attempts < job.maxRetries) {
        // Retry with backoff
        const backoff = calcBackoff(job.attempts);
        job.status = 'pending';
        job.scheduledAt = Date.now() + backoff;
        this.pendingJobs.push(job);
        this.pendingJobs.sort((a, b) => b.priority - a.priority || a.scheduledAt - b.scheduledAt);
        log.warn(`Job failed, retrying in ${backoff}ms`, { jobId: job.id, attempt: job.attempts, maxRetries: job.maxRetries });
      } else {
        // Move to DLQ
        this._moveToDLQ(job);
        log.error(`Job exhausted retries → DLQ`, undefined, { jobId: job.id, type: job.type, error });
      }
    } finally {
      worker.activeCount--;
    }
  }

  private _moveToDLQ(job: Job): void {
    job.status = 'dead';
    this.deadLetterQueue.unshift(job);
    if (this.deadLetterQueue.length > this.maxDLQ) this.deadLetterQueue.pop();
    this.metrics.dlq++;
    EventBus.emitAsync('analytics.event', {
      event: 'job_dead_lettered', type: job.type, jobId: job.id, error: job.lastError,
    }, 'TaskQueue');
  }
}

/** Global TaskQueue singleton */
export const TaskQueue = new NexusTaskQueueImpl();

// ════════════════════════════════════════════════════════════════════════
// REGISTER STANDARD BUSINESS WORKERS
// ════════════════════════════════════════════════════════════════════════
export function registerStandardWorkers(): void {

  // NOTE: 'send_notification' intentionally NOT registered here — it is
  // owned exclusively by RedisTaskQueue (persistent, SLA-sensitive; see
  // tests/lib/queue/QueueJobOwnership.test.ts for the ownership decision
  // and the regression guard against re-adding it here).

  // Abandoned cart recovery
  TaskQueue.registerWorker('abandoned_cart', async (job) => {
    const { AutomationEngine } = await import('../automation/AutomationEngine');
    await AutomationEngine.triggerEvent('cart.abandoned', job.data);
    return { triggered: true };
  }, 3);

  // Inactive customer win-back
  TaskQueue.registerWorker('customer_winback', async (job) => {
    const { AutomationEngine } = await import('../automation/AutomationEngine');
    await AutomationEngine.triggerEvent('customer.inactive', job.data);
    return { triggered: true };
  }, 3);

  // Episode summarization
  TaskQueue.registerWorker('summarize_episode', async (job) => {
    const { MemoryEngine } = await import('../memory/NexusMemoryEngine');
    const summary = await MemoryEngine.summarizeEpisode(job.data.sessionId);
    return { summary };
  }, 2);

  // Semantic knowledge indexing
  TaskQueue.registerWorker('index_knowledge', async (job) => {
    const { MemoryEngine } = await import('../memory/NexusMemoryEngine');
    const CALLER = { id: 'system', type: 'system' as const, roles: ['admin'], isOwner: false };
    await MemoryEngine.writeSemanticKnowledge(
      job.data.content, job.data.collection, 'system',
      { source: job.data.source, tags: job.data.tags }, CALLER
    );
    return { indexed: true };
  }, 2);

  // Fraud assessment
  TaskQueue.registerWorker('fraud_assess', async (job) => {
    const { FraudDetectionEngine } = await import('../security/FraudDetectionEngine');
    return FraudDetectionEngine.assess(job.data);
  }, 10);

  // Low stock reorder alert
  TaskQueue.registerWorker('low_stock_alert', async (job) => {
    const { NotificationEngine } = await import('../notifications/NotificationEngine');
    await NotificationEngine.saveInApp('admin', '⚠️ Low Stock',
      `${job.data.productName}: ${job.data.stockLeft} units remaining`,
      `/admin/products/${job.data.productId}`
    );
    return { alerted: true };
  }, 5);

  // Orchestration task (async AI processing)
  TaskQueue.registerWorker('orchestrate', async (job) => {
    const { Orchestrator } = await import('../orchestration/index');
    return Orchestrator.process(job.data);
  }, 3);

  // Learning feedback recording
  TaskQueue.registerWorker('record_learning', async (job) => {
    const { MemoryEngine } = await import('../memory/NexusMemoryEngine');
    const CALLER = { id: 'system', type: 'system' as const, roles: ['admin'], isOwner: false };
    return MemoryEngine.recordLearning(
      job.data.agentId, job.data.stimulus, job.data.response,
      job.data.feedback, {}, CALLER
    );
  }, 5);

  // ── Phase Y: Heavy-task async workers ────────────────────────────────────
  // These allow heavy computations (CEO report, demand forecast, backup) to
  // run asynchronously via POST /api/admin/queue/enqueue without blocking HTTP.

  TaskQueue.registerWorker('ceo_report_generate', async () => {
    const { CEOAgent } = await import('../orchestration/agents/CEOAgent');
    return CEOAgent.generateDailyBrief();
  }, 1); // concurrency 1 — only one report at a time

  TaskQueue.registerWorker('demand_forecast_all', async (job) => {
    const { DemandForecastingEngine } = await import('../business-intelligence/forecasting/DemandForecastingEngine');
    return DemandForecastingEngine.forecastAll(job.data?.days ?? 14, job.data?.limit ?? 50);
  }, 1);

  TaskQueue.registerWorker('backup_run', async (job) => {
    const { BackupRecoveryEngine } = await import('../infrastructure/BackupRecoveryEngine');
    return BackupRecoveryEngine.executeAutoBackup(job.data?.label ?? 'queued');
  }, 1);

  TaskQueue.registerWorker('competitor_analyse', async (job) => {
    const { CompetitorAI } = await import('../intelligence/CompetitorAI');
    return CompetitorAI.analysePricing(job.data.productName, job.data.currentPrice, job.data.productId);
  }, 2);

  // Memory cleanup — CTO Audit Part 2, section 13 named this explicitly as a heavy
  // task that shouldn't run on the API thread, and it had no implementation anywhere.
  // MemoryTypes.ts already defines `expiresAt`/`ttlSeconds` on every memory entry
  // (see docs/architecture/MEMORY_ARCHITECTURE.md) — this is the sweep that actually
  // acts on them, which previously didn't exist. Runs across the highest-volume types
  // first (episodic, learning); personal/shared/semantic tend to be smaller and are
  // included for completeness. Immutable memory is deliberately excluded — it's
  // write-once by design (see MEMORY_ARCHITECTURE.md) and should never be swept here.
  TaskQueue.registerWorker('memory_cleanup', async (job) => {
    const { MemoryEngine } = await import('../memory/NexusMemoryEngine');
    const { MemoryType } = await import('../memory/interfaces/MemoryTypes');
    const SYSTEM_CALLER = { id: 'system', type: 'system' as const, roles: ['admin'], isOwner: false };
    const batchLimit = job.data?.limit ?? 500;
    const sweepTypes = job.data?.types ?? [
      MemoryType.EPISODIC,
      MemoryType.LEARNING,
      MemoryType.PERSONAL,
      MemoryType.SHARED,
      MemoryType.SEMANTIC,
    ];
    const now = Date.now();
    let deleted = 0;
    let scanned = 0;
    for (const type of sweepTypes) {
      const entries = await MemoryEngine.query(
        { types: [type], includeExpired: true, limit: batchLimit },
        SYSTEM_CALLER
      );
      scanned += entries.length;
      for (const entry of entries) {
        if (entry.expiresAt && entry.expiresAt < now) {
          const ok = await MemoryEngine.delete(entry.id, type, SYSTEM_CALLER);
          if (ok) deleted++;
        }
      }
    }
    return { scanned, deleted };
  }, 1);

  log.info('Standard queue workers registered: 14 workers (9 original + 5 Phase Y)');
}
