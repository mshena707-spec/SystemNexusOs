/**
 * RedisTaskQueue — Persistent task queue using Redis (replaces in-memory Map)
 *
 * BEFORE: TaskQueue used in-memory Map — lost on restart, no distribution.
 * AFTER:  Redis List-based queue → persists across restarts, works across
 *         multiple server instances.
 *
 * Falls back to existing InMemoryTaskQueue if Redis unavailable.
 * Auto-detects Upstash Redis (free 10K commands/day) or self-hosted.
 *
 * Redis data structures:
 *   nexus:queue:{name}        → Redis LIST (LPUSH / BRPOP)
 *   nexus:job:{id}            → Redis HASH (job metadata, status)
 *   nexus:deadletter:{name}   → Redis LIST (failed jobs)
 *   nexus:schedule:{name}     → Redis ZSET (scheduled jobs by timestamp)
 */

import { EventEmitter } from 'events';
import { logger } from '../core/logging/NexusLogger';

export interface Job<T = unknown> {
  id: string;
  queue: string;
  type: string;
  payload: T;
  priority: number;      // 0 (low) to 10 (critical)
  maxAttempts: number;
  attempts: number;
  status: 'pending' | 'running' | 'done' | 'failed' | 'dead';
  createdAt: string;
  scheduledAt?: string;  // ISO string for delayed jobs
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: unknown;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<unknown>;

export class RedisTaskQueue extends EventEmitter {
  private static instance: RedisTaskQueue | null = null;
  private redis: Record<string, (...args: unknown[]) => unknown> | null = null;
  private handlers = new Map<string, JobHandler>();
  private workers = new Map<string, NodeJS.Timeout>();
  private running = false;
  private readonly log = logger.child('RedisTaskQueue');

  // In-memory fallback
  private memQueue = new Map<string, Job[]>();
  private usingRedis = false;

  private constructor() {
    super();
    this.setMaxListeners(200);
  }

  static getInstance(): RedisTaskQueue {
    if (!RedisTaskQueue.instance) {
      RedisTaskQueue.instance = new RedisTaskQueue();
    }
    return RedisTaskQueue.instance;
  }

  async initialize(): Promise<void> {
    await this.connectRedis();
    this.running = true;
    this.log.info(this.usingRedis
      ? '✅ Redis task queue initialized (persistent, distributed)'
      : '⚠️  In-memory task queue (data lost on restart — set REDIS_URL for persistence)'
    );
  }

  private async connectRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
    if (!redisUrl) return;

    try {
      const { createClient } = await import('redis');
      const client = createClient({
        url: redisUrl,
        socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 5000) },
      });

      await client.connect();
      client.on('error', (err: Error) => {
        this.log.warn('Redis error (falling back to memory):', { error: err.message });
        this.usingRedis = false;
      });
      client.on('reconnecting', () => this.log.info('Redis reconnecting...'));
      client.on('ready', () => { this.usingRedis = true; });

      this.redis = client as unknown as typeof this.redis;
      this.usingRedis = true;
    } catch (err) {
      this.log.warn('Redis connection failed, using in-memory fallback:', { error: String(err).slice(0, 80) });
    }
  }

  // ── Register Handler ────────────────────────────────────────────────────

  register<T>(jobType: string, handler: JobHandler<T>): void {
    this.handlers.set(jobType, handler as JobHandler);
    this.log.info(`Handler registered: ${jobType}`);
  }

  // ── Enqueue ─────────────────────────────────────────────────────────────

  async enqueue<T>(options: {
    queue?: string;
    type: string;
    payload: T;
    priority?: number;
    maxAttempts?: number;
    delayMs?: number;
  }): Promise<string> {
    const job: Job<T> = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      queue: options.queue || 'default',
      type: options.type,
      payload: options.payload,
      priority: options.priority ?? 5,
      maxAttempts: options.maxAttempts ?? 3,
      attempts: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      scheduledAt: options.delayMs
        ? new Date(Date.now() + options.delayMs).toISOString()
        : undefined,
    };

    if (this.usingRedis && this.redis) {
      await this.enqueueRedis(job);
    } else {
      this.enqueueMemory(job);
    }

    this.emit('job:enqueued', { id: job.id, type: job.type, queue: job.queue });
    return job.id;
  }

  private async enqueueRedis<T>(job: Job<T>): Promise<void> {
    const r = this.redis!;
    const jobStr = JSON.stringify(job);

    if (job.scheduledAt) {
      // Delayed job → sorted set
      const score = new Date(job.scheduledAt).getTime();
      await r.zAdd(`nexus:schedule:${job.queue}`, { score, value: job.id } as never);
    } else {
      // Immediate job → list (LPUSH for LIFO by priority)
      const key = `nexus:queue:${job.queue}`;
      if (job.priority >= 8) {
        await r.lPush(key, jobStr); // high priority → front
      } else {
        await r.rPush(key, jobStr); // normal → back
      }
    }

    // Store job metadata
    await r.setEx(`nexus:job:${job.id}`, 86400, jobStr); // 24h TTL
  }

  private enqueueMemory<T>(job: Job<T>): void {
    if (!this.memQueue.has(job.queue)) {
      this.memQueue.set(job.queue, []);
    }
    const queue = this.memQueue.get(job.queue)!;

    // Sort by priority (higher first)
    const insertAt = queue.findIndex(j => j.priority < job.priority);
    if (insertAt === -1) {
      queue.push(job as Job);
    } else {
      queue.splice(insertAt, 0, job as Job);
    }
  }

  // ── Worker Loop ─────────────────────────────────────────────────────────

  startWorker(queueName = 'default', concurrency = 2): void {
    if (this.workers.has(queueName)) return;

    const activeJobs = new Set<string>();

    const poll = async () => {
      if (!this.running) return;

      // Process scheduled delayed jobs
      if (this.usingRedis && this.redis) {
        await this.processScheduledJobs(queueName);
      }

      // Fill up to concurrency
      const slots = concurrency - activeJobs.size;
      for (let i = 0; i < slots; i++) {
        const job = await this.dequeue(queueName);
        if (!job) break;

        activeJobs.add(job.id);
        this.processJob(job)
          .finally(() => activeJobs.delete(job.id));
      }
    };

    const interval = setInterval(poll, 500);
    this.workers.set(queueName, interval);
    this.log.info(`Worker started for queue: ${queueName} (concurrency: ${concurrency})`);
  }

  private async processScheduledJobs(queueName: string): Promise<void> {
    if (!this.redis) return;
    const now = Date.now();
    const due = await this.redis.zRangeByScore(
      `nexus:schedule:${queueName}`, 0, now
    ) as string[];

    for (const jobId of due) {
      const jobStr = await this.redis.get(`nexus:job:${jobId}`) as string;
      if (jobStr) {
        const job = JSON.parse(jobStr) as Job;
        job.scheduledAt = undefined; // now immediate
        await this.redis.lPush(`nexus:queue:${queueName}`, JSON.stringify(job));
      }
      await this.redis.zRem(`nexus:schedule:${queueName}`, jobId);
    }
  }

  private async dequeue(queueName: string): Promise<Job | null> {
    if (this.usingRedis && this.redis) {
      const result = await this.redis.lPop(`nexus:queue:${queueName}`) as string | null;
      return result ? JSON.parse(result) : null;
    }

    const queue = this.memQueue.get(queueName);
    return queue?.shift() ?? null;
  }

  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);

    if (!handler) {
      this.log.warn(`No handler for job type: ${job.type}`);
      return;
    }

    job.status = 'running';
    job.attempts++;
    job.startedAt = new Date().toISOString();
    this.emit('job:started', { id: job.id, type: job.type });

    try {
      job.result = await handler(job);
      job.status = 'done';
      job.completedAt = new Date().toISOString();
      this.emit('job:completed', { id: job.id, type: job.type, result: job.result });

      // Update job in Redis
      if (this.usingRedis && this.redis) {
        await this.redis.setEx(`nexus:job:${job.id}`, 3600, JSON.stringify(job));
      }
    } catch (err) {
      job.error = String(err);
      this.log.error(`Job ${job.id} (${job.type}) failed:`, err);

      if (job.attempts < job.maxAttempts) {
        // Retry with exponential backoff
        const delayMs = Math.min(1000 * Math.pow(2, job.attempts), 30_000);
        job.status = 'pending';
        this.log.info(`Retrying job ${job.id} in ${delayMs}ms (attempt ${job.attempts}/${job.maxAttempts})`);
        setTimeout(() => {
          if (this.usingRedis && this.redis) {
            this.enqueueRedis(job).catch(() => this.enqueueMemory(job));
          } else {
            this.enqueueMemory(job);
          }
        }, delayMs);
      } else {
        // Dead letter
        job.status = 'dead';
        job.completedAt = new Date().toISOString();
        if (this.usingRedis && this.redis) {
          await this.redis.lPush(`nexus:deadletter:${job.queue}`, JSON.stringify(job));
          await this.redis.setEx(`nexus:job:${job.id}`, 86400 * 7, JSON.stringify(job)); // keep 7 days
        }
        this.emit('job:dead', { id: job.id, type: job.type, error: job.error });
      }
    }
  }

  // ── Status & Management ──────────────────────────────────────────────────

  async getJob(jobId: string): Promise<Job | null> {
    if (this.usingRedis && this.redis) {
      const str = await this.redis.get(`nexus:job:${jobId}`) as string | null;
      return str ? JSON.parse(str) : null;
    }
    for (const queue of this.memQueue.values()) {
      const job = queue.find(j => j.id === jobId);
      if (job) return job;
    }
    return null;
  }

  async getQueueLength(queueName = 'default'): Promise<number> {
    if (this.usingRedis && this.redis) {
      return this.redis.lLen(`nexus:queue:${queueName}`) as Promise<number>;
    }
    return this.memQueue.get(queueName)?.length ?? 0;
  }

  async getStats(): Promise<Record<string, unknown>> {
    const queues: Record<string, number> = {};
    const queueNames = ['default', 'ai', 'payments', 'notifications', 'email'];

    for (const name of queueNames) {
      queues[name] = await this.getQueueLength(name);
    }

    return {
      backend: this.usingRedis ? 'redis' : 'memory',
      queues,
      handlers: Array.from(this.handlers.keys()),
      workers: Array.from(this.workers.keys()),
    };
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const [name, interval] of this.workers.entries()) {
      clearInterval(interval);
      this.workers.delete(name);
    }
    if (this.redis) {
      await (this.redis as Record<string, () => Promise<void>>).quit?.();
    }
  }
}

export const taskQueue = RedisTaskQueue.getInstance();
export default taskQueue;
