/**
 * BKASH PAYMENT ADAPTER - Phase A/F
 * Implements bKash PGW v1.2.0-beta (Tokenized Checkout)
 *
 * Required env vars:
 *   BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD
 *   BKASH_BASE_URL (sandbox: https://tokenized.sandbox.bka.sh/v1.2.0-beta)
 */

interface BkashTokenCache {
  token: string;
  refreshToken: string;
  expiresAt: number;
}

let _tokenCache: BkashTokenCache | null = null;

async function getBkashToken(): Promise<string> {
  const base = process.env.BKASH_BASE_URL!;
  const appKey = SecretVault.get('BKASH_APP_KEY', { caller: 'system', module: 'BkashAdapter' })!;
  const appSecret = SecretVault.get('BKASH_APP_SECRET', { caller: 'system', module: 'BkashAdapter' })!;
  const username = process.env.BKASH_USERNAME!;
  const password = SecretVault.get('BKASH_PASSWORD', { caller: 'system', module: 'BkashAdapter' })!;

  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.token;
  }

  if (_tokenCache?.refreshToken) {
    try {
      const res = await fetch(`${base}/tokenized/checkout/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: _tokenCache.token, 'x-app-key': appKey },
        body: JSON.stringify({ app_key: appKey, app_secret: appSecret, refresh_token: _tokenCache.refreshToken }),
      });
      const data = await res.json();
      if (data.statusCode === '0000') {
        _tokenCache = { token: data.id_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
        return _tokenCache.token;
      }
    } catch { /* fall through */ }
  }

  const res = await fetch(`${base}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', username, password },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
  });
  const data = await res.json();
  if (data.statusCode !== '0000') throw new Error(`bKash token grant failed: ${data.statusMessage}`);
  _tokenCache = { token: data.id_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return _tokenCache.token;
}

import { SecretVault } from '../security/vault/SecretVault';
export class BkashAdapter {
  static isConfigured(): boolean {
    return !!(SecretVault.get('BKASH_APP_KEY', { caller: 'system', module: 'BkashAdapter' }) && process.env.BKASH_APP_SECRET && process.env.BKASH_USERNAME && process.env.BKASH_PASSWORD && process.env.BKASH_BASE_URL);
  }

  static async createPayment(orderId: string, amountBDT: number, callbackUrl: string): Promise<{ success: boolean; bkashURL?: string; paymentID?: string; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: 'bKash credentials not configured' };
    try {
      const base = process.env.BKASH_BASE_URL!;
      const token = await getBkashToken();
      const res = await fetch(`${base}/tokenized/checkout/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token, 'x-app-key': SecretVault.get('BKASH_APP_KEY', { caller: 'system', module: 'BkashAdapter' })! },
        body: JSON.stringify({ mode: '0011', payerReference: orderId, callbackURL: callbackUrl, amount: amountBDT.toFixed(2), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: orderId }),
      });
      const data = await res.json();
      if (data.statusCode !== '0000') return { success: false, error: data.statusMessage };
      return { success: true, bkashURL: data.bkashURL, paymentID: data.paymentID };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  static async executePayment(paymentID: string): Promise<{ success: boolean; transactionId?: string; customerMsisdn?: string; amount?: string; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: 'bKash not configured' };
    try {
      const base = process.env.BKASH_BASE_URL!;
      const token = await getBkashToken();
      const res = await fetch(`${base}/tokenized/checkout/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token, 'x-app-key': SecretVault.get('BKASH_APP_KEY', { caller: 'system', module: 'BkashAdapter' })! },
        body: JSON.stringify({ paymentID }),
      });
      const data = await res.json();
      if (data.statusCode !== '0000') return { success: false, error: data.statusMessage };
      return { success: true, transactionId: data.trxID, customerMsisdn: data.customerMsisdn, amount: data.amount };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  static async queryPayment(paymentID: string): Promise<{ status: string; trxID?: string } | null> {
    if (!this.isConfigured()) return null;
    try {
      const base = process.env.BKASH_BASE_URL!;
      const token = await getBkashToken();
      const res = await fetch(`${base}/tokenized/checkout/payment/query/${paymentID}`, {
        headers: { Authorization: token, 'x-app-key': SecretVault.get('BKASH_APP_KEY', { caller: 'system', module: 'BkashAdapter' })! },
      });
      const data = await res.json();
      return { status: data.transactionStatus ?? data.statusMessage, trxID: data.trxID };
    } catch { return null; }
  }

  static async refund(paymentID: string, trxID: string, amountBDT: number, orderId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: 'bKash not configured' };
    try {
      const base = process.env.BKASH_BASE_URL!;
      const token = await getBkashToken();
      const res = await fetch(`${base}/tokenized/checkout/payment/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token, 'x-app-key': SecretVault.get('BKASH_APP_KEY', { caller: 'system', module: 'BkashAdapter' })! },
        body: JSON.stringify({ paymentID, amount: amountBDT.toFixed(2), trxID, sku: orderId, reason: 'Customer refund request' }),
      });
      const data = await res.json();
      return data.statusCode === '0000' ? { success: true } : { success: false, error: data.statusMessage };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
