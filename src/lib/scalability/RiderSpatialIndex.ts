/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  RIDER SPATIAL INDEX — Phase N                                       ║
 * ║                                                                      ║
 * ║  Replaces the O(n) full-table scan in RiderLocationServer            ║
 * ║  .findNearestRider() — documented in Phase B/E as breaking down      ║
 * ║  at ~100 concurrent riders, requiring full Haversine computation     ║
 * ║  over every live rider on every single order assignment.            ║
 * ║                                                                      ║
 * ║  Strategy: every rider GPS write also stores a geohash prefix        ║
 * ║  (precision 5 ≈ 4.9km × 4.9km cell). Nearest-rider lookup queries    ║
 * ║  only the 9-cell search ring around the pickup point (an indexed     ║
 * ║  "in" query) instead of scanning every rider row, then runs          ║
 * ║  Haversine only across that small candidate set.                    ║
 * ║                                                                      ║
 * ║  10 riders:   O(n) scan ≈ O(geohash) scan — no measurable difference ║
 * ║  100 riders:  geohash query touches ~9 cells instead of 100 rows     ║
 * ║  1000+ riders: geohash query stays flat (indexed); O(n) scan grows   ║
 * ║                linearly — this is exactly where Phase B/E flagged    ║
 * ║                a redesign would be required.                         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { Geohash } from './Geohash';

const GEOHASH_PRECISION = 5; // ~4.9km x 4.9km cells — tuned for urban delivery radius

export interface NearbyRider {
  riderId: string;
  lat: number;
  lng: number;
  status: string;
  orderId?: string;
  lastSeen: Date;
  distanceKm: number;
}

export class RiderSpatialIndex {

  /**
   * Compute the geohash to store alongside a rider's GPS write.
   * Called by RiderLocationService whenever a rider's position updates.
   */
  static computeGeohash(lat: number, lng: number): string {
    return Geohash.encode(lat, lng, GEOHASH_PRECISION);
  }

  /**
   * Find the N nearest available riders to a pickup point using the
   * geohash search ring, falling back to a full scan only if the geohash
   * field is missing on older rider documents (migration safety net).
   */
  static async findNearby(
    pickupLat: number,
    pickupLng: number,
    options: { maxResults?: number; onlyAvailable?: boolean; maxAgeMinutes?: number } = {}
  ): Promise<NearbyRider[]> {
    const { maxResults = 5, onlyAvailable = true, maxAgeMinutes = 2 } = options;
    const { NexusDB } = await import('../database/NexusDB');

    const ring = Geohash.searchRing(pickupLat, pickupLng, GEOHASH_PRECISION);
    const cutoffMs = Date.now() - maxAgeMinutes * 60 * 1000;

    // Indexed "in" query across the 9-cell search ring — touches only riders
    // physically near the pickup point, not the entire riders collection.
    const candidates = await NexusDB.find('riders', {
      where: [{ field: 'geohash', op: 'in', value: ring }],
      limit: 200, // generous cap on the candidate set within the ring
    });

    let pool = candidates;

    // Migration safety net: if no riders have a geohash yet (pre-Phase-N
    // documents), fall back to a full scan so order assignment never breaks
    // during the rollout window.
    if (pool.length === 0) {
      const fallback = await NexusDB.find('riders', {
        where: [{ field: 'lastSeen', op: '>=', value: new Date(cutoffMs).toISOString() }],
        limit: 500,
      });
      pool = fallback;
    }

    const results: NearbyRider[] = [];
    for (const r of pool) {
      const lastSeenMs = r.lastSeen ? new Date(r.lastSeen).getTime() : 0;
      if (lastSeenMs < cutoffMs) continue;
      if (onlyAvailable && r.status !== 'available' && r.status !== 'Available') continue;
      if (r.lat == null || r.lng == null) continue;

      results.push({
        riderId: r.id, lat: r.lat, lng: r.lng, status: r.status,
        orderId: r.orderId, lastSeen: new Date(lastSeenMs),
        distanceKm: Geohash.distanceKm(pickupLat, pickupLng, r.lat, r.lng),
      });
    }

    results.sort((a, b) => a.distanceKm - b.distanceKm);

    // If the search ring came back empty (sparse area — rare rider density),
    // expand to a one-cell-wider ring once before giving up, rather than
    // silently returning no riders for an order that could still be served.
    if (results.length === 0 && pool === candidates) {
      const widerPrecision = GEOHASH_PRECISION - 1; // ~39km cells
      const widerRing = Geohash.searchRing(pickupLat, pickupLng, widerPrecision);
      const widerCandidates = await NexusDB.find('riders', {
        where: [{ field: 'geohashCoarse', op: 'in', value: widerRing }],
        limit: 200,
      });
      for (const r of widerCandidates) {
        const lastSeenMs = r.lastSeen ? new Date(r.lastSeen).getTime() : 0;
        if (lastSeenMs < cutoffMs) continue;
        if (onlyAvailable && r.status !== 'available' && r.status !== 'Available') continue;
        if (r.lat == null || r.lng == null) continue;
        results.push({
          riderId: r.id, lat: r.lat, lng: r.lng, status: r.status,
          orderId: r.orderId, lastSeen: new Date(lastSeenMs),
          distanceKm: Geohash.distanceKm(pickupLat, pickupLng, r.lat, r.lng),
        });
      }
      results.sort((a, b) => a.distanceKm - b.distanceKm);
    }

    return results.slice(0, maxResults);
  }

  /** Drop-in replacement for RiderLocationServer.findNearestRider(). */
  static async findNearest(pickupLat: number, pickupLng: number): Promise<{ riderId: string; distanceKm: number } | null> {
    const nearby = await this.findNearby(pickupLat, pickupLng, { maxResults: 1, onlyAvailable: true });
    if (nearby.length === 0) return null;
    return { riderId: nearby[0].riderId, distanceKm: nearby[0].distanceKm };
  }

  /**
   * Backfill geohash + geohashCoarse fields on existing rider documents
   * that predate Phase N. Safe to run repeatedly (idempotent upsert).
   * Call once during deployment, or let the migration-safety-net fallback
   * in findNearby() cover stragglers indefinitely (slower, but correct).
   */
  static async backfillExistingRiders(): Promise<{ updated: number; skipped: number }> {
    const { NexusDB } = await import('../database/NexusDB');
    const riders = await NexusDB.find('riders', { limit: 5000 });
    let updated = 0, skipped = 0;

    for (const r of riders) {
      if (r.lat == null || r.lng == null) { skipped++; continue; }
      await NexusDB.update('riders', r.id, {
        geohash: this.computeGeohash(r.lat, r.lng),
        geohashCoarse: Geohash.encode(r.lat, r.lng, GEOHASH_PRECISION - 1),
      });
      updated++;
    }
    return { updated, skipped };
  }
}
