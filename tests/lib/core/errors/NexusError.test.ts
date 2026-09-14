import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NexusError, NexusErrorCodes, nexusErrorHandler } from '../../../../src/lib/core/errors/NexusError';

describe('NexusError', () => {
  it('applies sensible defaults for recovery/notify based on severity', () => {
    const critical = new NexusError(NexusErrorCodes.security.TENANT_ISOLATION_VIOLATION, {
      domain: 'security',
      severity: 'critical',
    });
    expect(critical.recovery).toBe('fail');
    expect(critical.notify).toBe('alert-owner');
    expect(critical.retryable).toBe(false);

    const low = new NexusError('SOME_MINOR_ISSUE', { domain: 'analytics', severity: 'low' });
    expect(low.recovery).toBe('ignore');
    expect(low.notify).toBe('none');
  });

  it('explicit options override the severity-based defaults', () => {
    const err = new NexusError(NexusErrorCodes.payments.PROVIDER_UNAVAILABLE, {
      domain: 'payments',
      severity: 'high',
      recovery: 'fallback',
      retryable: true,
    });
    expect(err.recovery).toBe('fallback');
    expect(err.retryable).toBe(true);
  });

  it('toClientResponse never leaks internal context, cause, or stack', () => {
    const err = new NexusError(NexusErrorCodes.database.QUERY_FAILED, {
      domain: 'database',
      severity: 'high',
      userMessage: 'We could not load your data. Please retry.',
      context: { internalConnectionString: 'postgres://secret@host/db' },
      cause: new Error('ECONNREFUSED'),
    });
    const client = err.toClientResponse();
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(client.error.message).toBe('We could not load your data. Please retry.');
  });

  it('toLogObject preserves context and cause for internal debugging', () => {
    const cause = new Error('ECONNREFUSED');
    const err = new NexusError(NexusErrorCodes.database.QUERY_FAILED, {
      domain: 'database',
      severity: 'high',
      context: { table: 'orders' },
      cause,
    });
    const logObj = err.toLogObject();
    expect(logObj.context).toEqual({ table: 'orders' });
    expect(logObj.cause).toBe('ECONNREFUSED');
  });
});

describe('nexusErrorHandler (Express middleware)', () => {
  function mockRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('returns 400 for a non-retryable, non-critical NexusError', () => {
    const res = mockRes();
    const err = new NexusError(NexusErrorCodes.payments.DECLINED, {
      domain: 'payments',
      severity: 'medium',
      retryable: false,
    });
    nexusErrorHandler(err, { path: '/api/orders' }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 503 for a retryable NexusError', () => {
    const res = mockRes();
    const err = new NexusError(NexusErrorCodes.ai.PROVIDER_UNHEALTHY, {
      domain: 'ai',
      severity: 'medium',
      retryable: true,
    });
    nexusErrorHandler(err, { path: '/api/chat' }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 500 for a critical NexusError', () => {
    const res = mockRes();
    const err = new NexusError(NexusErrorCodes.security.TENANT_ISOLATION_VIOLATION, {
      domain: 'security',
      severity: 'critical',
    });
    nexusErrorHandler(err, { path: '/api/admin/finance' }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('falls back to a generic 500 for a plain, un-migrated Error (no regression during migration)', () => {
    const res = mockRes();
    nexusErrorHandler(new Error('legacy failure'), { path: '/api/legacy' }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INTERNAL_ERROR' }) })
    );
  });
});
