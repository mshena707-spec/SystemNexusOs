/**
 * PAYMENT ROUTES - Phase A/F
 * Mounts real BKash + Nagad + Stripe refund routes onto Express app.
 * Call mountPaymentRoutes(app) from server.ts.
 */

import { Router, Request, Response } from 'express';
import { BkashAdapter } from './BkashAdapter';
import { NagadAdapter } from './NagadAdapter';
import { RocketAdapter } from './RocketAdapter';

/**
 * Phase H: blocks NEW payment initiations while the owner has engaged
 * emergency shutdown (OwnerControlEngine). Deliberately only applied to
 * the three "/*\/create" routes below — refund, callback/webhook, and
 * audit-read routes are left unguarded so in-flight transactions can
 * still complete and customers can still get refunded during a shutdown.
 */
async function shutdownGuard(req: Request, res: Response, next: () => void): Promise<void> {
  try {
    const { OwnerControlEngine } = await import('../control/OwnerControlEngine');
    if (await OwnerControlEngine.isShutdown()) {
      res.status(503).json({ error: 'System is in emergency shutdown mode. New payments are temporarily paused by the business owner.', code: 'EMERGENCY_SHUTDOWN' });
      return;
    }
  } catch { /* fail-open */ }
  next();
}

export function mountPaymentRoutes(app: any): void {
  const router = Router();

  // ── bKash: initiate ────────────────────────────────────────────────────
  router.post('/bkash/create', shutdownGuard, async (req: Request, res: Response) => {
    const { orderId, amountBDT } = req.body;
    if (!orderId || !amountBDT) { res.status(400).json({ error: 'orderId and amountBDT required' }); return; }
    const origin = req.headers.origin || process.env.APP_URL || 'http://localhost:3000';
    const callbackUrl = `${origin}/api/payment/bkash/callback`;
    const result = await BkashAdapter.createPayment(orderId, Number(amountBDT), callbackUrl);
    if (!result.success) { res.status(500).json({ error: result.error }); return; }
    // Persist pending payment (Phase E: via NexusDB)
    const { NexusDB } = await import('../database/NexusDB');
    await NexusDB.set('payments', orderId, {
      orderId, provider: 'bkash', status: 'pending',
      bkashPaymentID: result.paymentID, providerRef: result.paymentID,
      amount: Number(amountBDT), currency: 'BDT',
    }, true);
    res.json({ success: true, bkashURL: result.bkashURL, paymentID: result.paymentID });
  });

  // ── bKash: callback (after user completes payment on bKash page) ───────
  router.get('/bkash/callback', async (req: Request, res: Response) => {
    const { paymentID, status } = req.query as Record<string, string>;
    const origin = process.env.APP_URL || 'http://localhost:3000';

    if (status === 'cancel' || status === 'failure') {
      res.redirect(`${origin}/checkout?payment=failed&provider=bkash`);
      return;
    }

    if (!paymentID) { res.status(400).send('Missing paymentID'); return; }

    const result = await BkashAdapter.executePayment(paymentID);
    if (!result.success) {
      res.redirect(`${origin}/checkout?payment=failed&provider=bkash&reason=${encodeURIComponent(result.error ?? 'unknown')}`);
      return;
    }

    // Find matching order by paymentID
    try {
      const { NexusDB } = await import('../database/NexusDB');
      const matches = await NexusDB.find('payments', {
        where: [{ field: 'bkashPaymentID', op: '==', value: paymentID }],
        limit: 1,
      });
      if (matches.length > 0) {
        const orderId = matches[0].orderId;
        await NexusDB.update('payments', orderId, {
          status: 'success', transactionId: result.transactionId,
          customerMsisdn: result.customerMsisdn, verifiedAt: new Date().toISOString(),
        });
        await NexusDB.update('orders', orderId, {
          status: 'Paid', paymentStatus: 'success',
        });
        res.redirect(`${origin}/order-success?orderId=${orderId}&provider=bkash`);
        return;
      }
    } catch (err) {
      console.error('[BkashCallback] DB update failed:', err);
    }
    res.redirect(`${origin}/checkout?payment=success&provider=bkash&trxID=${result.transactionId}`);
  });

  // ── Nagad: initiate ────────────────────────────────────────────────────
  router.post('/nagad/create', shutdownGuard, async (req: Request, res: Response) => {
    const { orderId, amountBDT } = req.body;
    if (!orderId || !amountBDT) { res.status(400).json({ error: 'orderId and amountBDT required' }); return; }
    const origin = req.headers.origin || process.env.APP_URL || 'http://localhost:3000';
    const callbackUrl = `${origin}/api/payment/nagad/callback`;
    const result = await NagadAdapter.initiatePayment(orderId, Number(amountBDT), callbackUrl);
    if (!result.success) { res.status(500).json({ error: result.error }); return; }
    const { NexusDB } = await import('../database/NexusDB');
    await NexusDB.set('payments', orderId, {
      orderId, provider: 'nagad', status: 'pending',
      providerRef: orderId, amount: Number(amountBDT), currency: 'BDT',
    }, true);
    res.json({ success: true, callBackUrl: result.callBackUrl });
  });

  // ── Nagad: callback ────────────────────────────────────────────────────
  router.get('/nagad/callback', async (req: Request, res: Response) => {
    const { payment_ref_id, status, order_id } = req.query as Record<string, string>;
    const origin = process.env.APP_URL || 'http://localhost:3000';
    if (status !== 'Success' || !payment_ref_id) {
      res.redirect(`${origin}/checkout?payment=failed&provider=nagad`);
      return;
    }
    const result = await NagadAdapter.verifyPayment(payment_ref_id);
    if (!result.success) {
      res.redirect(`${origin}/checkout?payment=failed&provider=nagad`);
      return;
    }
    try {
      const { NexusDB } = await import('../database/NexusDB');
      const orderId = order_id;
      if (orderId) {
        await NexusDB.update('payments', orderId, { status: 'success', transactionId: result.transactionId, verifiedAt: new Date().toISOString() });
        await NexusDB.update('orders', orderId, { status: 'Paid', paymentStatus: 'success' });
      }
      res.redirect(`${origin}/order-success?orderId=${orderId}&provider=nagad`);
    } catch {
      res.redirect(`${origin}/checkout?payment=success&provider=nagad`);
    }
  });

  // ── Rocket: initiate ───────────────────────────────────────────────────
  router.post('/rocket/create', shutdownGuard, async (req: Request, res: Response) => {
    const { orderId, amountBDT } = req.body;
    if (!orderId || !amountBDT) { res.status(400).json({ error: 'orderId and amountBDT required' }); return; }
    const origin = req.headers.origin || process.env.APP_URL || 'http://localhost:3000';
    const callbackUrl = `${origin}/api/payment/rocket/callback`;
    const result = await RocketAdapter.createPayment(orderId, Number(amountBDT), callbackUrl);
    if (!result.success) { res.status(500).json({ error: result.error }); return; }
    const { NexusDB } = await import('../database/NexusDB');
    await NexusDB.set('payments', orderId, {
      orderId, provider: 'rocket', status: 'pending',
      providerRef: result.txnId, amount: Number(amountBDT), currency: 'BDT',
    }, true);
    res.json({ success: true, redirectUrl: result.redirectUrl, txnId: result.txnId });
  });

  // ── Rocket: callback ───────────────────────────────────────────────────
  router.get('/rocket/callback', async (req: Request, res: Response) => {
    const { txnId, status, orderId } = req.query as Record<string, string>;
    const origin = process.env.APP_URL || 'http://localhost:3000';

    if (status !== 'COMPLETED' && status !== 'SUCCESS') {
      res.redirect(`${origin}/checkout?payment=failed&provider=rocket`);
      return;
    }
    if (!txnId) { res.status(400).send('Missing txnId'); return; }

    const result = await RocketAdapter.verifyPayment(txnId);
    if (!result.success) {
      res.redirect(`${origin}/checkout?payment=failed&provider=rocket&reason=${encodeURIComponent(result.error ?? 'unknown')}`);
      return;
    }

    try {
      const { NexusDB } = await import('../database/NexusDB');
      const resolvedOrderId = orderId ?? txnId;
      await NexusDB.update('payments', resolvedOrderId, {
        status: 'success', transactionId: result.transactionId, verifiedAt: new Date().toISOString(),
      });
      await NexusDB.update('orders', resolvedOrderId, { status: 'Paid', paymentStatus: 'success' });
      res.redirect(`${origin}/order-success?orderId=${resolvedOrderId}&provider=rocket`);
    } catch {
      res.redirect(`${origin}/checkout?payment=success&provider=rocket&trxID=${result.transactionId}`);
    }
  });

  // ── Universal Refund (any provider via RefundEngine) ───────────────────
  router.post('/refund', async (req: Request, res: Response) => {
    const { orderId, amount, reason, requestedBy } = req.body;
    if (!orderId || !reason) { res.status(400).json({ error: 'orderId and reason required' }); return; }
    try {
      const { RefundEngine } = await import('./RefundEngine');
      const result = await RefundEngine.processRefund({
        orderId, amount: amount ? Number(amount) : undefined, reason, requestedBy: requestedBy ?? 'admin',
      });
      if (!result.success) { res.status(400).json({ error: result.error }); return; }
      res.json({ success: true, ...result.result });
    } catch (err: any) {
      console.error('[UniversalRefund]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Refund eligibility check ────────────────────────────────────────────
  router.get('/refund/eligibility/:orderId', async (req: Request, res: Response) => {
    try {
      const { RefundEngine } = await import('./RefundEngine');
      const eligibility = await RefundEngine.checkEligibility(req.params.orderId);
      res.json(eligibility);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Legacy alias: /stripe/refund -> universal refund ────────────────────
  router.post('/stripe/refund', async (req: Request, res: Response) => {
    const { orderId, amountCents, reason } = req.body;
    if (!orderId) { res.status(400).json({ error: 'orderId required' }); return; }
    try {
      const { RefundEngine } = await import('./RefundEngine');
      const result = await RefundEngine.processRefund({
        orderId,
        amount: amountCents ? amountCents / 100 : undefined,
        reason: reason ?? 'requested_by_customer',
        requestedBy: 'admin',
      });
      if (!result.success) { res.status(400).json({ error: result.error }); return; }
      res.json({ success: true, refundId: result.result?.refundId, status: result.result?.status });
    } catch (err: any) {
      console.error('[StripeRefund]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Payment audit log for an order ──────────────────────────────────────
  router.get('/audit/:orderId', async (req: Request, res: Response) => {
    try {
      const { PaymentAuditLog } = await import('./PaymentAuditLog');
      const history = await PaymentAuditLog.getOrderHistory(req.params.orderId);
      res.json({ orderId: req.params.orderId, history });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use('/api/payment', router);
}
