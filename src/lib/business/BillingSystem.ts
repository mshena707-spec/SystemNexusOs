/**
 * BillingSystem — invoice generation and billing records.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('BillingSystem');

export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  invoiceId: string;
  orderId: string;
  userId: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: 'issued' | 'paid' | 'cancelled' | 'overdue';
  issuedAt: unknown;
  dueAt?: unknown;
}

export class BillingSystem {
  /** Generate and persist an invoice for an order */
  static async generateInvoice(
    orderId: string,
    userId: string,
    items: InvoiceItem[],
    total: number,
    currency = 'BDT',
    taxRate = 0,
  ): Promise<string | null> {
    const year      = new Date().getFullYear();
    const suffix    = Math.random().toString(36).slice(2, 7).toUpperCase();
    const invoiceId = `INV-${year}-${suffix}`;

    try {
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const tax      = Math.round(subtotal * taxRate * 100) / 100;

      await NexusDB.set('invoices', invoiceId, {
        invoiceId,
        orderId,
        userId,
        items,
        subtotal,
        tax,
        total: total ?? subtotal + tax,
        currency,
        status: 'issued',
        issuedAt: NexusDB.serverTimestamp(),
      } satisfies Invoice);

      log.info(`Invoice generated: ${invoiceId} for order ${orderId}`);
      return invoiceId;
    } catch (err) {
      log.error('generateInvoice failed', { orderId, error: String(err) });
      return null;
    }
  }

  /** Mark invoice as paid */
  static async markPaid(invoiceId: string): Promise<void> {
    await NexusDB.update('invoices', invoiceId, {
      status: 'paid',
      paidAt: NexusDB.serverTimestamp(),
    });
  }

  /** Retrieve invoice */
  static async getInvoice(invoiceId: string): Promise<Invoice | null> {
    return (await NexusDB.get('invoices', invoiceId)) as Invoice | null;
  }

  /** List invoices for a user */
  static async listUserInvoices(userId: string, limit = 50): Promise<Invoice[]> {
    return (await NexusDB.find('invoices', {
      where:   [{ field: 'userId', op: '==', value: userId }],
      orderBy: 'issuedAt',
      orderDir: 'desc',
      limit,
    })) as Invoice[];
  }
}
