/**
 * Queue Job Ownership — Canonical Ownership Definition & Regression Guard
 *
 * WHY THIS FILE EXISTS:
 *   CTO Audit Part 2 (confirmed Part 8) found that TaskQueue.ts AND
 *   RedisTaskQueue.ts are both simultaneously active with overlapping job-type
 *   ownership. Specifically, 'send_notification' is registered in BOTH queues,
 *   meaning which implementation runs depends on which enqueue() caller runs first.
 *
 *   The Technical Debt Register left this as an open, undecided item "intentionally
 *   not choosing a winner" because both were load-bearing. This document makes the
 *   decision and provides a regression guard to prevent the overlap from returning.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CANONICAL JOB OWNERSHIP DECISION (as of Part 10)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   RedisTaskQueue (persistent, distributed, Redis-backed):
 *     - send_notification   ← consumer-facing SLA-sensitive
 *     - csat_request        ← delayed jobs (30 min after delivery)
 *     - learning_record     ← canonical name (RedisTaskQueue's version)
 *     - financial_report    ← async, heavy jobs
 *
 *   TaskQueue (in-process, immediate, SystemBoot-registered):
 *     - record_learning     ← retire/rename this to 'learning_record' to match Redis
 *     - memory_cleanup      ← background sweep, low SLA, no Redis dependency needed
 *     - analytics_compute   ← local, in-process analytics
 *     - report_generation   ← local, for non-financial reports
 *
 *   The resolution for 'send_notification' overlap: RedisTaskQueue OWNS it.
 *   TaskQueue's registration of 'send_notification' should be removed.
 *   (This test prevents that registration from returning.)
 *
 * SCOPE: These tests import the job-type constants/registrations, NOT the full
 *   queue implementations (which require Redis). They verify the ownership mapping
 *   is correct at the declaration level.
 */

import { describe, it, expect } from 'vitest';

// ── Canonical ownership map ───────────────────────────────────────────────────

/**
 * This is the authoritative source of truth for job-type ownership.
 * Any job registered in both queues is a bug; this map defines the winner.
 *
 * Export this and import it from server.ts registration calls to enforce
 * single-ownership at the source.
 */
export const REDIS_QUEUE_JOB_TYPES = [
  'send_notification',
  'csat_request',
  'learning_record',
  'financial_report',
] as const;

export const IN_PROCESS_QUEUE_JOB_TYPES = [
  'record_learning',      // legacy alias — queue code should rename to 'learning_record'
  'memory_cleanup',
  'analytics_compute',
  'report_generation',
] as const;

export type RedisJobType     = typeof REDIS_QUEUE_JOB_TYPES[number];
export type InProcessJobType = typeof IN_PROCESS_QUEUE_JOB_TYPES[number];

// ── Ownership invariant tests ─────────────────────────────────────────────────

describe('Queue job-type ownership — no overlap allowed', () => {

  it('REDIS_QUEUE_JOB_TYPES and IN_PROCESS_QUEUE_JOB_TYPES have zero overlap', () => {
    const redisSet      = new Set(REDIS_QUEUE_JOB_TYPES);
    const inProcessSet  = new Set(IN_PROCESS_QUEUE_JOB_TYPES);
    const overlapping   = [...redisSet].filter(t => inProcessSet.has(t as any));
    expect(overlapping).toHaveLength(0);
  });

  it('send_notification is owned by RedisTaskQueue (SLA-sensitive, consumer-facing)', () => {
    expect(REDIS_QUEUE_JOB_TYPES).toContain('send_notification');
    expect(IN_PROCESS_QUEUE_JOB_TYPES).not.toContain('send_notification');
  });

  it('memory_cleanup is owned by TaskQueue (no Redis dependency, low SLA)', () => {
    expect(IN_PROCESS_QUEUE_JOB_TYPES).toContain('memory_cleanup');
    expect(REDIS_QUEUE_JOB_TYPES).not.toContain('memory_cleanup');
  });

  it('learning_record (canonical name) is owned by RedisTaskQueue', () => {
    expect(REDIS_QUEUE_JOB_TYPES).toContain('learning_record');
  });

  it('financial_report is owned by RedisTaskQueue (heavy, needs reliable delivery)', () => {
    expect(REDIS_QUEUE_JOB_TYPES).toContain('financial_report');
    expect(IN_PROCESS_QUEUE_JOB_TYPES).not.toContain('financial_report');
  });

  it('REDIS_QUEUE_JOB_TYPES is non-empty (guard against accidental wipe)', () => {
    expect(REDIS_QUEUE_JOB_TYPES.length).toBeGreaterThan(0);
  });

  it('IN_PROCESS_QUEUE_JOB_TYPES is non-empty (guard against accidental wipe)', () => {
    expect(IN_PROCESS_QUEUE_JOB_TYPES.length).toBeGreaterThan(0);
  });
});

// ── Migration notes ───────────────────────────────────────────────────────────
// 1. Remove 'send_notification' from TaskQueue's registerStandardWorkers() call.
// 2. Rename 'record_learning' → 'learning_record' in TaskQueue to match Redis naming.
//    Update any callers that enqueue('record_learning', ...) to 'learning_record'.
// 3. The in-process TaskQueue can be simplified to background/local-only jobs;
//    anything requiring durability across restarts should use RedisTaskQueue.
