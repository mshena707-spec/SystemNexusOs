/**
 * TaxEngine — Bangladesh VAT + International Tax
 *
 * WHY: Bangladesh National Board of Revenue requires 15% VAT on most goods.
 *      Different product categories have different rates.
 *      Without this: illegal non-compliance + wrong price display.
 *
 * vs World-class:
 *   Shopify Tax: rule-based, per-jurisdiction, exemptions
 *   Amazon Tax: per-state/country, product-category aware, B2B exemptions
 *   Our implementation: Bangladesh-first, extensible to other countries
 *
 * Bangladesh VAT Categories (NBR 2024):
 *   Standard: 15% (most goods)
 *   Reduced:  5% (basic food items, medicine, books)
 *   Zero:     0% (exports, raw materials for manufacturing)
 *   Exempt:   0% (essential medicines, agricultural inputs)
 */

import { NexusDB } from '../database/NexusDB';

export type TaxCategory =
  | 'standard'      // 15% — electronics, clothing, general goods
  | 'reduced'       // 5%  — processed food, software services
  | 'zero'          // 0%  — exports
  | 'exempt'        // 0%  — essential medicine, agri inputs
  | 'supplementary'; // Additional duty on luxury items (cigarettes, cars)

export interface TaxRule {
  id: string;
  country: string;          // ISO 3166 'BD', 'US', 'GB'
  category: TaxCategory;
  rate: number;             // decimal: 0.15 = 15%
  supplementaryRate?: number;
  description: string;
  productCategories: string[]; // matches product.category
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface TaxCalculation {
  subtotal: number;
  taxableAmount: number;
  vatAmount: number;
  supplementaryDuty: number;
  totalTax: number;
  total: number;
  effectiveRate: number;
  breakdown: Array<{
    description: string;
    rate: number;
    amount: number;
  }>;
  country: string;
  taxCategory: TaxCategory;
  isVATRegistered: boolean; // B2B VAT reverse charge
}

export interface TaxLineItem {
  productId: string;
  category: string;
  price: number;
  quantity: number;
  isExempt?: boolean;
}

// Bangladesh VAT rules — current as of 2024
const BD_RULES: Array<Omit<TaxRule, 'id' | 'effectiveFrom'>> = [
  {
    country: 'BD',
    category: 'standard',
    rate: 0.15,
    description: 'Standard VAT (15%) — General goods & services',
    productCategories: ['electronics', 'clothing', 'accessories', 'home', 'general', 'beauty', 'toys'],
    effectiveTo: undefined,
  },
  {
    country: 'BD',
    category: 'reduced',
    rate: 0.05,
    description: 'Reduced VAT (5%) — Processed food & software',
    productCategories: ['food_processed', 'software', 'restaurant'],
  },
  {
    country: 'BD',
    category: 'zero',
    rate: 0,
    description: 'Zero-rated — Exports & manufacturing inputs',
    productCategories: ['export', 'raw_material'],
  },
  {
    country: 'BD',
    category: 'exempt',
    rate: 0,
    description: 'VAT Exempt — Essential medicines & agricultural inputs',
    productCategories: ['medicine_essential', 'agriculture', 'books_education', 'food_basic'],
  },
];

export class TaxEngine {
  private static readonly COLLECTION = 'tax_rules';
  private static ruleCache: Map<string, TaxRule[]> = new Map();

  // ── Calculate tax for cart items ────────────────────────────────────────

  static async calculateForCart(
    items: TaxLineItem[],
    country = 'BD',
    options: { isVATRegistered?: boolean; customerVATNumber?: string } = {}
  ): Promise<TaxCalculation> {

    const rules = await this.getRules(country);

    let subtotal = 0;
    let vatAmount = 0;
    let supplementaryDuty = 0;
    const breakdown: TaxCalculation['breakdown'] = [];

    for (const item of items) {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;

      if (item.isExempt) continue;

      const rule = this.findRule(rules, item.category);

      if (rule.rate > 0) {
        const lineVAT = lineTotal * rule.rate;
        vatAmount += lineVAT;

        // Add to breakdown (group by rate)
        const existing = breakdown.find(b => b.description === rule.description);
        if (existing) {
          existing.amount += lineVAT;
        } else {
          breakdown.push({
            description: rule.description,
            rate: rule.rate,
            amount: lineVAT,
          });
        }
      }

      if (rule.supplementaryRate) {
        const lineSup = lineTotal * rule.supplementaryRate;
        supplementaryDuty += lineSup;
        breakdown.push({ description: 'Supplementary Duty', rate: rule.supplementaryRate, amount: lineSup });
      }
    }

    // B2B VAT reverse charge — VAT-registered businesses get 0 VAT on B2B
    const effectiveVAT = options.isVATRegistered && options.customerVATNumber
      ? 0  // Reverse charge applies
      : vatAmount;

    const totalTax = effectiveVAT + supplementaryDuty;
    const total = subtotal + totalTax;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxableAmount: Math.round(subtotal * 100) / 100,
      vatAmount: Math.round(effectiveVAT * 100) / 100,
      supplementaryDuty: Math.round(supplementaryDuty * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      total: Math.round(total * 100) / 100,
      effectiveRate: subtotal > 0 ? Math.round(totalTax / subtotal * 10000) / 100 : 0,
      breakdown: breakdown.map(b => ({ ...b, amount: Math.round(b.amount * 100) / 100 })),
      country,
      taxCategory: this.findRule(rules, items[0]?.category || 'general').category,
      isVATRegistered: options.isVATRegistered ?? false,
    };
  }

  // ── Quick single-item tax ────────────────────────────────────────────────

  static async calculateForItem(
    price: number,
    category: string,
    country = 'BD'
  ): Promise<{ gross: number; tax: number; net: number; rate: number }> {
    const rules = await this.getRules(country);
    const rule = this.findRule(rules, category);
    const tax = Math.round(price * rule.rate * 100) / 100;
    return {
      gross: Math.round((price + tax) * 100) / 100,
      tax,
      net: price,
      rate: rule.rate,
    };
  }

  // ── Tax-inclusive price display ──────────────────────────────────────────
  // Many Bangladesh products show prices inclusive of VAT

  static extractNetFromGross(grossPrice: number, category: string, country = 'BD'): {
    net: number; tax: number; rate: number
  } {
    // Synchronous lookup from in-memory cache
    const rate = this.getRateSync(category, country);
    const net = Math.round(grossPrice / (1 + rate) * 100) / 100;
    const tax = Math.round((grossPrice - net) * 100) / 100;
    return { net, tax, rate };
  }

  // ── Generate tax invoice (for B2B) ───────────────────────────────────────

  static async generateTaxInvoice(orderId: string, calc: TaxCalculation): Promise<{
    invoiceNumber: string;
    challanNumber: string;
    mushraka: string; // Bangladesh VAT challan
  }> {
    const now = new Date();
    const yr = now.getFullYear().toString().slice(-2);
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const seq = Math.floor(Math.random() * 90000) + 10000;

    const invoiceNumber = `INV-${yr}${mo}-${seq}`;
    const challanNumber = `VAT-${yr}-${seq}`;

    await NexusDB.set('tax_invoices', invoiceNumber, {
      invoiceNumber,
      challanNumber,
      orderId,
      ...calc,
      generatedAt: now.toISOString(),
    });

    return { invoiceNumber, challanNumber, mushraka: challanNumber };
  }

  // ── Admin: update tax rules ──────────────────────────────────────────────

  static async updateRule(rule: Omit<TaxRule, 'id'>): Promise<string> {
    const id = `${rule.country}_${rule.category}_${Date.now()}`;
    await NexusDB.set(this.COLLECTION, id, { ...rule, id });
    this.ruleCache.delete(rule.country); // Invalidate cache
    return id;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  static async getRules(country: string): Promise<TaxRule[]> {
    // Cache for 1 hour
    if (this.ruleCache.has(country)) return this.ruleCache.get(country)!;

    // Try DB first (admin-configurable)
    try {
      const dbRules = await NexusDB.find(this.COLLECTION, {
        where: [{ field: 'country', op: '==', value: country }],
      }) as unknown as TaxRule[];
      if (dbRules.length > 0) {
        this.ruleCache.set(country, dbRules);
        return dbRules;
      }
    } catch { /* fallback to hardcoded */ }

    // Seed defaults for Bangladesh
    if (country === 'BD') {
      const rules = BD_RULES.map((r, i) => ({
        ...r,
        id: `bd_default_${i}`,
        effectiveFrom: '2024-01-01',
      }));
      this.ruleCache.set(country, rules);
      return rules;
    }

    // Generic 0% for unknown countries (safe default)
    return [{ id: 'default', country, category: 'standard' as TaxCategory, rate: 0, description: 'No tax configured', productCategories: ['*'], effectiveFrom: '2024-01-01' }];
  }

  private static findRule(rules: TaxRule[], category: string): TaxRule {
    const now = new Date().toISOString();
    return rules.find(r =>
      (r.productCategories.includes(category) || r.productCategories.includes('*')) &&
      r.effectiveFrom <= now &&
      (!r.effectiveTo || r.effectiveTo >= now)
    ) || rules.find(r => r.category === 'standard') || rules[0];
  }

  private static getRateSync(category: string, country: string): number {
    if (country !== 'BD') return 0;
    const rule = BD_RULES.find(r => r.productCategories.includes(category));
    return rule?.rate ?? 0.15;
  }

  // Clear cache (call after updating rules)
  static clearCache(): void { this.ruleCache.clear(); }
}
