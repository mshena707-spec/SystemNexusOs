/**
 * PaymentEngine — payment initiation and verification.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 * Supports: Stripe, bKash, Nagad, Rocket.
 */
import { NexusDB } from '../database/NexusDB';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('PaymentEngine');

export type PaymentProvider = 'stripe' | 'bkash' | 'nagad' | 'rocket';
export type PaymentStatus   = 'pending' | 'processing' | 'success' | 'failed' | 'refunded';

export interface PaymentTransaction {
  orderId:       string;
  provider:      PaymentProvider;
  amount:        number;
  currency:      string;
  status:        PaymentStatus;
  transactionId?: string;
  createdAt:     unknown;
  updatedAt:     unknown;
}

export class PaymentEngine {
  /** Persist a pending payment record and redirect to gateway */
  static async initiatePayment(
    orderId: string,
    provider: PaymentProvider,
    amount: number,
    currency = 'BDT',
  ): Promise<{ success: boolean; method?: string; url?: string; error?: string }> {
    try {
      // Persist payment record
      await NexusDB.set('payments', orderId, {
        orderId,
        provider,
        amount,
        currency,
        status: 'pending',
        createdAt: NexusDB.serverTimestamp(),
        updatedAt: NexusDB.serverTimestamp(),
      } satisfies PaymentTransaction);

      // Route to gateway
      const gatewayRoutes: Record<PaymentProvider, string> = {
        stripe: '/api/create-checkout-session',
        bkash:  '/api/payment/bkash/create',
        nagad:  '/api/payment/nagad/create',
        rocket: '/api/payment/rocket/create',
      };

      const stripeBody  = { items: [{ name: `Order ${orderId}`, price: amount / 100, quantity: 1 }], orderId };
      const mobileBody  = { orderId, amountBDT: amount };
      const body = provider === 'stripe' ? stripeBody : mobileBody;

      const res  = await fetch(gatewayRoutes[provider], {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json() as Record<string, unknown>;

      if (!data.success && provider !== 'stripe') {
        return { success: false, error: (data.error as string) ?? 'Gateway error' };
      }

      const url =
        (data.url as string) ??
        (data.bkashURL as string) ??
        (data.callBackUrl as string) ??
        '';

      return { success: true, method: 'redirect', url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('initiatePayment failed', { orderId, provider, error: msg });
      return { success: false, error: 'Payment initialization failed' };
    }
  }

  /**
   * Atomically verify payment and update order status.
   * Uses NexusDB.runTransaction() — idempotent (blocks double-payment).
   */
  static async verifyAndUpdatePayment(
    orderId: string,
    _provider: PaymentProvider,
    transactionId: string,
    status: PaymentStatus,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await NexusDB.runTransaction(async (tx) => {
        const payment = await tx.get('payments', orderId);
        if (!payment) throw new Error('Transaction not found');
        if (payment.status === 'success') throw new Error('Payment already verified');

        await tx.update('payments', orderId, {
          status,
          transactionId,
          updatedAt: NexusDB.serverTimestamp(),
        });

        if (status === 'success') {
          const order = await tx.get('orders', orderId);
          if (order) {
            await tx.update('orders', orderId, {
              status: 'Paid',
              paymentStatus: 'success',
              updatedAt: NexusDB.serverTimestamp(),
            });
          }
        }
      });

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('verifyAndUpdatePayment failed', { orderId, error: msg });
      return { success: false, error: msg };
    }
  }

  /** Get payment record */
  static async getPayment(orderId: string): Promise<PaymentTransaction | null> {
    try {
      return (await NexusDB.get('payments', orderId)) as PaymentTransaction | null;
    } catch {
      return null;
    }
  }
}
