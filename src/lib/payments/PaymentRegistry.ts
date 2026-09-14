/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PAYMENT REGISTRY — Phase F                                          ║
 * ║                                                                      ║
 * ║  Central dispatcher for all payment operations.                     ║
 * ║  Business logic calls PaymentRegistry — never a specific adapter.   ║
 * ║                                                                      ║
 * ║  Adding a new provider (SSLCommerz, Aamarpay, PayPal, etc.):         ║
 * ║    1. Implement IPaymentAdapter                                      ║
 * ║    2. Register it in the constructor below                          ║
 * ║    3. No other code changes needed                                  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import type {
  IPaymentAdapter, PaymentProvider, CreatePaymentRequest, CreatePaymentResult,
  VerifyPaymentResult, QueryPaymentResult, RefundRequest, RefundResult, Currency,
} from './IPaymentAdapter';
import { StripePaymentAdapter } from './adapters/StripePaymentAdapter';
import { BkashPaymentAdapter }  from './adapters/BkashPaymentAdapter';
import { NagadPaymentAdapter }  from './adapters/NagadPaymentAdapter';
import { RocketPaymentAdapter } from './adapters/RocketPaymentAdapter';
import { PaymentAuditLog } from './PaymentAuditLog';

class PaymentRegistryClass {
  private adapters = new Map<PaymentProvider, IPaymentAdapter>();

  constructor() {
    this.register(new StripePaymentAdapter());
    this.register(new BkashPaymentAdapter());
    this.register(new NagadPaymentAdapter());
    this.register(new RocketPaymentAdapter());
  }

  register(adapter: IPaymentAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: PaymentProvider): IPaymentAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new Error(`[PaymentRegistry] Unknown provider: ${providerId}`);
    return adapter;
  }

  /** List all providers configured (have valid env vars) and ready to accept payments. */
  listConfigured(): Array<{ providerId: PaymentProvider; currencies: Currency[]; settlementDelayDays: number }> {
    return Array.from(this.adapters.values())
      .filter(a => a.isConfigured())
      .map(a => ({ providerId: a.providerId, currencies: a.supportedCurrencies, settlementDelayDays: a.settlementDelayDays }));
  }

  /** List ALL providers (configured or not) for admin diagnostics. */
  listAll(): Array<{ providerId: PaymentProvider; configured: boolean; currencies: Currency[]; settlementDelayDays: number }> {
    return Array.from(this.adapters.values())
      .map(a => ({ providerId: a.providerId, configured: a.isConfigured(), currencies: a.supportedCurrencies, settlementDelayDays: a.settlementDelayDays }));
  }

  // ──────────────────────────────────────────────────────────────────────
  // CREATE PAYMENT — initiates checkout, writes payment record + audit log
  // ──────────────────────────────────────────────────────────────────────
  async createPayment(providerId: PaymentProvider, req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const adapter = this.get(providerId);

    if (!adapter.isConfigured()) {
      await PaymentAuditLog.record({ orderId: req.orderId, provider: providerId, action: 'create', status: 'failed', detail: `${providerId} not configured` });
      return { success: false, error: `${providerId} is not configured` };
    }

    if (!adapter.supportedCurrencies.includes(req.currency)) {
      return { success: false, error: `${providerId} does not support ${req.currency}` };
    }

    const result = await adapter.createPayment(req);

    // Persist payment record via NexusDB (Phase E abstraction)
    try {
      const { NexusDB } = await import('../database/NexusDB');
      await NexusDB.set('payments', req.orderId, {
        orderId: req.orderId,
        provider: providerId,
        amount: req.amount,
        currency: req.currency,
        status: result.success ? 'pending' : 'failed',
        providerRef: result.providerRef ?? null,
        createdAt: new Date().toISOString(),
      }, true);
    } catch (err) {
      console.error('[PaymentRegistry] Failed to persist payment record:', err);
    }

    await PaymentAuditLog.record({
      orderId: req.orderId, provider: providerId, action: 'create',
      status: result.success ? 'success' : 'failed',
      detail: result.success ? `providerRef=${result.providerRef}` : result.error,
      amount: req.amount, currency: req.currency,
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────
  // VERIFY PAYMENT — confirms payment after redirect, updates order status
  // ──────────────────────────────────────────────────────────────────────
  async verifyPayment(providerId: PaymentProvider, providerRef: string, orderId: string): Promise<VerifyPaymentResult> {
    const adapter = this.get(providerId);
    const result = await adapter.verifyPayment(providerRef);

    try {
      const { NexusDB } = await import('../database/NexusDB');
      await NexusDB.update('payments', orderId, {
        status: result.status,
        transactionId: result.transactionId ?? null,
        verifiedAt: new Date().toISOString(),
      });

      if (result.status === 'success') {
        await NexusDB.update('orders', orderId, {
          status: 'Paid',
          paymentStatus: 'success',
        });
      }
    } catch (err) {
      console.error('[PaymentRegistry] Failed to update payment record after verify:', err);
    }

    await PaymentAuditLog.record({
      orderId, provider: providerId, action: 'verify',
      status: result.success ? 'success' : 'failed',
      detail: result.error ?? `transactionId=${result.transactionId}`,
      amount: result.amount, currency: result.currency,
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────
  // QUERY PAYMENT — for reconciliation, polling without state changes
  // ──────────────────────────────────────────────────────────────────────
  async queryPayment(providerId: PaymentProvider, providerRef: string): Promise<QueryPaymentResult> {
    return this.get(providerId).queryPayment(providerRef);
  }

  // ──────────────────────────────────────────────────────────────────────
  // REFUND — issues refund through correct provider, logs to audit
  // ──────────────────────────────────────────────────────────────────────
  async refund(providerId: PaymentProvider, req: RefundRequest): Promise<RefundResult> {
    const adapter = this.get(providerId);
    const result = await adapter.refund(req);

    try {
      const { NexusDB } = await import('../database/NexusDB');
      await NexusDB.update('payments', req.orderId, {
        status: result.status === 'completed' ? 'refunded' : 'partially_refunded',
        refundId: result.refundId ?? null,
        refundStatus: result.status,
        refundRequestedAt: new Date().toISOString(),
        refundAmount: req.amount,
      });

      if (result.success && result.status === 'completed') {
        await NexusDB.update('orders', req.orderId, { status: 'Refunded' });
      }
    } catch (err) {
      console.error('[PaymentRegistry] Failed to update payment record after refund:', err);
    }

    await PaymentAuditLog.record({
      orderId: req.orderId, provider: providerId, action: 'refund',
      status: result.success ? (result.status === 'pending' ? 'pending' : 'success') : 'failed',
      detail: result.error ?? `refundId=${result.refundId}, status=${result.status}, reason=${req.reason}`,
      amount: req.amount, currency: req.currency,
    });

    return result;
  }
}

/** Singleton — import this everywhere instead of specific adapters */
export const PaymentRegistry = new PaymentRegistryClass();
