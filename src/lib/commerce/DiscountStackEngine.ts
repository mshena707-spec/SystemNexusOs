/**
 * DiscountStackEngine — Discount Priority & Stacking Resolution
 *
 * WHY: If a customer has: sale (20%) + coupon (৳100 off) + loyalty (৳50) + referral (5%)
 *      In what order do they apply? On what base?
 *      Wrong stacking = financial loss or customer overcharge.
 *
 * vs World-class:
 *   Shopify: discounts apply in a defined priority, % before fixed
 *   Amazon:  Lightning deals → Coupons → Prime savings → Loyalty
 *   WooCommerce: configurable stacking rules per coupon
 *
 * Rules (configurable, saved in NexusDB):
 *   1. Sale price (base price reduction — always first)
 *   2. Percentage coupons (on sale price)
 *   3. Fixed-amount coupons (on subtotal after %)
 *   4. Loyalty points redemption (on subtotal after coupons)
 *   5. Referral discount (on final amount)
 *   6. Free shipping (separate from item total)
 *   7. Tax calculated LAST on final discounted amount
 *
 * Anti-abuse rules:
 *   - Max discount cap: 80% of original price
 *   - Minimum order for free shipping: configurable
 *   - Loyalty + coupon: configurable whether stackable
 */

import { NexusDB } from '../database/NexusDB';

export interface DiscountInput {
  originalTotal: number;       // Cart subtotal before any discounts
  productCategory: string;
  coupon?: {
    code: string;
    type: 'percentage' | 'fixed' | 'free_shipping';
    value: number;             // % or BDT
    minimumOrder?: number;
    maximumDiscount?: number;  // cap for % coupons
  };
  loyaltyPoints?: number;      // Points customer wants to redeem
  loyaltyPointValue?: number;  // BDT per point (default 0.01)
  saleDiscount?: number;       // Already-reduced price vs original
  referralDiscount?: number;   // BDT referral credit
  isVIPCustomer?: boolean;
  orderCount?: number;         // Customer's total order count
}

export interface DiscountResult {
  originalTotal: number;
  saleDiscountApplied: number;
  couponDiscountApplied: number;
  loyaltyDiscountApplied: number;
  referralDiscountApplied: number;
  vipDiscountApplied: number;
  totalDiscount: number;
  finalTotal: number;
  freeShipping: boolean;
  breakdown: Array<{
    label: string;
    amount: number;
    type: 'sale' | 'coupon' | 'loyalty' | 'referral' | 'vip' | 'shipping';
  }>;
  cappedAt?: number;           // If max discount cap was applied
  warnings: string[];
}

export interface StackingPolicy {
  couponAndLoyaltyStackable: boolean;
  maxDiscountPercent: number;      // e.g., 80 = max 80% off
  freeShippingMinOrder: number;    // BDT
  vipDiscountPercent: number;      // For VIP/loyalty tier customers
}

const DEFAULT_POLICY: StackingPolicy = {
  couponAndLoyaltyStackable: true,
  maxDiscountPercent: 80,
  freeShippingMinOrder: 500,
  vipDiscountPercent: 5,
};

export class DiscountStackEngine {
  private static policyCache: StackingPolicy | null = null;

  static async calculate(input: DiscountInput): Promise<DiscountResult> {
    const policy = await this.getPolicy();
    const warnings: string[] = [];
    const breakdown: DiscountResult['breakdown'] = [];

    let workingTotal = input.originalTotal;
    let saleDiscount = 0;
    let couponDiscount = 0;
    let loyaltyDiscount = 0;
    let referralDiscount = 0;
    let vipDiscount = 0;
    let freeShipping = false;

    // ── Step 1: Sale discount (already embedded in price) ─────────────────
    if (input.saleDiscount && input.saleDiscount > 0) {
      saleDiscount = Math.min(input.saleDiscount, workingTotal);
      workingTotal -= saleDiscount;
      breakdown.push({ label: 'Sale Price', amount: saleDiscount, type: 'sale' });
    }

    // ── Step 2: Free shipping check ────────────────────────────────────────
    if (input.coupon?.type === 'free_shipping') {
      if (!input.coupon.minimumOrder || workingTotal >= input.coupon.minimumOrder) {
        freeShipping = true;
        breakdown.push({ label: `Free Shipping (${input.coupon.code})`, amount: 0, type: 'shipping' });
      } else {
        warnings.push(`Free shipping requires minimum ৳${input.coupon.minimumOrder} order`);
      }
    } else if (workingTotal >= policy.freeShippingMinOrder) {
      freeShipping = true;
    }

    // ── Step 3: Percentage coupon ──────────────────────────────────────────
    if (input.coupon?.type === 'percentage' && input.coupon.value > 0) {
      if (!input.coupon.minimumOrder || workingTotal >= input.coupon.minimumOrder) {
        let discount = workingTotal * (input.coupon.value / 100);
        if (input.coupon.maximumDiscount) {
          discount = Math.min(discount, input.coupon.maximumDiscount);
        }
        couponDiscount = Math.round(discount * 100) / 100;
        workingTotal -= couponDiscount;
        breakdown.push({
          label: `Coupon: ${input.coupon.code} (${input.coupon.value}%)`,
          amount: couponDiscount,
          type: 'coupon',
        });
      } else {
        warnings.push(`Coupon requires minimum ৳${input.coupon.minimumOrder} (current: ৳${workingTotal.toFixed(2)})`);
      }
    }

    // ── Step 4: Fixed-amount coupon ────────────────────────────────────────
    if (input.coupon?.type === 'fixed' && input.coupon.value > 0) {
      if (!input.coupon.minimumOrder || workingTotal >= input.coupon.minimumOrder) {
        couponDiscount = Math.min(input.coupon.value, workingTotal);
        workingTotal -= couponDiscount;
        breakdown.push({
          label: `Coupon: ${input.coupon.code} (৳${input.coupon.value} off)`,
          amount: couponDiscount,
          type: 'coupon',
        });
      }
    }

    // ── Step 5: Loyalty points redemption ──────────────────────────────────
    const canUseLoyalty = couponDiscount === 0 || policy.couponAndLoyaltyStackable;
    if (input.loyaltyPoints && input.loyaltyPoints > 0 && canUseLoyalty) {
      const pointValue = input.loyaltyPointValue ?? 0.01;
      const maxLoyaltyDiscount = workingTotal * 0.5; // Max 50% via loyalty
      loyaltyDiscount = Math.min(
        Math.round(input.loyaltyPoints * pointValue * 100) / 100,
        maxLoyaltyDiscount,
        workingTotal
      );
      workingTotal -= loyaltyDiscount;
      breakdown.push({
        label: `Loyalty Points (${input.loyaltyPoints} pts)`,
        amount: loyaltyDiscount,
        type: 'loyalty',
      });
    } else if (input.loyaltyPoints && !canUseLoyalty) {
      warnings.push('Loyalty points cannot be combined with this coupon');
    }

    // ── Step 6: Referral credit ────────────────────────────────────────────
    if (input.referralDiscount && input.referralDiscount > 0) {
      referralDiscount = Math.min(input.referralDiscount, workingTotal);
      workingTotal -= referralDiscount;
      breakdown.push({ label: 'Referral Credit', amount: referralDiscount, type: 'referral' });
    }

    // ── Step 7: VIP discount ───────────────────────────────────────────────
    if (input.isVIPCustomer && policy.vipDiscountPercent > 0) {
      vipDiscount = Math.round(workingTotal * policy.vipDiscountPercent / 100 * 100) / 100;
      workingTotal -= vipDiscount;
      breakdown.push({ label: `VIP Discount (${policy.vipDiscountPercent}%)`, amount: vipDiscount, type: 'vip' });
    }

    // ── Step 8: Maximum discount cap ──────────────────────────────────────
    const totalDiscount = saleDiscount + couponDiscount + loyaltyDiscount + referralDiscount + vipDiscount;
    const maxAllowedDiscount = input.originalTotal * policy.maxDiscountPercent / 100;
    let cappedAt: number | undefined;

    if (totalDiscount > maxAllowedDiscount) {
      const excess = totalDiscount - maxAllowedDiscount;
      workingTotal += excess;
      warnings.push(`Maximum discount cap (${policy.maxDiscountPercent}%) applied`);
      cappedAt = maxAllowedDiscount;
    }

    const finalTotalDiscount = input.originalTotal - workingTotal;

    return {
      originalTotal: input.originalTotal,
      saleDiscountApplied: Math.round(saleDiscount * 100) / 100,
      couponDiscountApplied: Math.round(couponDiscount * 100) / 100,
      loyaltyDiscountApplied: Math.round(loyaltyDiscount * 100) / 100,
      referralDiscountApplied: Math.round(referralDiscount * 100) / 100,
      vipDiscountApplied: Math.round(vipDiscount * 100) / 100,
      totalDiscount: Math.round(finalTotalDiscount * 100) / 100,
      finalTotal: Math.max(0, Math.round(workingTotal * 100) / 100),
      freeShipping,
      breakdown,
      cappedAt,
      warnings,
    };
  }

  private static async getPolicy(): Promise<StackingPolicy> {
    if (this.policyCache) return this.policyCache;
    try {
      const dbPolicy = await NexusDB.get('settings', 'discount_policy') as StackingPolicy | null;
      this.policyCache = dbPolicy ?? DEFAULT_POLICY;
    } catch {
      this.policyCache = DEFAULT_POLICY;
    }
    return this.policyCache;
  }

  static clearCache(): void { this.policyCache = null; }

  static async updatePolicy(policy: Partial<StackingPolicy>): Promise<void> {
    const current = await this.getPolicy();
    const updated = { ...current, ...policy };
    await NexusDB.set('settings', 'discount_policy', updated as unknown as Record<string, unknown>);
    this.policyCache = updated;
  }
}
