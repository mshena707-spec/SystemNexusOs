import { SecretVault } from '../security/vault/SecretVault';
/**
 * NAGAD PAYMENT ADAPTER - Phase A/F
 * Implements Nagad Merchant API (Direct API integration)
 * https://nagad.com.bd/developer/
 *
 * Required env vars:
 *   NAGAD_MERCHANT_ID, NAGAD_MERCHANT_NUMBER
 *   NAGAD_PUBLIC_KEY   (base64-encoded PEM from Nagad portal)
 *   NAGAD_PRIVATE_KEY  (base64-encoded PEM your server generated)
 *   NAGAD_BASE_URL     (sandbox: http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0)
 *                      (prod:    https://api.mynagad.com/api/dfs)
 */

import crypto from 'crypto';

function nagadEncrypt(data: string, publicKeyB64: string): string {
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKeyB64}\n-----END PUBLIC KEY-----`;
  return crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(data)).toString('base64');
}

function nagadSign(data: string, privateKeyB64: string): string {
  const pem = `-----BEGIN PRIVATE KEY-----\n${privateKeyB64}\n-----END PRIVATE KEY-----`;
  return crypto.sign('SHA256', Buffer.from(data), { key: pem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }).toString('base64');
}

export class NagadAdapter {
  static isConfigured(): boolean {
    return !!(process.env.NAGAD_MERCHANT_ID && process.env.NAGAD_MERCHANT_NUMBER && process.env.NAGAD_PUBLIC_KEY && process.env.NAGAD_PRIVATE_KEY && process.env.NAGAD_BASE_URL);
  }

  /**
   * Step 1: Initialize payment — returns callBackUrl to redirect user.
   */
  static async initiatePayment(orderId: string, amountBDT: number, callbackUrl: string): Promise<{ success: boolean; callBackUrl?: string; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: 'Nagad credentials not configured' };
    try {
      const base = process.env.NAGAD_BASE_URL!;
      const merchantId = process.env.NAGAD_MERCHANT_ID!;
      const pubKey = SecretVault.get('NAGAD_PUBLIC_KEY', { caller: 'system', module: 'NagadAdapter' });
      const privKey = SecretVault.get('NAGAD_PRIVATE_KEY', { caller: 'system', module: 'NagadAdapter' });
      const datetime = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      const ordRef = `${orderId}-${datetime}`;

      // Nagad requires encrypting sensitive data with their public key
      const sensitiveData = JSON.stringify({ merchantId, datetime, orderId: ordRef, challenge: crypto.randomBytes(20).toString('hex') });
      const encData = nagadEncrypt(sensitiveData, pubKey);
      const signature = nagadSign(sensitiveData, privKey);

      const checkRes = await fetch(`${base}/check-out/initialize/${merchantId}/${ordRef}`, {
        method: 'POST',
        headers: { 'X-KM-Api-Version': 'v-0.2.0', 'X-KM-IP-V4': '127.0.0.1', 'X-KM-Client-Type': 'PC_WEB', 'Content-Type': 'application/json', DateTime: datetime },
        body: JSON.stringify({ accountNumber: process.env.NAGAD_MERCHANT_NUMBER, dateTime: datetime, sensitiveData: encData, signature }),
      });
      const checkData = await checkRes.json();
      if (!checkData.sensitiveData) return { success: false, error: 'Nagad init failed' };

      // Complete payment
      const payData = JSON.stringify({ merchantId, orderId: ordRef, amount: amountBDT.toFixed(2), currencyCode: '050', challenge: checkData.sensitiveData });
      const payRes = await fetch(`${base}/check-out/complete/${checkData.paymentReferenceId}`, {
        method: 'POST',
        headers: { 'X-KM-Api-Version': 'v-0.2.0', 'Content-Type': 'application/json', DateTime: datetime },
        body: JSON.stringify({ sensitiveData: nagadEncrypt(payData, pubKey), signature: nagadSign(payData, privKey), merchantCallbackURL: callbackUrl }),
      });
      const payResult = await payRes.json();
      if (!payResult.callBackUrl) return { success: false, error: `Nagad complete failed: ${JSON.stringify(payResult)}` };
      return { success: true, callBackUrl: payResult.callBackUrl };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Verify payment after callback redirect.
   */
  static async verifyPayment(paymentRefId: string): Promise<{ success: boolean; transactionId?: string; amount?: string; status?: string; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: 'Nagad not configured' };
    try {
      const base = process.env.NAGAD_BASE_URL!;
      const res = await fetch(`${base}/verify/payment/${paymentRefId}`, {
        headers: { 'X-KM-Api-Version': 'v-0.2.0' },
      });
      const data = await res.json();
      if (data.status !== 'Success') return { success: false, error: `Nagad verify failed: ${data.message}` };
      return { success: true, transactionId: data.issuerPaymentRefNo, amount: data.amount, status: data.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
