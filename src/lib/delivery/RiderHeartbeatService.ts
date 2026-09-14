/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  RIDER HEARTBEAT SERVICE — Phase B                          ║
 * ║                                                             ║
 * ║  Tracks rider online/offline state with precision.          ║
 * ║                                                             ║
 * ║  CLIENT: sends heartbeat every 15s while app is open        ║
 * ║  SERVER: marks rider offline if no heartbeat for 2 min      ║
 * ║          runs stale-rider sweep every 60s via cron          ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import type { RiderStatus } from './DeliveryTypes';

// ── CLIENT (browser / React Native) ─────────────────────────────────────
export class RiderHeartbeatClient {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly INTERVAL_MS = 15_000;

  start(riderId: string, getStatus: () => RiderStatus, getOrderId: () => string | undefined): void {
    this.stop();
    const send = () => this._send(riderId, getStatus(), getOrderId());
    send(); // immediate on start
    this.timer = setInterval(send, this.INTERVAL_MS);

    // Mark offline on tab/window close
    const handleUnload = () => this._markOffline(riderId);
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async _send(riderId: string, status: RiderStatus, orderId?: string): Promise<void> {
    try {
      const { db } = await import('../../firebase');
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      await setDoc(doc(db, 'rider_heartbeats', riderId), {
        riderId,
        status,
        orderId: orderId ?? null,
        lastBeat: serverTimestamp(),
        userAgent: navigator.userAgent,
        online: true,
      }, { merge: true });
    } catch (err) {
      console.warn('[RiderHeartbeat] write failed:', err);
    }
  }

  private async _markOffline(riderId: string): Promise<void> {
    try {
      const { db } = await import('../../firebase');
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      await setDoc(doc(db, 'rider_heartbeats', riderId), {
        status: 'offline',
        online: false,
        lastBeat: serverTimestamp(),
      }, { merge: true });
      await setDoc(doc(db, 'riders', riderId), {
        status: 'offline',
        lastSeen: serverTimestamp(),
      }, { merge: true });
    } catch { /* best-effort */ }
  }
}

// ── SERVER (Node.js — called from cron every 60s) ────────────────────────
export class RiderHeartbeatServer {
  static readonly OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

  /**
   * Sweeps `rider_heartbeats` collection.
   * Any rider whose `lastBeat` is older than threshold gets marked offline.
   * Returns list of riders that were transitioned to offline.
   */
  static async sweepStaleRiders(): Promise<string[]> {
    const { db } = await import('../../firebase');
    const { collection, query, where, getDocs, doc, updateDoc, serverTimestamp, Timestamp } = await import('firebase/firestore');

    const cutoff = Timestamp.fromMillis(Date.now() - this.OFFLINE_THRESHOLD_MS);
    const q = query(
      collection(db, 'rider_heartbeats'),
      where('online', '==', true),
      where('lastBeat', '<', cutoff),
    );

    const snap = await getDocs(q);
    const staleRiders: string[] = [];

    const updates = snap.docs.map(async (hbDoc) => {
      const riderId = hbDoc.id;
      staleRiders.push(riderId);

      // Mark heartbeat record offline
      await updateDoc(doc(db, 'rider_heartbeats', riderId), {
        online: false,
        status: 'offline',
      });

      // Update live rider document
      await updateDoc(doc(db, 'riders', riderId), {
        status: 'offline',
        lastSeen: serverTimestamp(),
      });
    });

    await Promise.allSettled(updates);

    if (staleRiders.length > 0) {
      console.log(`[HeartbeatSweep] Marked ${staleRiders.length} rider(s) offline: ${staleRiders.join(', ')}`);
    }

    return staleRiders;
  }

  /**
   * Returns all currently-online riders with their status.
   * "Online" = heartbeat within last 2 min.
   */
  static async getOnlineRiders(): Promise<Array<{ riderId: string; status: RiderStatus; orderId?: string; lastBeat: Date }>> {
    const { db } = await import('../../firebase');
    const { collection, query, where, getDocs } = await import('firebase/firestore');

    const q = query(collection(db, 'rider_heartbeats'), where('online', '==', true));
    const snap = await getDocs(q);

    return snap.docs.map(d => {
      const data = d.data();
      return {
        riderId: d.id,
        status: data.status as RiderStatus,
        orderId: data.orderId ?? undefined,
        lastBeat: data.lastBeat?.toDate?.() ?? new Date(),
      };
    });
  }
}
