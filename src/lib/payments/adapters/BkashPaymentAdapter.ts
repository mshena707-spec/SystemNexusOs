/**
 * BKASH ADAPTER (wraps BkashAdapter in IPaymentAdapter) — Phase F
 */
import type {
  IPaymentAdapter, CreatePaymentRequest, CreatePaymentResult,
  VerifyPaymentResult, QueryPaymentResult, RefundRequest, RefundResult, Currency,
} from '../IPaymentAdapter';
import { BkashAdapter } from '../BkashAdapter';

export class BkashPaymentAdapter implements IPaymentAdapter {
  readonly providerId = 'bkash' as const;
  readonly supportedCurrencies: Currency[] = ['BDT'];
  readonly settlementDelayDays = 1; // mobile banking — T+1 settlement typical

  isConfigured(): boolean { return BkashAdapter.isConfigured(); }

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const result = await BkashAdapter.createPayment(req.orderId, req.amount, req.callbackUrl);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, redirectUrl: result.bkashURL, providerRef: result.paymentID };
  }

  async verifyPayment(providerRef: string): Promise<VerifyPaymentResult> {
    const result = await BkashAdapter.executePayment(providerRef);
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
    const result = await BkashAdapter.queryPayment(providerRef);
    if (!result) return { found: false };
    const status = /complete|success/i.test(result.status) ? 'success' :
                    /fail/i.test(result.status) ? 'failed' : 'pending';
    return { found: true, status, transactionId: result.trxID };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    if (!req.transactionId) return { success: false, status: 'failed', error: 'transactionId (trxID) required for bKash refund' };
    const result = await BkashAdapter.refund(req.providerRef, req.transactionId, req.amount, req.orderId);
    if (!result.success) return { success: false, status: 'failed', error: result.error };
    // bKash refunds settle async — treat as pending until reconciled
    return { success: true, status: 'pending' };
  }
}
