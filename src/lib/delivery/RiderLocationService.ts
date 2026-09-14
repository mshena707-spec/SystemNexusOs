/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         RIDER LOCATION SERVICE — Phase A/B                   ║
 * ║                                                              ║
 * ║  Replaces all Math.random() { x, y } GPS simulation.        ║
 * ║                                                              ║
 * ║  CLIENT SIDE: watchPosition() → heartbeat write to Firestore ║
 * ║  SERVER SIDE: history, SLA, delay detection, breadcrumbs     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ── Shared Types ───────────────────────────────────────────────────────────
export interface GpsCoord {
  lat: number;
  lng: number;
  accuracy?: number;       // metres
  heading?: number;        // degrees 0-360
  speed?: number;          // m/s
  timestamp: number;       // Unix ms
}

export interface RiderHeartbeat {
  riderId: string;
  coord: GpsCoord;
  status: 'available' | 'on_delivery' | 'offline';
  orderId?: string;
  batteryLevel?: number;   // 0-100
  appVersion?: string;
}

export interface BreadcrumbEntry extends GpsCoord {
  orderId?: string;
}

// ═══════════════════════════════════════════════════════════════
// CLIENT-SIDE: runs inside RiderDashboard (browser)
// ═══════════════════════════════════════════════════════════════
export class RiderGpsClient {
  private watchId: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastCoord: GpsCoord | null = null;
  private readonly HEARTBEAT_INTERVAL = 10_000; // 10 s

  /**
   * Start tracking. Writes real GPS to Firestore every 10 s
   * (or whenever position changes by > 10 m).
   */
  start(
    riderId: string,
    status: 'available' | 'on_delivery' | 'offline',
    orderId?: string,
    onCoord?: (c: GpsCoord) => void
  ): void {
    if (!navigator.geolocation) {
      console.error('[RiderGps] Geolocation API not available in this browser.');
      return;
    }

    const writeHeartbeat = (coord: GpsCoord) => {
      this.lastCoord = coord;
      if (onCoord) onCoord(coord);
      const payload: RiderHeartbeat = { riderId, coord, status, orderId };
      this._persistToFirestore(payload);
    };

    // High-accuracy watch
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coord: GpsCoord = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading ?? undefined,
          speed: pos.coords.speed ?? undefined,
          timestamp: pos.timestamp,
        };
        writeHeartbeat(coord);
      },
      (err) => console.error('[RiderGps] watchPosition error', err),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 }
    );

    // Fallback heartbeat: ensures a write even if position hasn't changed
    this.heartbeatTimer = setInterval(() => {
      if (this.lastCoord) writeHeartbeat(this.lastCoord);
    }, this.HEARTBEAT_INTERVAL);
  }

  stop(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.watchId = null;
    this.heartbeatTimer = null;
  }

  private async _persistToFirestore(hb: RiderHeartbeat): Promise<void> {
    try {
      const { db } = await import('../../firebase');
      const { doc, setDoc, addDoc, collection, serverTimestamp } = await import('firebase/firestore');

      // Phase N: compute geohash for spatial-index nearest-rider lookups
      let geohash: string | undefined;
      let geohashCoarse: string | undefined;
      try {
        const { Geohash } = await import('../scalability/Geohash');
        geohash = Geohash.encode(hb.coord.lat, hb.coord.lng, 5);
        geohashCoarse = Geohash.encode(hb.coord.lat, hb.coord.lng, 4);
      } catch { /* non-fatal — RiderSpatialIndex falls back to full scan */ }

      // 1. Update live rider document
      await setDoc(doc(db, 'riders', hb.riderId), {
        status: hb.status,
        lat: hb.coord.lat,
        lng: hb.coord.lng,
        accuracy: hb.coord.accuracy ?? null,
        heading: hb.coord.heading ?? null,
        speed: hb.coord.speed ?? null,
        orderId: hb.orderId ?? null,
        lastSeen: serverTimestamp(),
        ...(geohash ? { geohash, geohashCoarse } : {}),
      }, { merge: true });

      // 2. Append to breadcrumb history (for route replay)
      await addDoc(collection(db, 'rider_breadcrumbs'), {
        riderId: hb.riderId,
        lat: hb.coord.lat,
        lng: hb.coord.lng,
        accuracy: hb.coord.accuracy ?? null,
        heading: hb.coord.heading ?? null,
        speed: hb.coord.speed ?? null,
        orderId: hb.orderId ?? null,
        ts: hb.coord.timestamp,
        recordedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[RiderGps] Firestore write failed', err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SERVER-SIDE: delivery analytics, SLA monitoring, delay detect
// ═══════════════════════════════════════════════════════════════
export class RiderLocationServer {
  /**
   * Get latest position for all online riders.
   * Used by FleetManager and nearest-rider assignment.
   */
  static async getLiveRiders(): Promise<Array<{ riderId: string; lat: number; lng: number; status: string; orderId?: string; lastSeen: Date }>> {
    const { db } = await import('../../firebase');
    const { collection, query, where, getDocs, Timestamp } = await import('firebase/firestore');

    // Riders seen in the last 2 minutes
    const cutoff = Timestamp.fromMillis(Date.now() - 2 * 60 * 1000);
    const q = query(
      collection(db, 'riders'),
      where('lastSeen', '>=', cutoff)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        riderId: d.id,
        lat: data.lat ?? 0,
        lng: data.lng ?? 0,
        status: data.status ?? 'offline',
        orderId: data.orderId,
        lastSeen: data.lastSeen?.toDate?.() ?? new Date(),
      };
    });
  }

  /**
   * Breadcrumb history for route replay.
   * Returns ordered list of GPS points for a given orderId.
   */
  static async getRouteReplay(orderId: string): Promise<BreadcrumbEntry[]> {
    const { db } = await import('../../firebase');
    const { collection, query, where, orderBy, getDocs } = await import('firebase/firestore');
    const q = query(
      collection(db, 'rider_breadcrumbs'),
      where('orderId', '==', orderId),
      orderBy('ts', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return { lat: data.lat, lng: data.lng, accuracy: data.accuracy, heading: data.heading, speed: data.speed, timestamp: data.ts, orderId: data.orderId };
    });
  }

  /**
   * Haversine distance in kilometres between two GPS points.
   */
  static distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /**
   * Find the nearest available rider to a delivery pickup point.
   * Returns null if no riders online.
   *
   * Phase N: delegates to RiderSpatialIndex, which queries only the 9-cell
   * geohash ring around the pickup point instead of scanning every live
   * rider. Falls back to the legacy full O(n) scan (kept below as
   * findNearestRiderFullScan) if the spatial index import fails for any
   * reason, so order assignment never breaks during rollout.
   */
  static async findNearestRider(pickupLat: number, pickupLng: number): Promise<{ riderId: string; distanceKm: number } | null> {
    try {
      const { RiderSpatialIndex } = await import('../scalability/RiderSpatialIndex');
      return await RiderSpatialIndex.findNearest(pickupLat, pickupLng);
    } catch (err) {
      console.warn('[RiderLocationServer] Spatial index unavailable, falling back to full scan:', err);
      return this.findNearestRiderFullScan(pickupLat, pickupLng);
    }
  }

  /**
   * Legacy O(n) implementation — scans every live rider with Haversine.
   * Documented (Phase B/E) as breaking down past ~100 concurrent riders.
   * Kept only as the fallback path for findNearestRider() above.
   */
  static async findNearestRiderFullScan(pickupLat: number, pickupLng: number): Promise<{ riderId: string; distanceKm: number } | null> {
    const riders = await this.getLiveRiders();
    const available = riders.filter(r => r.status === 'available' || r.status === 'Available');
    if (available.length === 0) return null;

    let nearest: { riderId: string; distanceKm: number } | null = null;
    for (const rider of available) {
      const dist = this.distanceKm({ lat: pickupLat, lng: pickupLng }, { lat: rider.lat, lng: rider.lng });
      if (!nearest || dist < nearest.distanceKm) {
        nearest = { riderId: rider.riderId, distanceKm: dist };
      }
    }
    return nearest;
  }

  /**
   * Assign an order to nearest available rider.
   * Writes assignment to Firestore and updates rider status.
   */
  static async assignOrder(orderId: string, pickupLat: number, pickupLng: number): Promise<{ success: boolean; riderId?: string; error?: string }> {
    const nearest = await this.findNearestRider(pickupLat, pickupLng);
    if (!nearest) return { success: false, error: 'No available riders online' };

    try {
      // Phase E: Use NexusDB abstraction — works with any configured DB_PROVIDER
      const { NexusDB } = await import('../database/NexusDB');

      await NexusDB.batch([
        {
          type: 'update',
          collection: 'riders',
          id: nearest.riderId,
          data: { status: 'on_delivery', orderId, assignedAt: new Date().toISOString() },
        },
        {
          type: 'update',
          collection: 'orders',
          id: orderId,
          data: { riderId: nearest.riderId, assignedAt: new Date().toISOString(), status: 'Assigned' },
        },
      ]);

      return { success: true, riderId: nearest.riderId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Detect delivery SLA breach.
   * Returns true if order is older than slaMinutes and not delivered.
   */
  static async detectSLABreach(orderId: string, slaMinutes = 45): Promise<boolean> {
    const { db } = await import('../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'orders', orderId));
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.status === 'Delivered') return false;
    const createdAt: Date = data.createdAt?.toDate?.() ?? new Date(data.createdAt);
    const elapsed = (Date.now() - createdAt.getTime()) / 60_000;
    return elapsed > slaMinutes;
  }
}
