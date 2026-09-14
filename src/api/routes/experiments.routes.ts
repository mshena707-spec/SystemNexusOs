/**
 * Experiments & Business Policy Routes
 *
 * New routes added in Part 12 to expose the ExperimentationEngine and
 * BusinessPolicyEngine to the admin UI and owner dashboard.
 *
 * All routes require admin/CEO authentication.
 */

import { Router, Request, Response } from 'express';
import { requireAdminAuth } from '../middleware/AuthMiddleware';

export function createExperimentsRouter(): Router {
  const router = Router();

  // ── Experiments ─────────────────────────────────────────────────────────────

  // GET /api/admin/experiments — list all experiments
  router.get('/', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('../../lib/database/NexusDB');
      const experiments = await NexusDB.find('experiments', { limit: 100 });
      res.json({ experiments });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/experiments — create new experiment
  router.post('/', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ExperimentationEngine } = await import('../../lib/experiments/ExperimentationEngine');
      const id = await ExperimentationEngine.create(req.body);
      res.status(201).json({ id, message: 'Experiment created in draft status. Call /start to activate.' });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // POST /api/admin/experiments/:id/start
  router.post('/:id/start', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ExperimentationEngine } = await import('../../lib/experiments/ExperimentationEngine');
      await ExperimentationEngine.start(req.params.id);
      res.json({ success: true, status: 'running' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/experiments/:id/pause
  router.post('/:id/pause', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ExperimentationEngine } = await import('../../lib/experiments/ExperimentationEngine');
      await ExperimentationEngine.pause(req.params.id);
      res.json({ success: true, status: 'paused' });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/experiments/:id/conclude
  router.post('/:id/conclude', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { winnerVariantId } = req.body;
      if (!winnerVariantId) { res.status(400).json({ error: 'winnerVariantId required' }); return; }
      const { ExperimentationEngine } = await import('../../lib/experiments/ExperimentationEngine');
      await ExperimentationEngine.conclude(req.params.id, winnerVariantId);
      res.json({ success: true, status: 'concluded', winnerVariantId });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/admin/experiments/:id/results
  router.get('/:id/results', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ExperimentationEngine } = await import('../../lib/experiments/ExperimentationEngine');
      const results = await ExperimentationEngine.getResults(req.params.id);
      res.json({ results });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/experiments/assign — get variant for a user (for preview/testing)
  router.post('/assign', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { experimentId, userId } = req.body;
      if (!experimentId || !userId) { res.status(400).json({ error: 'experimentId and userId required' }); return; }
      const { ExperimentationEngine } = await import('../../lib/experiments/ExperimentationEngine');
      const assignment = await ExperimentationEngine.assign(experimentId, userId);
      res.json(assignment);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}

export function createFeatureFlagsRouter(): Router {
  const router = Router();

  // GET /api/admin/feature-flags — list all flags
  router.get('/', requireAdminAuth, async (_req: Request, res: Response) => {
    try {
      const { NexusDB } = await import('../../lib/database/NexusDB');
      const flags = await NexusDB.find('feature_flags', { limit: 200 });
      res.json({ flags });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // PUT /api/admin/feature-flags/:key — set flag
  router.put('/:key', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { ExperimentationEngine } = await import('../../lib/experiments/ExperimentationEngine');
      const { enabled, rolloutPct, userOverrides } = req.body;
      await ExperimentationEngine.setFlag(req.params.key, enabled, { rolloutPct, userOverrides });
      res.json({ success: true, key: req.params.key, enabled });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/feature-flags/check — check a flag for the current user (no auth needed)
  router.get('/check/:key', async (req: Request, res: Response) => {
    try {
      const { ExperimentationEngine } = await import('../../lib/experiments/ExperimentationEngine');
      const userId = (req as any).authUser?.uid;
      const enabled = await ExperimentationEngine.isEnabled(req.params.key, { userId });
      res.json({ key: req.params.key, enabled });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}

export function createPoliciesRouter(): Router {
  const router = Router();

  // GET /api/admin/policies — list policies, optionally filtered by domain
  router.get('/', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { BusinessPolicyEngine } = await import('../../lib/policy/BusinessPolicyEngine');
      const domain = req.query.domain as any;
      const policies = await BusinessPolicyEngine.listPolicies(domain);
      res.json({ policies });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/policies — create new policy
  router.post('/', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { BusinessPolicyEngine } = await import('../../lib/policy/BusinessPolicyEngine');
      const createdBy = (req as any).authUser?.uid || 'admin';
      const id = await BusinessPolicyEngine.createPolicy(req.body, createdBy);
      res.status(201).json({ id });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // PUT /api/admin/policies/:id — update policy
  router.put('/:id', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { BusinessPolicyEngine } = await import('../../lib/policy/BusinessPolicyEngine');
      const updatedBy = (req as any).authUser?.uid || 'admin';
      await BusinessPolicyEngine.updatePolicy(req.params.id, req.body, updatedBy);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/admin/policies/evaluate — test a policy against a context (for owner preview)
  router.post('/evaluate', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const { BusinessPolicyEngine } = await import('../../lib/policy/BusinessPolicyEngine');
      const { domain, context } = req.body;
      if (!domain || !context) { res.status(400).json({ error: 'domain and context required' }); return; }
      const result = await BusinessPolicyEngine.evaluate(domain, context);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/policies/can-return — check return eligibility (customer-facing)
  router.post('/can-return', async (req: Request, res: Response) => {
    try {
      const { orderId, daysSinceDelivery, customerId } = req.body;
      if (!orderId || daysSinceDelivery === undefined || !customerId) {
        res.status(400).json({ error: 'orderId, daysSinceDelivery, customerId required' }); return;
      }
      const { BusinessPolicyEngine } = await import('../../lib/policy/BusinessPolicyEngine');
      const result = await BusinessPolicyEngine.canReturn(orderId, daysSinceDelivery, customerId);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}
