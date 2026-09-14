import { SecretVault } from '../security/vault/SecretVault';
/**
 * MonetizationEngine — Real Stripe Subscription Billing
 *
 * BEFORE: console.log + return true (Phase 47 placeholder)
 * AFTER:  Real Stripe subscription create/cancel/upgrade + BKash recurring
 *
 * Supports:
 *   - Stripe (international card billing)
 *   - BKash (Bangladesh recurring — via manual agreement flow)
 *   - Vendor commission auto-deduction
 *   - Usage-based billing (API calls, AI tokens)
 */

import Stripe from 'stripe';
import { NexusDB } from '../database/NexusDB';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  name: string;
  priceUSD: number;
  priceBDT: number;
  textLimit: number;        // -1 = unlimited
  aiCallsPerMonth: number;  // -1 = unlimited
  vendorCommission: number; // percentage, e.g. 5 = 5%
  stripePriceId?: string;   // set after Stripe product creation
  features: string[];
}

export interface SubscriptionRecord {
  userId: string;
  plan: string;
  status: 'active' | 'cancelled' | 'past_due' | 'trialing' | 'pending';
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  paymentMethod: 'stripe' | 'bkash' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface UsageRecord {
  userId: string;
  month: string;   // YYYY-MM
  aiCalls: number;
  textChars: number;
  apiCalls: number;
  overage: number; // USD charged for overage
}

export interface BillingResult {
  success: boolean;
  subscriptionId?: string;
  clientSecret?: string; // for Stripe PaymentIntent
  error?: string;
  redirectUrl?: string;  // for BKash
}

// ── Plan Catalog ─────────────────────────────────────────────────────────────

export const PLANS: Record<string, Plan> = {
  FREE: {
    id: 'FREE',
    name: 'Nexus Free',
    priceUSD: 0,
    priceBDT: 0,
    textLimit: 1000,
    aiCallsPerMonth: 50,
    vendorCommission: 10,
    features: ['1 store', 'Basic analytics', 'WhatsApp channel', '50 AI responses/month'],
  },
  STARTER: {
    id: 'STARTER',
    name: 'Nexus Starter',
    priceUSD: 9,
    priceBDT: 990,
    textLimit: 10000,
    aiCallsPerMonth: 500,
    vendorCommission: 7,
    features: ['3 stores', 'Full analytics', 'All channels', '500 AI responses/month', 'BKash/Nagad payments'],
  },
  PRO: {
    id: 'PRO',
    name: 'Nexus Pro',
    priceUSD: 29,
    priceBDT: 3190,
    textLimit: 50000,
    aiCallsPerMonth: 2000,
    vendorCommission: 5,
    features: ['Unlimited stores', 'CEOAgent', 'Priority support', 'Custom domain', '2000 AI responses/month'],
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Nexus Enterprise',
    priceUSD: 199,
    priceBDT: 21900,
    textLimit: -1,
    aiCallsPerMonth: -1,
    vendorCommission: 3,
    features: ['Everything in Pro', 'Local LLM', 'SLA 99.9%', 'Dedicated support', 'Custom AI training'],
  },
};

// ── MonetizationEngine ───────────────────────────────────────────────────────

export class MonetizationEngine {
  static PLANS = PLANS;

  private static getStripe(): Stripe {
    const key = SecretVault.get('STRIPE_SECRET_KEY', { caller: 'system', module: 'MonetizationEngine' });
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    return new Stripe(key, { apiVersion: '2025-06-30.basil' });
  }

  // ── Subscribe ─────────────────────────────────────────────────────────────

  /**
   * Create or upgrade a Stripe subscription.
   * Returns clientSecret for frontend to confirm payment.
   */
  static async createStripeSubscription(
    userId: string,
    planId: string,
    email: string,
    paymentMethodId?: string
  ): Promise<BillingResult> {
    const plan = PLANS[planId];
    if (!plan) return { success: false, error: `Unknown plan: ${planId}` };
    if (plan.priceUSD === 0) return this.activateFree(userId, plan);

    try {
      const stripe = this.getStripe();

      // Get or create Stripe customer
      const existingSub = await NexusDB.get('subscriptions', userId) as SubscriptionRecord | null;
      let customerId = existingSub?.stripeCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email,
          metadata: { nexusUserId: userId },
        });
        customerId = customer.id;
      }

      // Attach payment method if provided
      if (paymentMethodId) {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });
      }

      // Get or create price
      const priceId = await this.getOrCreateStripePrice(stripe, plan);

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: { nexusUserId: userId, plan: planId },
      });

      const invoice = subscription.latest_invoice as Stripe.Invoice;
      const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent;

      // Save to NexusDB
      const now = new Date().toISOString();
      const record: SubscriptionRecord = {
        userId,
        plan: planId,
        status: 'trialing',
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customerId,
        currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: false,
        paymentMethod: 'stripe',
        createdAt: now,
        updatedAt: now,
      };

      await NexusDB.set('subscriptions', userId, record as unknown as Record<string, unknown>);

      return {
        success: true,
        subscriptionId: subscription.id,
        clientSecret: paymentIntent?.client_secret ?? undefined,
      };

    } catch (err) {
      console.error('[MonetizationEngine] Stripe subscription failed:', err);
      return { success: false, error: String(err) };
    }
  }

  /**
   * Initiate BKash recurring subscription (Bangladesh).
   * BKash doesn't have true recurring API — we use agreement flow.
   */
  static async createBkashSubscription(
    userId: string,
    planId: string,
    phoneNumber: string
  ): Promise<BillingResult> {
    const plan = PLANS[planId];
    if (!plan) return { success: false, error: `Unknown plan: ${planId}` };
    if (plan.priceUSD === 0) return this.activateFree(userId, plan);

    const bkashBaseUrl = process.env.BKASH_API_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
    const appKey = SecretVault.get('BKASH_APP_KEY', { caller: 'system', module: 'MonetizationEngine' });
    const appSecret = SecretVault.get('BKASH_APP_SECRET', { caller: 'system', module: 'MonetizationEngine' });
    const username = process.env.BKASH_USERNAME;
    const password = SecretVault.get('BKASH_PASSWORD', { caller: 'system', module: 'MonetizationEngine' });

    if (!appKey || !appSecret || !username || !password) {
      return { success: false, error: 'BKash credentials not configured' };
    }

    try {
      // Step 1: Get token
      const tokenRes = await fetch(`${bkashBaseUrl}/tokenized/checkout/token/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', username, password },
        body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
      });
      const tokenData = await tokenRes.json() as { id_token?: string };
      const token = tokenData.id_token;
      if (!token) return { success: false, error: 'BKash token grant failed' };

      // Step 2: Create agreement (recurring consent)
      const agreementRes = await fetch(`${bkashBaseUrl}/tokenized/checkout/agreement/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: token,
          'x-app-key': appKey,
        },
        body: JSON.stringify({
          mode: '0001',
          payerReference: phoneNumber,
          callbackURL: `${process.env.APP_URL}/api/bkash/agreement-callback`,
          merchantAssociationInfo: `NexusPlan:${planId}:${userId}`,
        }),
      });
      const agreementData = await agreementRes.json() as {
        bkashURL?: string;
        agreementID?: string;
        statusCode?: string;
      };

      if (agreementData.statusCode !== '0000') {
        return { success: false, error: `BKash agreement failed: ${agreementData.statusCode}` };
      }

      // Save pending subscription
      const now = new Date().toISOString();
      await NexusDB.set('subscriptions', userId, {
        userId, plan: planId, status: 'pending',
        bkashAgreementId: agreementData.agreementID,
        paymentMethod: 'bkash',
        createdAt: now, updatedAt: now,
      });

      return {
        success: true,
        subscriptionId: agreementData.agreementID,
        redirectUrl: agreementData.bkashURL,
      };

    } catch (err) {
      console.error('[MonetizationEngine] BKash subscription failed:', err);
      return { success: false, error: String(err) };
    }
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  static async cancelSubscription(userId: string, immediately = false): Promise<BillingResult> {
    try {
      const sub = await NexusDB.get('subscriptions', userId) as SubscriptionRecord | null;
      if (!sub) return { success: false, error: 'No subscription found' };

      if (sub.stripeSubscriptionId) {
        const stripe = this.getStripe();
        if (immediately) {
          await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
        } else {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            cancel_at_period_end: true,
          });
        }
      }

      await NexusDB.update('subscriptions', userId, {
        status: immediately ? 'cancelled' : 'active',
        cancelAtPeriodEnd: !immediately,
        updatedAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Usage Tracking ────────────────────────────────────────────────────────

  static async recordUsage(userId: string, type: 'aiCall' | 'text' | 'apiCall', amount = 1): Promise<void> {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const usageId = `${userId}_${month}`;

    const fieldMap = { aiCall: 'aiCalls', text: 'textChars', apiCall: 'apiCalls' };
    const field = fieldMap[type];

    await NexusDB.update('usage_records', usageId, {
      userId, month,
      [field]: (await NexusDB.get('usage_records', usageId) as UsageRecord | null)?.[field as keyof UsageRecord] as number + amount || amount,
      updatedAt: new Date().toISOString(),
    });
  }

  static async checkUsageLimit(userId: string, type: 'aiCall' | 'text'): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    planId: string;
  }> {
    const sub = await NexusDB.get('subscriptions', userId) as SubscriptionRecord | null;
    const planId = sub?.status === 'active' ? sub.plan : 'FREE';
    const plan = PLANS[planId] || PLANS.FREE;

    const month = new Date().toISOString().slice(0, 7);
    const usage = await NexusDB.get('usage_records', `${userId}_${month}`) as UsageRecord | null;

    const current = type === 'aiCall'
      ? (usage?.aiCalls ?? 0)
      : (usage?.textChars ?? 0);

    const limit = type === 'aiCall' ? plan.aiCallsPerMonth : plan.textLimit;

    return {
      allowed: limit === -1 || current < limit,
      current,
      limit,
      planId,
    };
  }

  // ── Upsell ────────────────────────────────────────────────────────────────

  static async triggerUpsellCheck(userId: string): Promise<{
    shouldUpsell: boolean;
    reason?: string;
    recommendedPlan?: string;
  }> {
    const { allowed, current, limit, planId } = await this.checkUsageLimit(userId, 'aiCall');

    if (!allowed) {
      const nextPlan = planId === 'FREE' ? 'STARTER' : planId === 'STARTER' ? 'PRO' : null;
      return {
        shouldUpsell: true,
        reason: `AI call limit reached (${current}/${limit})`,
        recommendedPlan: nextPlan ?? undefined,
      };
    }

    if (limit !== -1 && current >= limit * 0.9) {
      return {
        shouldUpsell: true,
        reason: `Approaching AI call limit (${current}/${limit} — ${Math.round(current/limit*100)}%)`,
        recommendedPlan: planId === 'FREE' ? 'STARTER' : 'PRO',
      };
    }

    return { shouldUpsell: false };
  }

  // ── Vendor Commission ─────────────────────────────────────────────────────

  static async calculateVendorCommission(vendorId: string, orderTotal: number): Promise<{
    commissionRate: number;
    commissionAmount: number;
    vendorPayout: number;
  }> {
    const sub = await NexusDB.get('subscriptions', vendorId) as SubscriptionRecord | null;
    const planId = sub?.status === 'active' ? sub.plan : 'FREE';
    const plan = PLANS[planId] || PLANS.FREE;

    const commissionRate = plan.vendorCommission;
    const commissionAmount = Math.round(orderTotal * commissionRate / 100 * 100) / 100;
    const vendorPayout = Math.round((orderTotal - commissionAmount) * 100) / 100;

    return { commissionRate, commissionAmount, vendorPayout };
  }

  // ── Stripe Webhook Handler ────────────────────────────────────────────────

  static async handleStripeWebhook(
    payload: string,
    signature: string
  ): Promise<{ handled: boolean; event: string }> {
    const stripe = this.getStripe();
    const webhookSecret = SecretVault.get('STRIPE_WEBHOOK_SECRET', { caller: 'system', module: 'MonetizationEngine' });
    if (!webhookSecret) return { handled: false, event: 'no-webhook-secret' };

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch {
      return { handled: false, event: 'signature-invalid' };
    }

    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.nexusUserId;
        if (userId) {
          await NexusDB.update('subscriptions', userId, {
            status: sub.status === 'active' ? 'active' : sub.status as string,
            currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
            currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date().toISOString(),
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.nexusUserId;
        if (userId) {
          await NexusDB.update('subscriptions', userId, {
            status: 'cancelled',
            updatedAt: new Date().toISOString(),
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        // Find user by Stripe customer ID
        const subs = await NexusDB.find('subscriptions', {
          where: [{ field: 'stripeCustomerId', op: '==', value: customerId }],
          limit: 1,
        });
        if (subs[0]) {
          await NexusDB.update('subscriptions', subs[0].userId as string, {
            status: 'past_due',
            updatedAt: new Date().toISOString(),
          });
        }
        break;
      }
    }

    return { handled: true, event: event.type };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private static async activateFree(userId: string, plan: Plan): Promise<BillingResult> {
    const now = new Date().toISOString();
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    await NexusDB.set('subscriptions', userId, {
      userId, plan: plan.id, status: 'active',
      paymentMethod: 'manual',
      currentPeriodStart: now,
      currentPeriodEnd: nextMonth.toISOString(),
      cancelAtPeriodEnd: false,
      createdAt: now, updatedAt: now,
    });

    return { success: true };
  }

  private static async getOrCreateStripePrice(stripe: Stripe, plan: Plan): Promise<string> {
    if (plan.stripePriceId) return plan.stripePriceId;

    // Check if product already exists
    const products = await stripe.products.search({
      query: `metadata['nexusPlanId']:'${plan.id}'`,
    });

    let productId: string;
    if (products.data.length > 0) {
      productId = products.data[0].id;
    } else {
      const product = await stripe.products.create({
        name: plan.name,
        metadata: { nexusPlanId: plan.id },
      });
      productId = product.id;
    }

    // Create price
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: Math.round(plan.priceUSD * 100),
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { nexusPlanId: plan.id },
    });

    // Cache price ID
    plan.stripePriceId = price.id;
    return price.id;
  }

  // ── Current Subscription ──────────────────────────────────────────────────

  static async getSubscription(userId: string): Promise<SubscriptionRecord | null> {
    return NexusDB.get('subscriptions', userId) as Promise<SubscriptionRecord | null>;
  }

  static async getPlan(userId: string): Promise<Plan> {
    const sub = await this.getSubscription(userId);
    if (!sub || sub.status !== 'active') return PLANS.FREE;
    return PLANS[sub.plan] || PLANS.FREE;
  }
}
