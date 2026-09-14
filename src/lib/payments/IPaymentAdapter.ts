/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  PAYMENT ADAPTER LAYER — Phase F                                     ║
 * ║                                                                      ║
 * ║  Unified interface for ALL payment providers.                       ║
 * ║  Adding a new provider (e.g. SSLCommerz, Aamarpay) only requires    ║
 * ║  implementing this interface and registering in PaymentRegistry.    ║
 * ║                                                                      ║
 * ║  Business logic NEVER calls BkashAdapter/NagadAdapter/Stripe        ║
 * ║  directly. All payment operations go through PaymentRegistry.       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export type PaymentProvider = 'stripe' | 'bkash' | 'nagad' | 'rocket';
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'processing' | 'refunded' | 'partially_refunded' | 'cancelled';
export type Currency = 'BDT' | 'USD';

export interface CreatePaymentRequest {
  orderId: string;
  amount: number;          // in major currency unit (e.g. 100.50 BDT, not paisa)
  currency: Currency;
  callbackUrl: string;
  description?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface CreatePaymentResult {
  success: boolean;
  redirectUrl?: string;     // hosted checkout URL — caller redirects user here
  providerRef?: string;     // provider's internal payment/transaction reference
  error?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  transactionId?: string;   // bank/provider settlement transaction ID
  amount?: number;
  currency?: Currency;
  status: PaymentStatus;
  error?: string;
}

export interface RefundRequest {
  providerRef: string;      // payment/transaction reference from CreatePaymentResult or verify
  transactionId?: string;   // settlement transaction ID (required by some providers)
  amount: number;           // partial or full refund amount
  currency: Currency;
  orderId: string;
  reason: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;        // provider's refund reference
  status: 'completed' | 'pending' | 'failed';  // 'pending' = async settlement (e.g. mobile banking)
  error?: string;
}

export interface QueryPaymentResult {
  found: boolean;
  status?: PaymentStatus;
  transactionId?: string;
  amount?: number;
}

/**
 * Every payment provider adapter implements this interface.
 */
export interface IPaymentAdapter {
  readonly providerId: PaymentProvider;
  readonly supportedCurrencies: Currency[];
  readonly settlementDelayDays: number;  // 0 = instant (cards), 1-3 = mobile banking

  isConfigured(): boolean;
  createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult>;
  verifyPayment(providerRef: string): Promise<VerifyPaymentResult>;
  queryPayment(providerRef: string): Promise<QueryPaymentResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
}
