/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  RIDER PERFORMANCE ENGINE — Phase B                         ║
 * ║                                                             ║
 * ║  Computes performance scores from real Firestore data.      ║
 * ║  Runs via cron daily. Results cached in `rider_performance` ║
 * ║                                                             ║
 * ║  Score formula:                                             ║
 * ║    40% on-time rate                                         ║
 * ║    30% success rate (delivered vs failed)                   ║
 * ║    20% delivery count (volume)                              ║
 * ║    10% fraud flag penalty                                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import type { RiderPerformance } from './DeliveryTypes';

type Period = 'today' | '7d' | '30d';

const PERIOD_DAYS: Record<Period, number> = { today: 1, '7d': 7, '30d': 30 };

export class RiderPerformanceEngine {
  /**
   * Compute performance for a single rider over a given period.
   * Results written back to `rider_performance/{riderId}_{period}`.
   */
  static async computeRiderPerformance(riderId: string, period: Period = '7d'): Promise<RiderPerformance> {
    const { db } = await import('../../firebase');
    const { collection, query, where, getDocs, doc, setDoc, serverTimestamp, Timestamp } = await import('firebase/firestore');

    const days = PERIOD_DAYS[period];
    const since = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);

    // Fetch orders assigned to this rider in period
    const q = query(
      collection(db, 'orders'),
      where('riderId', '==', riderId),
      where('assignedAt', '>=', since)
    );
    const snap = await getDocs(q);
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    const total         = orders.length;
    const delivered     = orders.filter(o => o.status === 'Delivered').length;
    const failed        = orders.filter(o => o.status === 'Failed').length;
    const successRate   = total > 0 ? (delivered / total) * 100 : 0;

    // On-time: delivered before SLA expires
    const onTimeOrders  = orders.filter(o => {
      if (o.status !== 'Delivered' || !o.deliveredAt || !o.createdAt) return false;
      const created  = o.createdAt?.toMillis?.()  ?? new Date(o.createdAt).getTime();
      const delivered = o.deliveredAt?.toMillis?.() ?? new Date(o.deliveredAt).getTime();
      const sla      = (o.slaMinutes ?? 45) * 60_000;
      return (delivered - created) <= sla;
    });
    const onTimeRate = total > 0 ? (onTimeOrders.length / total) * 100 : 0;

    // Average delivery minutes
    const deliveredOrders = orders.filter(o => o.status === 'Delivered' && o.deliveredAt && o.assignedAt);
    const avgDeliveryMinutes = deliveredOrders.length > 0
      ? deliveredOrders.reduce((sum, o) => {
          const assigned  = o.assignedAt?.toMillis?.()  ?? new Date(o.assignedAt).getTime();
          const delivered = o.deliveredAt?.toMillis?.() ?? new Date(o.deliveredAt).getTime();
          return sum + (delivered - assigned) / 60_000;
        }, 0) / deliveredOrders.length
      : 0;

    // Estimate total km from breadcrumbs
    const bcQ = query(
      collection(db, 'rider_breadcrumbs'),
      where('riderId', '==', riderId),
      where('recordedAt', '>=', since)
    );
    const bcSnap = await getDocs(bcQ);
    const points = bcSnap.docs.map(d => d.data());
    let totalKm = 0;
    for (let i = 1; i < points.length; i++) {
      totalKm += _haversine(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
    }

    // Fraud flags in period
    const fraudQ = query(
      collection(db, 'fraud_flags'),
      where('userId', '==', riderId),
      where('createdAt', '>=', since)
    );
    const fraudSnap = await getDocs(fraudQ);
    const fraudFlags = fraudSnap.size;

    // Composite score
    const score = Math.round(
      (onTimeRate   * 0.40) +
      (successRate  * 0.30) +
      (Math.min(total / Math.max(days, 1), 10) / 10 * 100 * 0.20) +  // up to 10 deliveries/day = 100%
      (Math.max(0, 100 - fraudFlags * 20) * 0.10)                     // -20pts per fraud flag
    );

    const grade: RiderPerformance['grade'] =
      score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'F';

    const result: RiderPerformance = {
      riderId,
      period,
      totalDeliveries: total,
      successfulDeliveries: delivered,
      failedDeliveries: failed,
      successRate: Math.round(successRate),
      avgDeliveryMinutes: Math.round(avgDeliveryMinutes),
      onTimeRate: Math.round(onTimeRate),
      totalKm: Math.round(totalKm * 10) / 10,
      fraudFlags,
      performanceScore: score,
      grade,
    };

    // Cache result
    await setDoc(doc(db, 'rider_performance', `${riderId}_${period}`), {
      ...result,
      computedAt: serverTimestamp(),
    });

    return result;
  }

  /**
   * Compute performance for ALL riders (called by daily cron).
   */
  static async computeAllRiders(period: Period = '7d'): Promise<RiderPerformance[]> {
    const { db } = await import('../../firebase');
    const { collection, getDocs } = await import('firebase/firestore');

    const snap = await getDocs(collection(db, 'riders'));
    const results: RiderPerformance[] = [];

    for (const riderDoc of snap.docs) {
      try {
        const perf = await this.computeRiderPerformance(riderDoc.id, period);
        results.push(perf);
      } catch (err) {
        console.error(`[RiderPerf] Failed for rider ${riderDoc.id}:`, err);
      }
    }

    return results;
  }

  /**
   * Get cached performance for a rider. Falls back to live computation.
   */
  static async getPerformance(riderId: string, period: Period = '7d'): Promise<RiderPerformance> {
    const { db } = await import('../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');

    const snap = await getDoc(doc(db, 'rider_performance', `${riderId}_${period}`));
    if (snap.exists()) {
      const data = snap.data() as RiderPerformance;
      return data;
    }
    return this.computeRiderPerformance(riderId, period);
  }
}

function _haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
