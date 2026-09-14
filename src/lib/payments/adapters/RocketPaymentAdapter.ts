/**
 * ROCKET ADAPTER (wraps RocketAdapter in IPaymentAdapter) — Phase F
 */
import type {
  IPaymentAdapter, CreatePaymentRequest, CreatePaymentResult,
  VerifyPaymentResult, QueryPaymentResult, RefundRequest, RefundResult, Currency,
} from '../IPaymentAdapter';
import { RocketAdapter } from '../RocketAdapter';

export class RocketPaymentAdapter implements IPaymentAdapter {
  readonly providerId = 'rocket' as const;
  readonly supportedCurrencies: Currency[] = ['BDT'];
  readonly settlementDelayDays = 2; // DBBL mobile banking — T+2 typical

  isConfigured(): boolean { return RocketAdapter.isConfigured(); }

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const result = await RocketAdapter.createPayment(req.orderId, req.amount, req.callbackUrl);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, redirectUrl: result.redirectUrl, providerRef: result.txnId };
  }

  async verifyPayment(providerRef: string): Promise<VerifyPaymentResult> {
    const result = await RocketAdapter.verifyPayment(providerRef);
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
    const result = await RocketAdapter.queryPayment(providerRef);
    if (!result) return { found: false };
    const status = /complete|success/i.test(result.status) ? 'success' :
                    /fail/i.test(result.status) ? 'failed' : 'pending';
    return { found: true, status, transactionId: result.bankTxnId, amount: result.amount ? parseFloat(result.amount) : undefined };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const result = await RocketAdapter.refund(req.providerRef, req.amount, req.orderId, req.reason);
    if (!result.success) return { success: false, status: 'failed', error: result.error };
    return { success: true, status: 'pending', refundId: result.refundRequestId };
  }
}
