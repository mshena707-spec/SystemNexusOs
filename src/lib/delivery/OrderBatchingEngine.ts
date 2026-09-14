/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ORDER BATCHING ENGINE — Phase B (upgraded Phase W)         ║
 * ║                                                             ║
 * ║  Phase W changes:                                           ║
 * ║  1. AVG_STOP_MINUTES = 8 hardcoded constant REMOVED.       ║
 * ║     Replaced with RouteOptimizationEngine.optimize() which ║
 * ║     uses TSP nearest-neighbor + real ETA (Google or        ║
 * ║     Haversine fallback).                                    ║
 * ║  2. Pure-distance rider selection REPLACED with            ║
 * ║     SmartRiderAssignmentEngine which scores distance (50%), ║
 * ║     performance (30%), and current load (20%).             ║
 * ║  3. Navigation deep-link added to batch record for rider    ║
 * ║     mobile app.                                            ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import type { OrderBatch } from './DeliveryTypes';
import { SmartRiderAssignmentEngine } from '../logistics/SmartRiderAssignmentEngine';
import { RouteOptimizationEngine, RouteStop } from '../logistics/RouteOptimizationEngine';
import { NexusConfig } from '../core/config/NexusConfig';

const MAX_BATCH_RADIUS_KM = NexusConfig.maps.maxBatchRadiusKm;
const MAX_ORDERS_PER_BATCH = NexusConfig.maps.maxBatchSize;

export class OrderBatchingEngine {
  /**
   * Create an optimized batch for a given pickup area.
   * Phase W: uses SmartRiderAssignment + RouteOptimization instead of
   * pure distance + hardcoded ETA.
   */
  static async createBatch(
    pickupLat: number,
    pickupLng: number,
    maxOrders = MAX_ORDERS_PER_BATCH,
  ): Promise<OrderBatch | null> {
    const { db } = await import('../../firebase');
    const {
      collection, query, where, orderBy, limit,
      getDocs, doc, writeBatch, serverTimestamp, Timestamp,
    } = await import('firebase/firestore');

    const since = Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000);
    const q = query(
      collection(db, 'orders'),
      where('status', 'in', ['Confirmed', 'Pending']),
      where('riderId', '==', null),
      where('createdAt', '>=', since),
      orderBy('createdAt', 'asc'),
      limit(20),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const candidates = snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as any)
      .filter(o => o.pickupLat != null && o.pickupLng != null);
    if (candidates.length === 0) return null;

    // Filter to orders within MAX_BATCH_RADIUS_KM of the pickup point
    const nearby = candidates
      .filter(o => _haversine(pickupLat, pickupLng, o.pickupLat, o.pickupLng) <= MAX_BATCH_RADIUS_KM)
      .slice(0, maxOrders);
    if (nearby.length === 0) return null;

    // Phase W: Smart rider assignment (multi-factor scoring)
    const assignResult = await SmartRiderAssignmentEngine.assignOrder(
      `BATCH-PRE-${Date.now()}`, // placeholder — real orderId assigned per order below
      pickupLat, pickupLng, 'system_batch',
    );
    if (!assignResult.success || !assignResult.riderId) return null;

    // Phase W: Route optimization with real ETA
    const pickupStop: RouteStop = {
      id: 'pickup', lat: pickupLat, lng: pickupLng,
      label: 'Pickup point', stopType: 'pickup',
    };
    const deliveryStops: RouteStop[] = nearby.map(o => ({
      id: o.id,
      lat: o.deliveryLat ?? o.pickupLat,
      lng: o.deliveryLng ?? o.pickupLng,
      label: o.deliveryAddress ?? `Order ${o.id.slice(0, 6)}`,
      stopType: 'delivery' as const,
    }));

    const optimizedRoute = await RouteOptimizationEngine.optimize(pickupStop, deliveryStops);
    const navLink = RouteOptimizationEngine.buildNavigationLink(optimizedRoute.stops);
    const batchId = `BATCH-${Date.now().toString(36).toUpperCase()}`;

    const batchRecord: OrderBatch = {
      batchId,
      riderId: assignResult.riderId,
      orders: nearby.map(o => o.id),
      createdAt: new Date(),
      totalStops: nearby.length,
      estimatedMinutes: optimizedRoute.totalEstimatedMinutes,  // Phase W: real ETA
      routePoints: optimizedRoute.stops.map(s => ({
        lat: s.lat, lng: s.lng, timestamp: Date.now(),
      })),
    };

    const wb = writeBatch(db);
    wb.set(doc(collection(db, 'order_batches')), {
      ...batchRecord,
      createdAt: serverTimestamp(),
      optimizedRoute,
      navigationLink: navLink,
      assignmentScore: assignResult.compositeScore,
      assignmentMethod: assignResult.method,
      etaSource: optimizedRoute.etaSource,
    });

    for (const order of nearby) {
      wb.update(doc(db, 'orders', order.id), {
        riderId: assignResult.riderId,
        batchId,
        status: 'Assigned',
        assignedAt: serverTimestamp(),
        estimatedDeliveryMinutes: optimizedRoute.stops.find(s => s.id === order.id)?.estimatedArrivalMinutes,
      });
    }

    wb.update(doc(db, 'riders', assignResult.riderId), {
      status: 'on_delivery', batchId,
    });

    await wb.commit();
    return batchRecord;
  }

  static async getActiveBatches(): Promise<OrderBatch[]> {
    const { db } = await import('../../firebase');
    const { collection, query, where, getDocs, Timestamp } = await import('firebase/firestore');
    const since = Timestamp.fromMillis(Date.now() - 4 * 60 * 60 * 1000);
    const q = query(collection(db, 'order_batches'), where('createdAt', '>=', since));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as OrderBatch);
  }
}

function _haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

