/**
 * STRIPE ADAPTER (wraps existing Stripe integration in IPaymentAdapter) — Phase F
 */
import { SecretVault } from '../../security/vault/SecretVault';
import type {
  IPaymentAdapter, CreatePaymentRequest, CreatePaymentResult,
  VerifyPaymentResult, QueryPaymentResult, RefundRequest, RefundResult, Currency,
} from '../IPaymentAdapter';

export class StripePaymentAdapter implements IPaymentAdapter {
  readonly providerId = 'stripe' as const;
  readonly supportedCurrencies: Currency[] = ['USD', 'BDT'];
  readonly settlementDelayDays = 0; // cards settle near-instantly to Stripe balance

  isConfigured(): boolean {
    return !!SecretVault.get('STRIPE_SECRET_KEY', { caller: 'system', module: 'StripePaymentAdapter' });
  }

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    if (!this.isConfigured()) return { success: false, error: 'Stripe not configured' };
    try {
      const stripeKey = SecretVault.get('STRIPE_SECRET_KEY', { caller: 'system', module: 'StripePaymentAdapter' })!;
      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(stripeKey);

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: req.currency.toLowerCase(),
            product_data: { name: req.description ?? `Order ${req.orderId}` },
            unit_amount: Math.round(req.amount * 100), // major unit -> minor unit (cents/poisha)
          },
          quantity: 1,
        }],
        success_url: `${req.callbackUrl}?status=success&orderId=${req.orderId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.callbackUrl}?status=cancel&orderId=${req.orderId}`,
        client_reference_id: req.orderId,
        customer_email: req.customerEmail,
      });

      return { success: true, redirectUrl: session.url ?? undefined, providerRef: session.id };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async verifyPayment(providerRef: string): Promise<VerifyPaymentResult> {
    if (!this.isConfigured()) return { success: false, status: 'failed', error: 'Stripe not configured' };
    try {
      const stripeKey = SecretVault.get('STRIPE_SECRET_KEY', { caller: 'system', module: 'StripePaymentAdapter' })!;
      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(providerRef);

      const status: VerifyPaymentResult['status'] =
        session.payment_status === 'paid' ? 'success' :
        session.status === 'expired' ? 'failed' : 'pending';

      return {
        success: status === 'success',
        transactionId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
        amount: (session.amount_total ?? 0) / 100,
        currency: (session.currency?.toUpperCase() as Currency) ?? 'USD',
        status,
      };
    } catch (err) {
      return { success: false, status: 'failed', error: (err as Error).message };
    }
  }

  async queryPayment(providerRef: string): Promise<QueryPaymentResult> {
    const result = await this.verifyPayment(providerRef);
    return { found: !result.error, status: result.status, transactionId: result.transactionId, amount: result.amount };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    if (!this.isConfigured()) return { success: false, status: 'failed', error: 'Stripe not configured' };
    try {
      const stripeKey = SecretVault.get('STRIPE_SECRET_KEY', { caller: 'system', module: 'StripePaymentAdapter' })!;
      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(stripeKey);

      // providerRef is the checkout session ID; resolve to payment_intent
      const session = await stripe.checkout.sessions.retrieve(req.providerRef);
      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (!piId) return { success: false, status: 'failed', error: 'No payment intent found for session' };

      const refund = await stripe.refunds.create({
        payment_intent: piId,
        amount: Math.round(req.amount * 100),
        reason: 'requested_by_customer',
        metadata: { orderId: req.orderId, reason: req.reason },
      });

      return {
        success: true,
        refundId: refund.id,
        status: refund.status === 'succeeded' ? 'completed' : refund.status === 'pending' ? 'pending' : 'failed',
      };
    } catch (err) {
      return { success: false, status: 'failed', error: (err as Error).message };
    }
  }
}
