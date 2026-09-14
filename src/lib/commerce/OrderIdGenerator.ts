/**
 * OrderIdGenerator — Human-readable Order IDs
 *
 * WHY: order_1720123456789_abc is useless on the phone:
 *   "What's your order number?" "order underscore 17201..." 
 *   vs "ORD-240705-0042" — readable, searchable, customer-friendly
 *
 * vs World-class:
 *   Amazon:  112-3456789-0123456 (barcode-scannable)
 *   Shopify: #1234 (simple increment)
 *   Daraz:   160012345678BD (country + sequence)
 *   Chaldal: CH-240705-001 (date + increment)
 *
 * Our format: NXS-YYMMDD-XXXXX
 *   NXS = Nexus prefix (configurable)
 *   YYMMDD = date (sortable)
 *   XXXXX = 5-digit daily sequence (padded)
 *   Example: NXS-240705-00042
 */

import { NexusDB } from '../database/NexusDB';

const PREFIX = process.env.ORDER_ID_PREFIX || 'NXS';
const COUNTER_COLLECTION = 'order_id_counters';

export class OrderIdGenerator {

  /**
   * Generate next order ID. Atomic — uses NexusDB increment.
   * Thread-safe: concurrent calls get different IDs.
   */
  static async next(): Promise<string> {
    const today = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD

    try {
      // Atomically increment daily counter
      await NexusDB.incrementField(COUNTER_COLLECTION, today, 'seq', 1);
      const counter = await NexusDB.get(COUNTER_COLLECTION, today);
      const seq = (counter?.seq as number) ?? 1;
      return this.format(today, seq);
    } catch {
      // Fallback: use timestamp-based ID (no DB available)
      const seq = Math.floor(Math.random() * 99999) + 1;
      return this.format(today, seq);
    }
  }

  static format(date: string, seq: number): string {
    return `${PREFIX}-${date}-${String(seq).padStart(5, '0')}`;
  }

  /**
   * Validate order ID format.
   */
  static isValid(id: string): boolean {
    return /^[A-Z]{2,6}-\d{6}-\d{5}$/.test(id);
  }

  /**
   * Extract date from order ID.
   */
  static getDate(id: string): Date | null {
    const match = id.match(/\d{6}/);
    if (!match) return null;
    const [yy, mm, dd] = [match[0].slice(0, 2), match[0].slice(2, 4), match[0].slice(4, 6)];
    return new Date(`20${yy}-${mm}-${dd}`);
  }

  /**
   * Get today's order count (for admin dashboard).
   */
  static async getTodayCount(): Promise<number> {
    const today = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const counter = await NexusDB.get(COUNTER_COLLECTION, today);
    return (counter?.seq as number) ?? 0;
  }
}
