/**
 * NAGAD ADAPTER (wraps NagadAdapter in IPaymentAdapter) — Phase F
 */
import type {
  IPaymentAdapter, CreatePaymentRequest, CreatePaymentResult,
  VerifyPaymentResult, QueryPaymentResult, RefundRequest, RefundResult, Currency,
} from '../IPaymentAdapter';
import { NagadAdapter } from '../NagadAdapter';

export class NagadPaymentAdapter implements IPaymentAdapter {
  readonly providerId = 'nagad' as const;
  readonly supportedCurrencies: Currency[] = ['BDT'];
  readonly settlementDelayDays = 1;

  isConfigured(): boolean { return NagadAdapter.isConfigured(); }

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const result = await NagadAdapter.initiatePayment(req.orderId, req.amount, req.callbackUrl);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, redirectUrl: result.callBackUrl, providerRef: req.orderId };
  }

  async verifyPayment(providerRef: string): Promise<VerifyPaymentResult> {
    const result = await NagadAdapter.verifyPayment(providerRef);
    if (!result.success) return { success: false, status: 'failed', error: result.error };
    return {
      success: true,
      transactionId: result.transactionId,
      amount: result.amount ? parseFloat(result.amount) : undefined,
      currency: 'BDT',
      status: 'success',
    };
  }

  async queryPayment(providerRef: string): Promise<QueryPaymentResult> {
    const result = await NagadAdapter.verifyPayment(providerRef);
    if (!result.success) return { found: false };
    return { found: true, status: 'success', transactionId: result.transactionId, amount: result.amount ? parseFloat(result.amount) : undefined };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    // Nagad does not expose a programmatic refund API for merchants;
    // refunds are processed manually via Nagad merchant portal / back-office.
    // We record the refund REQUEST for the ReconciliationEngine to track.
    return {
      success: true,
      status: 'pending',
      refundId: `NAGAD-MANUAL-${req.orderId}-${Date.now()}`,
    };
  }
}
