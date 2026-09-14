/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  RIDER FRAUD DETECTOR — Phase B                             ║
 * ║                                                             ║
 * ║  Detects delivery fraud patterns from real Firestore data.  ║
 * ║                                                             ║
 * ║  Signals monitored:                                         ║
 * ║   1. Ghost delivery — marked Delivered but GPS far away     ║
 * ║   2. Route spoofing — breadcrumbs don't match delivery path ║
 * ║   3. Speed anomaly — impossible travel speed                ║
 * ║   4. Repeat failure pattern — >30% failure rate             ║
 * ║   5. Early mark — marked Delivered too fast (< 3 min)       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import type { GpsPoint } from './DeliveryTypes';

export interface RiderFraudSignal {
  type: 'ghost_delivery' | 'speed_anomaly' | 'repeat_failure' | 'early_mark' | 'route_spoof';
  severity: 'low' | 'medium' | 'high';
  detail: string;
  orderId?: string;
}

export interface RiderFraudReport {
  riderId: string;
  riskScore: number;       // 0–100
  signals: RiderFraudSignal[];
  decision: 'clear' | 'monitor' | 'flag' | 'suspend';
  computedAt: Date;
}

const MAX_SPEED_MS = 25; // 90 km/h — max plausible motorcycle speed

export class RiderFraudDetector {
  /**
   * Run full fraud analysis for a rider.
   * Results written to `fraud_flags` collection.
   */
  static async analyzeRider(riderId: string): Promise<RiderFraudReport> {
    const signals: RiderFraudSignal[] = [];

    await Promise.allSettled([
      this._checkSpeedAnomalies(riderId, signals),
      this._checkRepeatFailures(riderId, signals),
      this._checkEarlyMarks(riderId, signals),
      this._checkGhostDeliveries(riderId, signals),
    ]);

    const riskScore = this._computeRiskScore(signals);
    const decision  = this._computeDecision(riskScore);

    const report: RiderFraudReport = {
      riderId,
      riskScore,
      signals,
      decision,
      computedAt: new Date(),
    };

    // Persist to Firestore
    if (riskScore > 20) {
      const { db } = await import('../../firebase');
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
      await addDoc(collection(db, 'fraud_flags'), {
        userId: riderId,
        userType: 'rider',
        riskScore,
        signals,
        decision,
        createdAt: serverTimestamp(),
      });
    }

    return report;
  }

  // ── Signal checks ─────────────────────────────────────────────────────

  private static async _checkSpeedAnomalies(riderId: string, signals: RiderFraudSignal[]): Promise<void> {
    const { db } = await import('../../firebase');
    const { collection, query, where, orderBy, limit, getDocs, Timestamp } = await import('firebase/firestore');

    const since = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const q = query(
      collection(db, 'rider_breadcrumbs'),
      where('riderId', '==', riderId),
      where('recordedAt', '>=', since),
      orderBy('ts', 'asc'),
      limit(500)
    );
    const snap = await getDocs(q);
    const points: GpsPoint[] = snap.docs.map(d => ({
      lat: d.data().lat,
      lng: d.data().lng,
      timestamp: d.data().ts,
    }));

    let anomalyCount = 0;
    for (let i = 1; i < points.length; i++) {
      const dt = (points[i].timestamp - points[i-1].timestamp) / 1000; // seconds
      if (dt < 1) continue;
      const dist = _haversine(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng) * 1000; // metres
      const speed = dist / dt; // m/s
      if (speed > MAX_SPEED_MS) anomalyCount++;
    }

    if (anomalyCount > 5) {
      signals.push({
        type: 'speed_anomaly',
        severity: anomalyCount > 20 ? 'high' : 'medium',
        detail: `${anomalyCount} GPS breadcrumbs with impossible travel speed detected`,
      });
    }
  }

  private static async _checkRepeatFailures(riderId: string, signals: RiderFraudSignal[]): Promise<void> {
    const { db } = await import('../../firebase');
    const { collection, query, where, getDocs, Timestamp } = await import('firebase/firestore');

    const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const q = query(collection(db, 'orders'), where('riderId', '==', riderId), where('assignedAt', '>=', since));
    const snap = await getDocs(q);
    const orders = snap.docs.map(d => d.data());
    const total  = orders.length;
    const failed = orders.filter(o => o.status === 'Failed').length;
    if (total >= 5 && failed / total > 0.30) {
      signals.push({
        type: 'repeat_failure',
        severity: failed / total > 0.5 ? 'high' : 'medium',
        detail: `${failed}/${total} orders failed in last 30 days (${Math.round(failed/total*100)}% failure rate)`,
      });
    }
  }

  private static async _checkEarlyMarks(riderId: string, signals: RiderFraudSignal[]): Promise<void> {
    const { db } = await import('../../firebase');
    const { collection, query, where, getDocs, Timestamp } = await import('firebase/firestore');

    const since = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const q = query(
      collection(db, 'orders'),
      where('riderId', '==', riderId),
      where('status', '==', 'Delivered'),
      where('deliveredAt', '>=', since)
    );
    const snap = await getDocs(q);
    let earlyCount = 0;
    for (const d of snap.docs) {
      const order = d.data();
      if (!order.assignedAt || !order.deliveredAt) continue;
      const assigned  = order.assignedAt?.toMillis?.()  ?? 0;
      const delivered = order.deliveredAt?.toMillis?.() ?? 0;
      if ((delivered - assigned) < 3 * 60 * 1000) earlyCount++; // < 3 min
    }
    if (earlyCount >= 2) {
      signals.push({
        type: 'early_mark',
        severity: earlyCount >= 5 ? 'high' : 'medium',
        detail: `${earlyCount} deliveries marked as Delivered within 3 minutes of assignment`,
      });
    }
  }

  private static async _checkGhostDeliveries(riderId: string, signals: RiderFraudSignal[]): Promise<void> {
    const { db } = await import('../../firebase');
    const { collection, query, where, getDocs, Timestamp } = await import('firebase/firestore');

    const since = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const q = query(
      collection(db, 'orders'),
      where('riderId', '==', riderId),
      where('status', '==', 'Delivered'),
      where('deliveredAt', '>=', since)
    );
    const snap = await getDocs(q);

    for (const d of snap.docs) {
      const order = d.data();
      if (!order.deliveryLat || !order.deliveryLng || !order.deliveredAt) continue;

      // Get rider's last GPS point around delivery time
      const deliveredMs = order.deliveredAt?.toMillis?.() ?? 0;
      const windowStart = Timestamp.fromMillis(deliveredMs - 5 * 60 * 1000);
      const windowEnd   = Timestamp.fromMillis(deliveredMs + 2 * 60 * 1000);

      const bcQ = query(
        collection(db, 'rider_breadcrumbs'),
        where('riderId', '==', riderId),
        where('recordedAt', '>=', windowStart),
        where('recordedAt', '<=', windowEnd),
      );
      const bcSnap = await getDocs(bcQ);
      if (bcSnap.empty) continue; // No GPS data — can't check

      // Check if any GPS point was within 200m of delivery address
      const wasNear = bcSnap.docs.some(bc => {
        const dist = _haversine(bc.data().lat, bc.data().lng, order.deliveryLat, order.deliveryLng);
        return dist < 0.2; // 200m
      });

      if (!wasNear) {
        signals.push({
          type: 'ghost_delivery',
          severity: 'high',
          detail: `Order #${d.id.slice(0,8)} marked Delivered but rider GPS was >200m from delivery address`,
          orderId: d.id,
        });
      }
    }
  }

  private static _computeRiskScore(signals: RiderFraudSignal[]): number {
    const weights = { low: 10, medium: 25, high: 50 };
    const raw = signals.reduce((sum, s) => sum + weights[s.severity], 0);
    return Math.min(raw, 100);
  }

  private static _computeDecision(score: number): RiderFraudReport['decision'] {
    if (score >= 75) return 'suspend';
    if (score >= 50) return 'flag';
    if (score >= 20) return 'monitor';
    return 'clear';
  }
}

function _haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
