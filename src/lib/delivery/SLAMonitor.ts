/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SLA MONITOR + DELAY DETECTOR — Phase B                     ║
 * ║                                                             ║
 * ║  Runs server-side (via cron every 5 min).                   ║
 * ║  Scans all active orders, detects SLA breaches,             ║
 * ║  fires notifications to admins and customers.               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import type { SLAAlert } from './DeliveryTypes';

const DEFAULT_SLA_MINUTES = 45;
const WARNING_THRESHOLD   = 0.75; // 75% of SLA elapsed → warning
const CRITICAL_THRESHOLD  = 1.25; // 125% of SLA elapsed → critical

export class SLAMonitor {
  /**
   * Scan all active (non-terminal) orders.
   * Returns array of alerts. Fires Firestore notifications for each breach.
   */
  /**
   * Alias for runScan(), kept for API routes that ask for "active alerts"
   * rather than triggering a fresh scan by name. Semantically identical:
   * scans active orders and returns the current SLA alerts.
   */
  static async getActiveAlerts(): Promise<SLAAlert[]> {
    return this.runScan();
  }

  static async runScan(): Promise<SLAAlert[]> {
    const { db } = await import('../../firebase');
    const {
      collection, query, where, getDocs, addDoc, doc, getDoc, serverTimestamp, Timestamp
    } = await import('firebase/firestore');

    const TERMINAL = ['Delivered', 'Cancelled', 'Failed'];
    const cutoff = Timestamp.fromMillis(Date.now() - 6 * 60 * 60 * 1000); // orders last 6h

    const q = query(
      collection(db, 'orders'),
      where('createdAt', '>=', cutoff)
    );
    const snap = await getDocs(q);

    const alerts: SLAAlert[] = [];

    for (const orderDoc of snap.docs) {
      const order = orderDoc.data();
      if (TERMINAL.includes(order.status)) continue;

      const createdAt: Date = order.createdAt?.toDate?.() ?? new Date(order.createdAt);
      const ageMinutes = (Date.now() - createdAt.getTime()) / 60_000;
      const slaMinutes: number = order.slaMinutes ?? DEFAULT_SLA_MINUTES;
      const ratio = ageMinutes / slaMinutes;

      let severity: SLAAlert['severity'] | null = null;
      if (ratio >= CRITICAL_THRESHOLD)  severity = 'critical';
      else if (ratio >= 1.0)            severity = 'breach';
      else if (ratio >= WARNING_THRESHOLD) severity = 'warning';

      if (!severity) continue;

      const alert: SLAAlert = {
        orderId: orderDoc.id,
        riderId: order.riderId ?? undefined,
        ageMinutes: Math.round(ageMinutes),
        slaMinutes,
        breachMinutes: Math.max(0, Math.round(ageMinutes - slaMinutes)),
        severity,
      };
      alerts.push(alert);

      // Persist alert to Firestore (deduplication: once per severity per order)
      const alertKey = `${orderDoc.id}_${severity}`;
      const existingSnap = await getDocs(
        query(collection(db, 'sla_alerts'), where('alertKey', '==', alertKey))
      );
      if (existingSnap.empty) {
        await addDoc(collection(db, 'sla_alerts'), {
          ...alert,
          alertKey,
          createdAt: serverTimestamp(),
          resolved: false,
        });

        // Notify admin
        if (order.adminId || severity !== 'warning') {
          await addDoc(collection(db, 'notifications'), {
            userId: 'admin',
            title: severity === 'critical'
              ? `🚨 CRITICAL: Order #${orderDoc.id.slice(0,8)} delayed ${alert.breachMinutes}min past SLA`
              : severity === 'breach'
              ? `⚠️ SLA BREACH: Order #${orderDoc.id.slice(0,8)} overdue by ${alert.breachMinutes}min`
              : `🕐 SLA Warning: Order #${orderDoc.id.slice(0,8)} at ${Math.round(ratio * 100)}% of SLA`,
            body: `Customer: ${order.userId ?? 'N/A'} | Rider: ${order.riderId ?? 'Unassigned'} | Status: ${order.status}`,
            type: 'sla',
            severity,
            orderId: orderDoc.id,
            read: false,
            createdAt: serverTimestamp(),
          });
        }

        // Notify customer if breach
        if (severity !== 'warning' && order.userId) {
          await addDoc(collection(db, 'notifications'), {
            userId: order.userId,
            title: 'Your order is taking longer than expected',
            body: `We apologize for the delay on order #${orderDoc.id.slice(0,8)}. Your rider is on the way.`,
            type: 'delay',
            orderId: orderDoc.id,
            read: false,
            createdAt: serverTimestamp(),
          });
        }
      }
    }

    return alerts;
  }

  /**
   * Calculate estimated delivery time for an order.
   * Uses distance + rider average speed if GPS available.
   */
  static async estimateDeliveryTime(
    orderId: string,
    riderLat: number,
    riderLng: number
  ): Promise<{ estimatedMinutes: number; confidence: 'high' | 'medium' | 'low' }> {
    const { db } = await import('../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');

    const orderSnap = await getDoc(doc(db, 'orders', orderId));
    if (!orderSnap.exists()) return { estimatedMinutes: 30, confidence: 'low' };

    const order = orderSnap.data();
    const destLat = order.deliveryLat;
    const destLng = order.deliveryLng;
    if (!destLat || !destLng) return { estimatedMinutes: 30, confidence: 'low' };

    // Haversine distance
    const R = 6371;
    const dLat = (destLat - riderLat) * Math.PI / 180;
    const dLng = (destLng - riderLng) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(riderLat * Math.PI/180) * Math.cos(destLat * Math.PI/180) * Math.sin(dLng/2)**2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    // Assume 20 km/h average urban delivery speed + 5 min handoff
    const avgSpeedKmH = 20;
    const estimatedMinutes = Math.round((distKm / avgSpeedKmH) * 60 + 5);

    return {
      estimatedMinutes,
      confidence: distKm < 5 ? 'high' : distKm < 15 ? 'medium' : 'low',
    };
  }
}
