/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  REFUND ENGINE — Phase F                                             ║
 * ║                                                                      ║
 * ║  Business-rule layer on top of PaymentRegistry.refund().            ║
 * ║  Validates eligibility, computes refund amount, handles partial      ║
 * ║  refunds, and tracks refund lifecycle (instant vs. async settlement) ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { PaymentRegistry } from './PaymentRegistry';
import type { PaymentProvider, RefundResult } from './IPaymentAdapter';

export interface RefundEligibility {
  eligible: boolean;
  reason?: string;
  maxRefundable: number;
  alreadyRefunded: number;
}

export interface RefundRequest {
  orderId: string;
  amount?: number;          // omit for full refund
  reason: string;
  requestedBy: string;       // userId or 'system'
}

const REFUND_WINDOW_DAYS = 14; // policy: refunds allowed within 14 days of payment

export class RefundEngine {

  /**
   * Check whether an order is eligible for refund and how much can be refunded.
   */
  static async checkEligibility(orderId: string): Promise<RefundEligibility> {
    const { NexusDB } = await import('../database/NexusDB');
    const payment = await NexusDB.get('payments', orderId);

    if (!payment) {
      return { eligible: false, reason: 'No payment record found', maxRefundable: 0, alreadyRefunded: 0 };
    }
    if (payment.status !== 'success' && payment.status !== 'partially_refunded') {
      return { eligible: false, reason: `Payment status is "${payment.status}" — only successful payments can be refunded`, maxRefundable: 0, alreadyRefunded: 0 };
    }

    const alreadyRefunded = payment.refundAmount ?? 0;
    const maxRefundable = (payment.amount ?? 0) - alreadyRefunded;

    if (maxRefundable <= 0) {
      return { eligible: false, reason: 'Order has already been fully refunded', maxRefundable: 0, alreadyRefunded };
    }

    // Time window check
    const paidAt = payment.verifiedAt ? new Date(payment.verifiedAt) : (payment.createdAt ? new Date(payment.createdAt) : null);
    if (paidAt) {
      const daysSince = (Date.now() - paidAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > REFUND_WINDOW_DAYS) {
        return { eligible: false, reason: `Refund window of ${REFUND_WINDOW_DAYS} days has expired (paid ${Math.floor(daysSince)} days ago)`, maxRefundable, alreadyRefunded };
      }
    }

    return { eligible: true, maxRefundable, alreadyRefunded };
  }

  /**
   * Process a refund. Validates eligibility, then delegates to PaymentRegistry.
   */
  static async processRefund(req: RefundRequest): Promise<{ success: boolean; result?: RefundResult; error?: string }> {
    const eligibility = await this.checkEligibility(req.orderId);
    if (!eligibility.eligible) {
      return { success: false, error: eligibility.reason };
    }

    const refundAmount = req.amount ?? eligibility.maxRefundable;
    if (refundAmount > eligibility.maxRefundable) {
      return { success: false, error: `Refund amount ${refundAmount} exceeds max refundable ${eligibility.maxRefundable}` };
    }
    if (refundAmount <= 0) {
      return { success: false, error: 'Refund amount must be positive' };
    }

    const { NexusDB } = await import('../database/NexusDB');
    const payment = await NexusDB.get('payments', req.orderId);
    if (!payment) return { success: false, error: 'Payment record not found' };

    const providerId = payment.provider as PaymentProvider;
    const providerRef = payment.providerRef ?? payment.bkashPaymentID ?? req.orderId;

    const result = await PaymentRegistry.refund(providerId, {
      providerRef,
      transactionId: payment.transactionId,
      amount: refundAmount,
      currency: payment.currency ?? 'BDT',
      orderId: req.orderId,
      reason: req.reason,
    });

    if (result.success) {
      // Track cumulative refund amount
      const newTotal = eligibility.alreadyRefunded + refundAmount;
      await NexusDB.update('payments', req.orderId, {
        refundAmount: newTotal,
        lastRefundReason: req.reason,
        lastRefundRequestedBy: req.requestedBy,
        lastRefundAt: new Date().toISOString(),
      });

      // Notify customer
      try {
        const { NotificationEngine } = await import('../notifications/NotificationEngine');
        await NotificationEngine.sendPush({
          userId: payment.userId ?? '',
          title: 'Refund Processed',
          body: result.status === 'pending'
            ? `Your refund of ${refundAmount} ${payment.currency ?? 'BDT'} has been requested and will settle within ${PaymentRegistry.get(providerId).settlementDelayDays} business day(s).`
            : `Your refund of ${refundAmount} ${payment.currency ?? 'BDT'} has been processed.`,
        });
      } catch { /* non-blocking */ }
    }

    return { success: result.success, result, error: result.error };
  }

  /**
   * Get pending (async/manual) refunds awaiting settlement confirmation.
   * Used by ReconciliationEngine.
   */
  static async getPendingRefunds(): Promise<Array<Record<string, any>>> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.find('payments', {
      where: [{ field: 'refundStatus', op: '==', value: 'pending' }],
      limit: 200,
    });
  }
}
