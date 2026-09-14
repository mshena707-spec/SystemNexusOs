/**
 * Delivery Routes — /api/delivery/* and /api/orders/*
 *
 * Extracted from server.ts (Part 13 decomposition).
 * Covers: rider assignment, route optimization, ETA, fleet management,
 * order tracking, SLA monitoring, batch delivery, COD fraud detection.
 */

import { Router, Request, Response } from 'express';
import { requireAdminAuth, requireAuth } from '../middleware/AuthMiddleware';

export function createDeliveryRouter(): Router {
  const router = Router();

  // ── Rider assignment ────────────────────────────────────────────────────────

  router.post('/assign', requireAdminAuth, async (req: Request, res: Response) => {
    const { orderId, pickupLat, pickupLng } = req.body;
    if (!orderId || pickupLat == null || pickupLng == null) {
      res.status(400).json({ error: 'orderId, pickupLat, pickupLng required' }); return;
    }
    try {
      const { SmartRiderAssignmentEngine } = await import('../../lib/logistics/SmartRiderAssignmentEngine');
      res.json(await SmartRiderAssignmentEngine.assignOrder(orderId, Number(pickupLat), Number(pickupLng), (req as any).authUser?.uid || 'owner'));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/assign/preview', requireAdminAuth, async (req: Request, res: Response) => {
    const { pickupLat, pickupLng } = req.body;
    if (pickupLat == null || pickupLng == null) { res.status(400).json({ error: 'pickupLat, pickupLng required' }); return; }
    try {
      const { SmartRiderAssignmentEngine } = await import('../../lib/logistics/SmartRiderAssignmentEngine');
      res.json(await SmartRiderAssignmentEngine.previewAssignment(Number(pickupLat), Number(pickupLng)));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Route optimization ─────────────────────────────────────────────────────

  router.post('/route/optimize', requireAdminAuth, async (req: Request, res: Response) => {
    const { pickupLat, pickupLng, deliveries } = req.body;
    if (pickupLat == null || pickupLng == null || !Array.isArray(deliveries)) {
      res.status(400).json({ error: 'pickupLat, pickupLng, deliveries[] required' }); return;
    }
    try {
      const { RouteOptimizationEngine } = await import('../../lib/logistics/RouteOptimizationEngine');
      const pickup = { id: 'pickup', lat: Number(pickupLat), lng: Number(pickupLng), stopType: 'pickup' as const, label: 'Pickup' };
      const stops  = (deliveries as any[]).map((d: any) => ({ id: d.id, lat: Number(d.lat), lng: Number(d.lng), stopType: 'delivery' as const, label: d.label }));
      res.json(await RouteOptimizationEngine.optimize(pickup, stops));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── ETA ────────────────────────────────────────────────────────────────────

  router.get('/eta', requireAdminAuth, async (req: Request, res: Response) => {
    const { fromLat, fromLng, toLat, toLng } = req.query as Record<string, string>;
    if (!fromLat || !fromLng || !toLat || !toLng) { res.status(400).json({ error: 'fromLat, fromLng, toLat, toLng required' }); return; }
    try {
      const { RouteOptimizationEngine } = await import('../../lib/logistics/RouteOptimizationEngine');
      res.json(await RouteOptimizationEngine.computeSingleETA(Number(fromLat), Number(fromLng), Number(toLat), Number(toLng)));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/eta/:orderId', async (req: Request, res: Response) => {
    try {
      const { OrderTimelineService } = await import('../../lib/commerce/OrderTimelineService');
      const status = await OrderTimelineService.getTrackingView(req.params.orderId);
      res.json(status);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Fleet management ───────────────────────────────────────────────────────

  router.get('/riders/live',      requireAdminAuth, async (_req: any, res: any) => {
    try { const { NexusDB } = await import('../../lib/database/NexusDB'); res.json(await NexusDB.find('riders', { where: [{ field: 'status', op: '==', value: 'online' }], limit: 200 })); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/riders/online',    requireAdminAuth, async (_req: any, res: any) => {
    try { const { NexusDB } = await import('../../lib/database/NexusDB'); res.json(await NexusDB.find('riders', { where: [{ field: 'available', op: '==', value: true }], limit: 200 })); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/fleet-snapshot',   requireAdminAuth, async (_req: any, res: any) => {
    try { const { DeliveryPerformanceEngine } = await import('../../lib/logistics/DeliveryPerformanceEngine'); res.json(await DeliveryPerformanceEngine.getFleetSnapshot()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/sla-alerts',       requireAdminAuth, async (_req: any, res: any) => {
    try { const { SLAMonitor } = await import('../../lib/delivery/SLAMonitor'); res.json(await SLAMonitor.getActiveAlerts()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/all-performance',  requireAdminAuth, async (_req: any, res: any) => {
    try { const { DeliveryPerformanceEngine } = await import('../../lib/logistics/DeliveryPerformanceEngine'); res.json(await DeliveryPerformanceEngine.getAllRiderStats()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/rider-performance/:riderId', requireAdminAuth, async (req: any, res: any) => {
    try { const { DeliveryPerformanceEngine } = await import('../../lib/logistics/DeliveryPerformanceEngine'); res.json(await DeliveryPerformanceEngine.getRiderStats(req.params.riderId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/rider-fraud/:riderId', requireAdminAuth, async (req: any, res: any) => {
    try { const { RiderFraudDetector } = await import('../../lib/delivery/RiderFraudDetector'); res.json(await RiderFraudDetector.analyzeRider(req.params.riderId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Batch delivery ─────────────────────────────────────────────────────────

  router.post('/batch', requireAdminAuth, async (req: Request, res: Response) => {
    try { const { BatchDeliveryEngine } = await import('../../lib/logistics/BatchDeliveryEngine'); res.json(await BatchDeliveryEngine.createBatch(req.body.orderIds, req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/batches', requireAdminAuth, async (_req: any, res: any) => {
    try { const { BatchDeliveryEngine } = await import('../../lib/logistics/BatchDeliveryEngine'); res.json(await BatchDeliveryEngine.listActiveBatches()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Status & timeline ──────────────────────────────────────────────────────

  router.post('/status', async (req: Request, res: Response) => {
    const { orderId, status, riderId } = req.body;
    if (!orderId || !status) { res.status(400).json({ error: 'orderId and status required' }); return; }
    try {
      const { OrderTimelineService } = await import('../../lib/commerce/OrderTimelineService');
      await OrderTimelineService.addEvent(orderId, status, { actor: riderId });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/timeline/:orderId', async (req: Request, res: Response) => {
    try {
      const { OrderTimelineService } = await import('../../lib/commerce/OrderTimelineService');
      res.json(await OrderTimelineService.get(req.params.orderId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/route-replay/:orderId', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('../../lib/database/NexusDB');
      res.json(await NexusDB.get('order_timelines', req.params.orderId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}

export function createOrdersRouter(): Router {
  const router = Router();

  router.get('/:orderId/tracking', async (req: Request, res: Response) => {
    try {
      const { OrderTimelineService } = await import('../../lib/commerce/OrderTimelineService');
      res.json(await OrderTimelineService.getTrackingView(req.params.orderId));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/:orderId/status', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { OrderTimelineService } = await import('../../lib/commerce/OrderTimelineService');
      await OrderTimelineService.addEvent(req.params.orderId, req.body.status, req.body);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/cod-fraud-check', async (req: Request, res: Response) => {
    try {
      const { CODFraudDetector } = await import('../../lib/security/fraud/CODFraudDetector');
      res.json(await CODFraudDetector.assess(req.body));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}

export function createCommerceRouter(): Router {
  const router = Router();

  router.post('/tax/calculate', async (req: Request, res: Response) => {
    try { const { TaxEngine } = await import('../../lib/tax/TaxEngine'); const { items, country, ...options } = req.body; res.json(await TaxEngine.calculateForCart(items, country, options)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/tax/rules', async (_req: any, res: any) => {
    try { const { TaxEngine } = await import('../../lib/tax/TaxEngine'); res.json(await TaxEngine.getRules((_req.query.country as string) || 'BD')); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/inventory/reserve', async (req: Request, res: Response) => {
    try {
      const { InventoryReservationService } = await import('../../lib/commerce/InventoryReservationService');
      const { productId, quantity, userId, sessionId, variantId } = req.body;
      res.json(await InventoryReservationService.reserve(productId, quantity, userId, sessionId, variantId));
    }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/inventory/check/:productId', async (req: Request, res: Response) => {
    try { const { InventoryReservationService } = await import('../../lib/commerce/InventoryReservationService'); const qty = parseInt((req.query.qty as string) || '1'); res.json(await InventoryReservationService.checkAvailability(req.params.productId, qty, req.query.variantId as string | undefined)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/inventory/reserve/:id', async (req: Request, res: Response) => {
    try { const { InventoryReservationService } = await import('../../lib/commerce/InventoryReservationService'); await InventoryReservationService.releaseReservation(req.params.id); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/calculate-discounts', async (req: Request, res: Response) => {
    try {
      const { CouponEngine } = await import('../../lib/promotions/CouponEngine');
      const { code, customerId, orderSubtotal } = req.body;
      res.json(await CouponEngine.validate(code, customerId, orderSubtotal, { ipAddress: req.ip }));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.put('/discount-policy', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { BusinessPolicyEngine } = await import('../../lib/policy/BusinessPolicyEngine');
      const id = await BusinessPolicyEngine.createPolicy({ ...req.body, domain: 'discount' }, (req as any).authUser?.uid || 'admin');
      res.json({ success: true, id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}
