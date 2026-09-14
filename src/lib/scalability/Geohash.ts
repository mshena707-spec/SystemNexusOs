/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  GEOHASH UTILITY — Phase N                                           ║
 * ║                                                                      ║
 * ║  Pure-function geohash encode/decode/neighbor calculation.           ║
 * ║  No external dependency — standard base32 geohash algorithm.         ║
 * ║                                                                      ║
 * ║  Used by RiderSpatialIndex to replace O(n) full-table Haversine      ║
 * ║  scans with O(log n) prefix-range Firestore/SQL queries.             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export class Geohash {

  /** Encode lat/lng into a geohash string of given precision (default 7 ≈ 153m × 153m cell). */
  static encode(lat: number, lng: number, precision = 7): string {
    let latRange = [-90, 90];
    let lngRange = [-180, 180];
    let hash = '';
    let isEven = true;
    let bit = 0;
    let ch = 0;

    while (hash.length < precision) {
      if (isEven) {
        const mid = (lngRange[0] + lngRange[1]) / 2;
        if (lng >= mid) { ch |= (1 << (4 - bit)); lngRange[0] = mid; }
        else { lngRange[1] = mid; }
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (lat >= mid) { ch |= (1 << (4 - bit)); latRange[0] = mid; }
        else { latRange[1] = mid; }
      }
      isEven = !isEven;
      if (bit < 4) bit++;
      else { hash += BASE32[ch]; bit = 0; ch = 0; }
    }
    return hash;
  }

  /** Decode a geohash back to its center lat/lng + the bounding box error margin. */
  static decode(hash: string): { lat: number; lng: number; latError: number; lngError: number } {
    let latRange = [-90, 90];
    let lngRange = [-180, 180];
    let isEven = true;

    for (const c of hash) {
      const idx = BASE32.indexOf(c);
      for (let bit = 4; bit >= 0; bit--) {
        const bitVal = (idx >> bit) & 1;
        if (isEven) {
          const mid = (lngRange[0] + lngRange[1]) / 2;
          if (bitVal === 1) lngRange[0] = mid; else lngRange[1] = mid;
        } else {
          const mid = (latRange[0] + latRange[1]) / 2;
          if (bitVal === 1) latRange[0] = mid; else latRange[1] = mid;
        }
        isEven = !isEven;
      }
    }
    return {
      lat: (latRange[0] + latRange[1]) / 2,
      lng: (lngRange[0] + lngRange[1]) / 2,
      latError: (latRange[1] - latRange[0]) / 2,
      lngError: (lngRange[1] - lngRange[0]) / 2,
    };
  }

  /**
   * Return the geohash and its 8 neighbors (N, NE, E, SE, S, SW, W, NW) at
   * the same precision. Used to build a search ring around a point so that
   * riders just across a cell boundary aren't missed.
   */
  static neighbors(hash: string): string[] {
    const { lat, lng, latError, lngError } = this.decode(hash);
    const precision = hash.length;
    const dLat = latError * 2;
    const dLng = lngError * 2;

    const offsets = [
      [1, 0], [1, 1], [0, 1], [-1, 1],
      [-1, 0], [-1, -1], [0, -1], [1, -1],
    ];

    return offsets.map(([dy, dx]) =>
      this.encode(lat + dy * dLat, lng + dx * dLng, precision)
    );
  }

  /** Convenience: hash + all 8 neighbors, deduplicated. */
  static searchRing(lat: number, lng: number, precision = 5): string[] {
    const center = this.encode(lat, lng, precision);
    const ring = this.neighbors(center);
    return Array.from(new Set([center, ...ring]));
  }

  /** Haversine distance in km — kept here so RiderSpatialIndex has no other dependency. */
  static distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
}
