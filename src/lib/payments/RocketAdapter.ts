import { SecretVault } from '../security/vault/SecretVault';
/**
 * ROCKET (DBBL Mobile Banking) PAYMENT ADAPTER - Phase F
 * Implements Rocket Merchant API (Dutch-Bangla Bank Mobile Banking)
 *
 * Rocket does not publish a fully open developer portal like bKash/Nagad;
 * merchants integrate via DBBL's Merchant Payment Gateway (MPG), which is
 * a hosted-checkout, redirect-based flow similar to a standard PGW.
 *
 * Required env vars:
 *   ROCKET_MERCHANT_ID
 *   ROCKET_MERCHANT_PASSWORD
 *   ROCKET_STORE_ID
 *   ROCKET_BASE_URL
 *     sandbox: https://rocket.com.bd/sandbox/mpg
 *     prod:    https://rocket.com.bd/mpg
 *
 * Flow (hosted checkout, mirrors bKash/Nagad pattern used in Phase A):
 *   1. createPayment() -> POST /initiate -> returns redirect URL
 *   2. User completes payment on Rocket-hosted page
 *   3. Rocket redirects to our /api/payment/rocket/callback with txnId + status
 *   4. verifyPayment() -> POST /verify -> confirms transaction server-side
 */

interface RocketTokenCache {
  token: string;
  expiresAt: number;
}

let _tokenCache: RocketTokenCache | null = null;

async function getRocketToken(): Promise<string> {
  const base = process.env.ROCKET_BASE_URL!;
  const merchantId = process.env.ROCKET_MERCHANT_ID!;
  const password = SecretVault.get('ROCKET_MERCHANT_PASSWORD', { caller: 'system', module: 'RocketAdapter' });

  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.token;
  }

  const res = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchantId, password }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Rocket auth failed: ${data.message ?? 'unknown error'}`);

  _tokenCache = { token: data.token, expiresAt: Date.now() + (data.expiresIn ?? 3600) * 1000 };
  return _tokenCache.token;
}

export class RocketAdapter {
  static isConfigured(): boolean {
    return !!(process.env.ROCKET_MERCHANT_ID && SecretVault.get('ROCKET_MERCHANT_PASSWORD', { caller: 'system', module: 'RocketAdapter' }) &&
              process.env.ROCKET_STORE_ID && process.env.ROCKET_BASE_URL);
  }

  /**
   * Step 1: Initiate a Rocket payment — returns hosted checkout URL.
   */
  static async createPayment(
    orderId: string,
    amountBDT: number,
    callbackUrl: string
  ): Promise<{ success: boolean; redirectUrl?: string; txnId?: string; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: 'Rocket credentials not configured' };
    try {
      const base = process.env.ROCKET_BASE_URL!;
      const token = await getRocketToken();

      const res = await fetch(`${base}/payment/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          storeId: process.env.ROCKET_STORE_ID,
          merchantTxnId: orderId,
          amount: amountBDT.toFixed(2),
          currency: 'BDT',
          callbackUrl,
          description: `Order ${orderId}`,
        }),
      });
      const data = await res.json();
      if (!data.redirectUrl) return { success: false, error: data.message ?? 'Rocket initiate failed' };
      return { success: true, redirectUrl: data.redirectUrl, txnId: data.txnId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Step 2: Verify payment after user completes Rocket-hosted checkout.
   */
  static async verifyPayment(txnId: string): Promise<{ success: boolean; transactionId?: string; amount?: string; status?: string; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: 'Rocket not configured' };
    try {
      const base = process.env.ROCKET_BASE_URL!;
      const token = await getRocketToken();

      const res = await fetch(`${base}/payment/verify/${txnId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.status !== 'COMPLETED' && data.status !== 'SUCCESS') {
        return { success: false, error: `Rocket verify status: ${data.status ?? 'unknown'}` };
      }
      return { success: true, transactionId: data.bankTxnId ?? data.txnId, amount: data.amount, status: data.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Query payment status (for reconciliation, webhook-less polling).
   */
  static async queryPayment(txnId: string): Promise<{ status: string; bankTxnId?: string; amount?: string } | null> {
    if (!this.isConfigured()) return null;
    try {
      const base = process.env.ROCKET_BASE_URL!;
      const token = await getRocketToken();
      const res = await fetch(`${base}/payment/status/${txnId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      return { status: data.status, bankTxnId: data.bankTxnId, amount: data.amount };
    } catch { return null; }
  }

  /**
   * Refund a Rocket transaction.
   * Note: DBBL mobile banking refunds typically require a manual back-office
   * process via the merchant portal. This call submits a refund REQUEST;
   * actual settlement may take 1-3 business days and should be reconciled
   * via ReconciliationEngine.
   */
  static async refund(txnId: string, amountBDT: number, orderId: string, reason: string): Promise<{ success: boolean; refundRequestId?: string; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: 'Rocket not configured' };
    try {
      const base = process.env.ROCKET_BASE_URL!;
      const token = await getRocketToken();
      const res = await fetch(`${base}/payment/refund-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ txnId, amount: amountBDT.toFixed(2), merchantTxnId: orderId, reason }),
      });
      const data = await res.json();
      if (!data.refundRequestId) return { success: false, error: data.message ?? 'Rocket refund request failed' };
      return { success: true, refundRequestId: data.refundRequestId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
