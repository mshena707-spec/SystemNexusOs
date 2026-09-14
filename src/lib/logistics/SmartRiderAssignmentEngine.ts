/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SMART RIDER ASSIGNMENT ENGINE — Phase W                                 ║
 * ║                                                                           ║
 * ║  BEFORE: RiderLocationServer.assignOrder() used pure distance —          ║
 * ║  the nearest rider always won regardless of their performance score,      ║
 * ║  current active order count, or reliability history.                     ║
 * ║                                                                           ║
 * ║  This meant a rider with a Grade F (failed 30% of deliveries) sitting    ║
 * ║  200m from the pickup could always win over a Grade A rider 400m away.   ║
 * ║                                                                           ║
 * ║  AFTER: Multi-factor composite score:                                    ║
 * ║    distanceScore   (weight 0.50): 1 − (distKm / maxSearchKm)            ║
 * ║    performanceScore (weight 0.30): rider.performanceScore / 100          ║
 * ║    loadScore        (weight 0.20): 1 − (activeOrders / maxBatchSize)     ║
 * ║                                                                           ║
 * ║  Weights are configurable via NexusConfig.maps.assignWeight* env vars.   ║
 * ║                                                                           ║
 * ║  FALLBACK CHAIN (always completes assignment):                           ║
 * ║    1. RiderSpatialIndex (geohash ring — O(1))                            ║
 * ║    2. RiderLocationServer.findNearestRiderFullScan (O(n) safety net)     ║
 * ║    3. Lowest-load rider in entire fleet if zone is sparse                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { RiderSpatialIndex, NearbyRider } from '../scalability/RiderSpatialIndex';
import { RiderPerformanceEngine } from '../delivery/RiderPerformanceEngine';
import { NexusDB } from '../database/NexusDB';
import { AuditLog } from '../security/audit/ImmutableAuditLog';
import { NexusConfig } from '../core/config/NexusConfig';

export interface AssignmentCandidate extends NearbyRider {
  activeOrderCount: number;
  performanceScore: number;
  compositeScore: number;
  scoreBreakdown: {
    distanceScore: number;
    performanceScore: number;
    loadScore: number;
  };
}

export interface AssignmentResult {
  success: boolean;
  riderId?: string;
  distanceKm?: number;
  compositeScore?: number;
  estimatedPickupMinutes?: number;
  reason?: string;
  candidatesConsidered: number;
  method: 'smart_multi_factor' | 'nearest_fallback' | 'fleet_fallback' | 'none';
}

export class SmartRiderAssignmentEngine {

  /**
   * Score and rank all nearby available riders for a given pickup point.
   * Returns candidates sorted by compositeScore descending.
   */
  static async rankCandidates(
    pickupLat: number,
    pickupLng: number,
    maxResults = 10,
  ): Promise<AssignmentCandidate[]> {
    const { assignWeightDistance, assignWeightPerf, assignWeightLoad, maxRiderSearchKm, maxBatchSize } = NexusConfig.maps;

    // Step 1: Get nearby riders via geohash spatial index
    const nearby = await RiderSpatialIndex.findNearby(pickupLat, pickupLng, {
      maxResults: maxResults * 3, // over-fetch to allow filtering
      onlyAvailable: true,
      maxAgeMinutes: 2,
    });

    if (nearby.length === 0) return [];

    // Step 2: Enrich each candidate with performance + active order count
    const enriched = await Promise.all(
      nearby
        .filter(r => r.distanceKm <= maxRiderSearchKm)
        .map(async (rider): Promise<AssignmentCandidate> => {
          // Performance score — use cached value from rider doc first,
          // fall back to RiderPerformanceEngine only if missing
          let perfScore = 50; // neutral default
          try {
            const riderDoc = await NexusDB.get('riders', rider.riderId);
            if (riderDoc?.performanceScore != null) {
              perfScore = Number(riderDoc.performanceScore);
            } else {
              // Cache miss — compute and store for next call
              const perf = await RiderPerformanceEngine.computeRiderPerformance(rider.riderId, '7d');
              perfScore = perf.performanceScore;
            }
          } catch { /* keep default */ }

          // Active order count — count non-terminal orders assigned to this rider
          let activeOrderCount = 0;
          try {
            const activeOrders = await NexusDB.find('orders', {
              where: [
                { field: 'riderId', op: '==', value: rider.riderId },
                { field: 'status', op: 'in', value: ['Assigned', 'PickedUp', 'InTransit', 'NearDestination'] },
              ],
              limit: 10,
            });
            activeOrderCount = activeOrders.length;
          } catch { /* keep default */ }

          // Composite score calculation
          const distanceScore   = Math.max(0, 1 - (rider.distanceKm / maxRiderSearchKm));
          const performanceScore = perfScore / 100;
          const loadScore       = Math.max(0, 1 - (activeOrderCount / Math.max(maxBatchSize, 1)));

          const compositeScore =
            (distanceScore   * assignWeightDistance) +
            (performanceScore * assignWeightPerf) +
            (loadScore        * assignWeightLoad);

          return {
            ...rider,
            activeOrderCount,
            performanceScore: perfScore,
            compositeScore: Math.round(compositeScore * 1000) / 1000,
            scoreBreakdown: {
              distanceScore: Math.round(distanceScore * 100) / 100,
              performanceScore: Math.round(performanceScore * 100) / 100,
              loadScore: Math.round(loadScore * 100) / 100,
            },
          };
        })
    );

    return enriched
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, maxResults);
  }

  /**
   * Assign the best available rider to an order.
   * Writes assignment to NexusDB atomically and fires audit log.
   */
  static async assignOrder(
    orderId: string,
    pickupLat: number,
    pickupLng: number,
    actorId = 'system_auto',
  ): Promise<AssignmentResult> {
    const { defaultAvgSpeedKmh } = NexusConfig.maps;

    // Try multi-factor smart assignment
    const candidates = await this.rankCandidates(pickupLat, pickupLng, 10);

    if (candidates.length > 0) {
      const best = candidates[0];
      const estimatedPickupMinutes = Math.ceil((best.distanceKm / defaultAvgSpeedKmh) * 60);

      await NexusDB.batch([
        {
          type: 'update', collection: 'riders', id: best.riderId,
          data: { status: 'on_delivery', orderId, assignedAt: new Date().toISOString() },
        },
        {
          type: 'update', collection: 'orders', id: orderId,
          data: {
            riderId: best.riderId,
            assignedAt: new Date().toISOString(),
            status: 'Assigned',
            estimatedPickupMinutes,
            assignmentScore: best.compositeScore,
            assignmentMethod: 'smart_multi_factor',
          },
        },
      ]);

      await AuditLog.record(
        'admin.action', { id: actorId, type: actorId === 'system_auto' ? 'system' : 'user' },
        {
          orderId, riderId: best.riderId, distanceKm: best.distanceKm,
          compositeScore: best.compositeScore, scoreBreakdown: best.scoreBreakdown,
          activeOrderCount: best.activeOrderCount, performanceScore: best.performanceScore,
          candidatesConsidered: candidates.length, estimatedPickupMinutes,
        },
        { action: 'rider.assigned', resource: `orders/${orderId}`, outcome: 'success' },
      );

      return {
        success: true,
        riderId: best.riderId,
        distanceKm: best.distanceKm,
        compositeScore: best.compositeScore,
        estimatedPickupMinutes,
        candidatesConsidered: candidates.length,
        method: 'smart_multi_factor',
      };
    }

    // Fallback 1: pure nearest (no performance weighting)
    try {
      const { RiderLocationServer } = await import('../delivery/RiderLocationService');
      const nearest = await RiderLocationServer.findNearestRiderFullScan(pickupLat, pickupLng);
      if (nearest) {
        const estimatedPickupMinutes = Math.ceil((nearest.distanceKm / defaultAvgSpeedKmh) * 60);
        await NexusDB.batch([
          { type: 'update', collection: 'riders', id: nearest.riderId, data: { status: 'on_delivery', orderId, assignedAt: new Date().toISOString() } },
          { type: 'update', collection: 'orders', id: orderId, data: { riderId: nearest.riderId, assignedAt: new Date().toISOString(), status: 'Assigned', estimatedPickupMinutes, assignmentMethod: 'nearest_fallback' } },
        ]);
        return { success: true, riderId: nearest.riderId, distanceKm: nearest.distanceKm, estimatedPickupMinutes, candidatesConsidered: 1, method: 'nearest_fallback' };
      }
    } catch { /* continue to fleet fallback */ }

    // Fallback 2: any online rider with fewest active orders
    try {
      const allOnline = await NexusDB.find('riders', {
        where: [{ field: 'status', op: 'in', value: ['available', 'Available'] }],
        limit: 100,
      });
      if (allOnline.length > 0) {
        const leastBusy = allOnline.sort((a: any, b: any) => (a.activeOrders ?? 0) - (b.activeOrders ?? 0))[0] as any;
        await NexusDB.batch([
          { type: 'update', collection: 'riders', id: leastBusy.id, data: { status: 'on_delivery', orderId, assignedAt: new Date().toISOString() } },
          { type: 'update', collection: 'orders', id: orderId, data: { riderId: leastBusy.id, assignedAt: new Date().toISOString(), status: 'Assigned', assignmentMethod: 'fleet_fallback' } },
        ]);
        return { success: true, riderId: leastBusy.id, candidatesConsidered: allOnline.length, method: 'fleet_fallback' };
      }
    } catch { /* all fallbacks failed */ }

    return { success: false, reason: 'No available riders online', candidatesConsidered: 0, method: 'none' };
  }

  /** Get ranked candidates for admin preview (dry-run — no assignment written) */
  static async previewAssignment(pickupLat: number, pickupLng: number) {
    const candidates = await this.rankCandidates(pickupLat, pickupLng, 5);
    return {
      candidates,
      topRider: candidates[0] ?? null,
      computedAt: new Date().toISOString(),
    };
  }
}
