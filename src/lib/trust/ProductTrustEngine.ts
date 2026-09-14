/**
 * ProductTrustEngine — vendor trust scores and authenticity verification.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';

export interface VendorTrustScore {
  vendorId:                  string;
  reliabilityScore:          number; // 0–100
  deliverySuccessPercent:    number; // 0–100
  productAuthenticityLevel: 'Verified' | 'Standard' | 'Unverified';
  totalOrdersCompleted:      number;
}

const DEFAULT_TRUST: Omit<VendorTrustScore, 'vendorId'> = {
  reliabilityScore:          85,
  deliverySuccessPercent:    92,
  productAuthenticityLevel: 'Standard',
  totalOrdersCompleted:      0,
};

export class ProductTrustEngine {
  /** Retrieve vendor trust score; returns default if not yet calculated */
  static async getVendorTrustScore(vendorId: string): Promise<VendorTrustScore> {
    try {
      const doc = await NexusDB.get('vendor_trust', vendorId);
      if (doc) return doc as VendorTrustScore;
      return { vendorId, ...DEFAULT_TRUST };
    } catch {
      return { vendorId, ...DEFAULT_TRUST, productAuthenticityLevel: 'Unverified', reliabilityScore: 80 };
    }
  }

  /** Update vendor trust score after an order is completed */
  static async updateAfterDelivery(
    vendorId: string,
    wasSuccessful: boolean,
  ): Promise<void> {
    try {
      await NexusDB.incrementField('vendor_trust', vendorId, 'totalOrdersCompleted', 1);
      if (wasSuccessful) {
        await NexusDB.incrementField('vendor_trust', vendorId, 'successfulDeliveries', 1);
      }
    } catch {
      // Non-critical
    }
  }

  /** CSS classes for trust badge color */
  static getTrustBadgeColor(score: number): string {
    if (score >= 95) return 'text-emerald-500 bg-emerald-500/10';
    if (score >= 80) return 'text-blue-500 bg-blue-500/10';
    if (score >= 60) return 'text-yellow-500 bg-yellow-500/10';
    return 'text-red-500 bg-red-500/10';
  }
}
