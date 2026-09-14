/**
 * DeliveryPerformanceEngine — thin facade
 *
 * `delivery.routes.ts` was written against a module of this name that
 * never existed. The real, working implementations are `FleetOptimizer`
 * (fleet-wide snapshot) and `RiderPerformanceEngine` (per-rider scoring) —
 * both under src/lib/delivery/ — this file exposes them under the
 * name/shape the route expects.
 */
import { FleetOptimizer, FleetSnapshot } from '../delivery/FleetOptimizer';
import { RiderPerformanceEngine } from '../delivery/RiderPerformanceEngine';
import type { RiderPerformance } from '../delivery/DeliveryTypes';

export type { FleetSnapshot, RiderPerformance };

export class DeliveryPerformanceEngine {
  static async getFleetSnapshot(): Promise<FleetSnapshot> {
    return FleetOptimizer.getFleetSnapshot();
  }

  static async getAllRiderStats(): Promise<RiderPerformance[]> {
    return RiderPerformanceEngine.computeAllRiders('7d');
  }

  static async getRiderStats(riderId: string): Promise<RiderPerformance> {
    return RiderPerformanceEngine.getPerformance(riderId, '7d');
  }
}
