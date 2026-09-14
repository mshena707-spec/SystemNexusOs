/**
 * Admin Routes — /api/admin/*
 *
 * Extracted from server.ts (Part 14 decomposition).
 * 126 admin routes organized into 10 domain sub-routers:
 *
 *  /api/admin/audit      — fraud summary, AI ping, integration status
 *  /api/admin/finance    — profit, cashflow, expenses, rider payout
 *  /api/admin/payments   — providers, settlement, reconcile, refunds
 *  /api/admin/marketing  — segments, churn, campaigns, copy generation
 *  /api/admin/control    — shutdown, export, command center
 *  /api/admin/ai         — health, benchmarks, spend, provider overrides
 *  /api/admin/security   — events, sessions, auth revoke
 *  /api/admin/procurement — suppliers, purchase orders, stock alerts
 *  /api/admin/backup     — run, list, restore, export
 *  /api/admin/[misc]     — logs, coupons, alerts, pricing, loyalty, etc.
 *
 * ALL routes require requireAdminAuth — enforced at the parent router level.
 */

import { Router, Request, Response } from 'express';
import { requireAdminAuth } from '../middleware/AuthMiddleware';

// ── Helper: wrap async handlers ────────────────────────────────────────────
type H = (req: Request, res: Response) => Promise<void | Response>;
const wrap = (fn: H) => async (req: Request, res: Response) => {
  try { await fn(req, res); }
  catch (err: any) { res.status(500).json({ error: err.message ?? 'Internal error' }); }
};

export function createAdminRouter(): Router {
  const router = Router();

  // All admin routes require auth — applied once here instead of per-route
  router.use(requireAdminAuth);

  // ── System logs ────────────────────────────────────────────────────────────
  router.get('/logs', wrap(async (req, res) => {
    const { SharedStateStore } = await import('../../lib/core/SharedStateStore');
    const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
    res.json(await SharedStateStore.getApiLogs(limit));
  }));

  router.get('/diagnostic', wrap(async (_req, res) => {
    const { SelfHealingEngine } = await import('../../lib/core/SelfHealingEngine');
    res.json(await SelfHealingEngine.runFullDiagnostic());
  }));

  router.get('/diagnostic/last', ((_req: Request, res: Response) => {
    const { SelfHealingEngine } = require('../../lib/core/SelfHealingEngine');
    res.json(SelfHealingEngine.getLastSnapshot() || { message: 'No diagnostic run yet' });
  }) as any);

  // ── Audit domain ───────────────────────────────────────────────────────────
  router.get('/audit/fraud-summary', wrap(async (req, res) => {
    const { FraudDetectionEngine } = await import('../../lib/security/FraudDetectionEngine');
    const hours = parseInt((req.query.hours as string) || '24');
    res.json(await FraudDetectionEngine.getSummary(hours));
  }));

  router.post('/audit/ai-ping', wrap(async (_req, res) => {
    const { AIProviderOrchestrator } = await import('../../lib/ai/providers/AIProviderOrchestrator');
    const start = Date.now();
    const result = await AIProviderOrchestrator.call({ messages: [{ role: 'user', content: 'Respond with SYSTEM_OK ping test.' }] });
    res.json({ ok: true, latencyMs: Date.now() - start, text: result?.text ?? null });
  }));

  router.get('/audit/integration-status', wrap(async (_req, res) => {
    const check = (key: string) => !!process.env[key];
    res.json({
      ai:       { gemini: check('GEMINI_API_KEY'), openai: check('OPENAI_API_KEY'), anthropic: check('ANTHROPIC_API_KEY'), openrouter: check('OPENROUTER_API_KEY') },
      payments: { stripe: check('STRIPE_SECRET_KEY'), bkash: check('BKASH_APP_KEY'), nagad: check('NAGAD_PUBLIC_KEY'), rocket: check('ROCKET_MERCHANT_PASSWORD') },
      comms:    { twilio: check('TWILIO_AUTH_TOKEN'), fcm: check('FIREBASE_SERVICE_ACCOUNT_JSON') },
      infra:    { redis: check('REDIS_URL'), sentry: check('SENTRY_DSN'), supabase: check('SUPABASE_URL') },
    });
  }));

  router.post('/audit/run-task/:taskId', wrap(async (req, res) => {
    const { HealthMonitor } = await import('../../lib/core/health/HealthMonitor');
    const report = await HealthMonitor.runChecks();
    const result = report.services.find(s => s.name === req.params.taskId);
    if (!result) return res.status(404).json({ error: `No health check named ${req.params.taskId}`, available: report.services.map(s => s.name) });
    res.json(result);
  }));

  // ── Finance ────────────────────────────────────────────────────────────────
  router.get('/finance/profit', wrap(async (req, res) => {
    const { ProfitEngine } = await import('../../lib/finance/ProfitEngine');
    const days = parseInt((req.query.days as string) || '30');
    const toISO = new Date().toISOString();
    const fromISO = new Date(Date.now() - days * 86400000).toISOString();
    res.json(await ProfitEngine.getProfitReport(fromISO, toISO, `Last ${days} days`));
  }));

  router.get('/finance/profit/month-over-month', wrap(async (_req, res) => {
    const { ProfitEngine } = await import('../../lib/finance/ProfitEngine');
    res.json(await ProfitEngine.getMonthOverMonth());
  }));

  router.get('/finance/products/profitability', wrap(async (req, res) => {
    const { ProfitEngine } = await import('../../lib/finance/ProfitEngine');
    const limit = parseInt((req.query.limit as string) || '10');
    res.json(await ProfitEngine.getProductProfitability(limit));
  }));

  router.get('/finance/cashflow', wrap(async (req, res) => {
    const { CashFlowEngine } = await import('../../lib/finance/CashFlowEngine');
    const days = parseInt((req.query.days as string) || '30');
    const toISO = new Date().toISOString();
    const fromISO = new Date(Date.now() - days * 86400000).toISOString();
    res.json(await CashFlowEngine.getCashFlowReport(fromISO, toISO, `Last ${days} days`));
  }));

  router.get('/finance/cashflow/month-over-month', wrap(async (_req, res) => {
    const { CashFlowEngine } = await import('../../lib/finance/CashFlowEngine');
    res.json(await CashFlowEngine.getMonthOverMonth());
  }));

  router.get('/finance/cashflow/daily', wrap(async (req, res) => {
    const { CashFlowEngine } = await import('../../lib/finance/CashFlowEngine');
    const days = parseInt((req.query.days as string) || '14');
    res.json(await CashFlowEngine.getDailySeries(days));
  }));

  router.get('/finance/cashflow/risk', wrap(async (_req, res) => {
    const { CashFlowEngine } = await import('../../lib/finance/CashFlowEngine');
    res.json(await CashFlowEngine.getRiskFlags());
  }));

  router.post('/finance/expenses', wrap(async (req, res) => {
    const { ExpenseTracker } = await import('../../lib/finance/ExpenseTracker');
    const id = await ExpenseTracker.record(req.body);
    res.status(201).json({ id });
  }));

  router.get('/finance/expenses', wrap(async (req, res) => {
    const { ExpenseTracker } = await import('../../lib/finance/ExpenseTracker');
    const { category, from, to } = req.query as Record<string, string>;
    let expenses = await ExpenseTracker.getInRange(from, to);
    if (category) expenses = expenses.filter(e => e.category === category);
    res.json(expenses);
  }));

  router.put('/finance/expenses/:id', wrap(async (req, res) => {
    const { ExpenseTracker } = await import('../../lib/finance/ExpenseTracker');
    await ExpenseTracker.update(req.params.id, req.body);
    res.json({ success: true });
  }));

  router.delete('/finance/expenses/:id', wrap(async (req, res) => {
    const { ExpenseTracker } = await import('../../lib/finance/ExpenseTracker');
    await ExpenseTracker.delete(req.params.id);
    res.json({ success: true });
  }));

  router.post('/finance/rider-payout', wrap(async (req, res) => {
    const { RiderPayoutService } = await import('../../lib/finance/RiderPayoutService');
    res.json(await RiderPayoutService.calculate(req.body.riderId, req.body.periodDays || 7));
  }));

  // ── Payments ───────────────────────────────────────────────────────────────
  router.get('/payments/providers', wrap(async (_req, res) => {
    const { PaymentRegistry } = await import('../../lib/payments/PaymentRegistry');
    res.json(PaymentRegistry.listAll());
  }));

  router.get('/payments/settlement', wrap(async (_req, res) => {
    const { SettlementEngine } = await import('../../lib/payments/SettlementEngine');
    res.json(await SettlementEngine.getSummary());
  }));

  router.post('/payments/settlement/build', wrap(async (req, res) => {
    const { SettlementEngine } = await import('../../lib/payments/SettlementEngine');
    res.json(await SettlementEngine.buildDailyBatches(req.body.forDate));
  }));

  router.post('/payments/settlement/:batchId/settle', wrap(async (req, res) => {
    const { SettlementEngine } = await import('../../lib/payments/SettlementEngine');
    res.json(await SettlementEngine.markSettled(req.params.batchId, req.body.actualSettledAmount));
  }));

  router.get('/payments/settlement/overdue', wrap(async (_req, res) => {
    const { SettlementEngine } = await import('../../lib/payments/SettlementEngine');
    res.json(await SettlementEngine.findOverdueBatches());
  }));

  router.post('/payments/reconcile', wrap(async (req, res) => {
    const { PaymentReconciliationEngine } = await import('../../lib/payments/PaymentReconciliationEngine');
    res.json(await PaymentReconciliationEngine.reconcile(req.body));
  }));

  router.get('/payments/reconciliation/latest', wrap(async (_req, res) => {
    const { PaymentReconciliationEngine } = await import('../../lib/payments/PaymentReconciliationEngine');
    res.json(await PaymentReconciliationEngine.getLatest());
  }));

  router.get('/payments/discrepancies', wrap(async (req, res) => {
    const { PaymentReconciliationEngine } = await import('../../lib/payments/PaymentReconciliationEngine');
    const days = parseInt((req.query.days as string) || '7');
    res.json(await PaymentReconciliationEngine.getDiscrepancies(days));
  }));

  router.get('/payments/audit', wrap(async (req, res) => {
    const { PaymentAuditLog } = await import('../../lib/payments/PaymentAuditLog');
    const limit = parseInt((req.query.limit as string) || '100');
    res.json(await PaymentAuditLog.getRecent(limit));
  }));

  router.get('/payments/audit/verify', wrap(async (_req, res) => {
    const { PaymentAuditLog } = await import('../../lib/payments/PaymentAuditLog');
    res.json(await PaymentAuditLog.verifyChain());
  }));

  router.get('/payments/refunds/pending', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.find('refunds', { where: [{ field: 'status', op: '==', value: 'pending' }], limit: 100 }));
  }));

  // ── Marketing ──────────────────────────────────────────────────────────────
  router.get('/marketing/segments', wrap(async (_req, res) => {
    const { BIEngine } = await import('../../lib/business-intelligence/analytics/BIEngine');
    res.json(await BIEngine.getSegmentDistribution());
  }));

  router.get('/marketing/segments/:segment/members', wrap(async (req, res) => {
    const { BIEngine } = await import('../../lib/business-intelligence/analytics/BIEngine');
    res.json(await BIEngine.getSegmentMembers(req.params.segment as any));
  }));

  router.get('/marketing/churn', wrap(async (req, res) => {
    const { ChurnPredictor } = await import('../../lib/marketing/ChurnPredictor');
    const limit = parseInt((req.query.limit as string) || '20');
    res.json(await ChurnPredictor.getAtRiskCustomers(50, limit));
  }));

  router.post('/marketing/campaigns', wrap(async (req, res) => {
    const { CampaignEngine } = await import('../../lib/marketing/CampaignEngine');
    const id = await CampaignEngine.create({ ...req.body, createdBy: (req as any).authUser?.uid ?? 'admin' });
    res.status(201).json({ id });
  }));

  router.get('/marketing/campaigns', wrap(async (_req, res) => {
    const { CampaignEngine } = await import('../../lib/marketing/CampaignEngine');
    res.json(await CampaignEngine.list());
  }));

  router.post('/marketing/campaigns/:id/send', wrap(async (req, res) => {
    const { CampaignEngine } = await import('../../lib/marketing/CampaignEngine');
    res.json(await CampaignEngine.send(req.params.id));
  }));

  router.post('/marketing/campaigns/:id/attribution', wrap(async (req, res) => {
    const { CampaignEngine } = await import('../../lib/marketing/CampaignEngine');
    res.json(await CampaignEngine.measureAttribution(req.params.id));
  }));

  router.post('/marketing/generate-copy', wrap(async (req, res) => {
    const { AIProviderOrchestrator } = await import('../../lib/ai/providers/AIProviderOrchestrator');
    const result = await AIProviderOrchestrator.call({
      messages: [{ role: 'user', content: `Generate marketing copy for: ${JSON.stringify(req.body)}` }],
    });
    res.json({ copy: result?.text ?? '' });
  }));

  // ── Owner control ──────────────────────────────────────────────────────────
  router.get('/control/shutdown', wrap(async (_req, res) => {
    const { OwnerControlEngine } = await import('../../lib/control/OwnerControlEngine');
    res.json({ engaged: await OwnerControlEngine.isShutdown() });
  }));

  router.post('/control/shutdown/engage', wrap(async (req, res) => {
    const { OwnerControlEngine } = await import('../../lib/control/OwnerControlEngine');
    await OwnerControlEngine.engageEmergencyShutdown((req as any).authUser.uid, req.body.reason);
    res.json({ success: true, engaged: true });
  }));

  router.post('/control/shutdown/disengage', wrap(async (req, res) => {
    const { OwnerControlEngine } = await import('../../lib/control/OwnerControlEngine');
    await OwnerControlEngine.disengageEmergencyShutdown((req as any).authUser.uid);
    res.json({ success: true, engaged: false });
  }));

  router.get('/control/export/:tenantId', wrap(async (req, res) => {
    const { OwnerControlEngine } = await import('../../lib/control/OwnerControlEngine');
    const data = await OwnerControlEngine.exportTenantData(req.params.tenantId);
    res.json(data);
  }));

  router.get('/control/command-center', wrap(async (_req, res) => {
    const { OwnerControlEngine } = await import('../../lib/control/OwnerControlEngine');
    res.json(await OwnerControlEngine.getShutdownState());
  }));

  // ── AI management ──────────────────────────────────────────────────────────
  router.get('/system/intelligence-overview', wrap(async (_req, res) => {
    const { AuditLog } = await import('../../lib/security/audit/ImmutableAuditLog');
    const { TaskQueue } = await import('../../lib/queue/TaskQueue');
    const { NexusCache } = await import('../../lib/cache/NexusCache');
    const { EvolutionEngine } = await import('../../lib/core/EvolutionEngine');
    const { FeatureStore } = await import('../../lib/core/config/FeatureStore');

    const [features, pendingTraining] = await Promise.all([
      FeatureStore.getAll(),
      EvolutionEngine.getPendingTrainingData(500),
    ]);

    // Which Tri-Mode presets are currently fully active — same logic ModeControlPanel uses.
    const MODE_PRESETS: Record<string, Record<string, boolean>> = {
      enterprise: { security_2fa: true, security_bot_detection: true, security_rate_limiting: true, security_audit_log: true },
      agi: { ai_auto_learning: true, ai_demand_forecast: true, ai_personalization: true, ai_ceo_agent: true },
      product: { commerce_loyalty: true, commerce_coupons: true, commerce_abandoned_cart: true, analytics_dashboard: true },
    };
    const activeModes = Object.entries(MODE_PRESETS)
      .filter(([, preset]) => Object.entries(preset).every(([k, v]) => features[k] === v))
      .map(([name]) => name);

    res.json({
      recentActivity: AuditLog.query({ limit: 8 }),
      queue: TaskQueue.getStats(),
      cache: NexusCache.getL1Stats(),
      learningBacklog: pendingTraining.length,
      activeModes,
    });
  }));

  router.get('/ai/health', wrap(async (_req, res) => {
    const { AIProviderOrchestrator } = await import('../../lib/ai/providers/AIProviderOrchestrator');
    res.json(AIProviderOrchestrator.getHealthReport());
  }));

  router.get('/ai/benchmarks', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.find('ai_benchmarks', { orderBy: 'runAt', orderDir: 'desc', limit: 20 }));
  }));

  router.post('/ai/benchmark', wrap(async (_req, res) => {
    const { AIProviderOrchestrator } = await import('../../lib/ai/providers/AIProviderOrchestrator');
    res.json(await AIProviderOrchestrator.runBenchmark());
  }));

  router.get('/ai/spend', wrap(async (_req, res) => {
    const { TokenCostTracker } = await import('../../lib/ai/tracking/TokenCostTracker');
    res.json(await TokenCostTracker.getSummary());
  }));

  router.post('/ai/role-override', wrap(async (req, res) => {
    const { GlobalProviderRegistry } = await import('../../lib/ai/providers/ProviderRegistry');
    GlobalProviderRegistry.setPrimaryForRole(req.body.role, req.body.providerId);
    res.json({ success: true });
  }));

  router.delete('/ai/role-override/:role', wrap(async (req, res) => {
    const { GlobalProviderRegistry } = await import('../../lib/ai/providers/ProviderRegistry');
    GlobalProviderRegistry.clearRoleOverride(req.params.role);
    res.json({ success: true });
  }));

  router.get('/ai/providers', wrap(async (_req, res) => {
    const { GlobalProviderRegistry } = await import('../../lib/ai/providers/ProviderRegistry');
    res.json(GlobalProviderRegistry.listAll());
  }));

  // ── Security ───────────────────────────────────────────────────────────────
  router.get('/security/events', wrap(async (req, res) => {
    const { SecurityEventLog } = await import('../../lib/security/audit/SecurityEventLog');
    const limit = parseInt((req.query.limit as string) || '100');
    res.json(await SecurityEventLog.getRecent(limit));
  }));

  router.get('/security/summary', wrap(async (req, res) => {
    const { SecurityEventLog } = await import('../../lib/security/audit/SecurityEventLog');
    const hours = parseInt((req.query.hours as string) || '24');
    res.json(await SecurityEventLog.getSummary(hours));
  }));

  router.get('/security/sessions', wrap(async (req, res) => {
    const { JWTService } = await import('../../lib/security/auth/JWTService');
    const uid = req.query.uid as string;
    res.json(await JWTService.getActiveSessions(uid));
  }));

  router.post('/auth/revoke-all/:uid', wrap(async (req, res) => {
    const { JWTService } = await import('../../lib/security/auth/JWTService');
    const count = await JWTService.revokeAllSessions(req.params.uid);
    res.json({ success: true, revokedCount: count });
  }));

  // ── Procurement ────────────────────────────────────────────────────────────
  router.get('/procurement/suppliers', wrap(async (req, res) => {
    const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
    res.json(await ProcurementEngine.listSuppliers(req.query as any));
  }));

  router.post('/procurement/suppliers', wrap(async (req, res) => {
    const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
    res.status(201).json(await ProcurementEngine.addSupplier(req.body));
  }));

  router.put('/procurement/suppliers/:id', wrap(async (req, res) => {
    const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
    res.json(await ProcurementEngine.updateSupplier(req.params.id, req.body));
  }));

  router.get('/procurement/suppliers/:id/products', wrap(async (req, res) => {
    const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
    res.json(await ProcurementEngine.getSupplierProducts(req.params.id));
  }));

  router.post('/procurement/purchase-orders', wrap(async (req, res) => {
    const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
    res.status(201).json(await ProcurementEngine.createPO(req.body, (req as any).authUser?.uid));
  }));

  router.get('/procurement/purchase-orders', wrap(async (_req, res) => {
    const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
    res.json(await ProcurementEngine.listPOs());
  }));

  router.get('/procurement/purchase-orders/summary', wrap(async (_req, res) => {
    const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
    res.json(await ProcurementEngine.getPOSummary());
  }));

  router.get('/procurement/purchase-orders/:id', wrap(async (req, res) => {
    const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
    res.json(await ProcurementEngine.getPO(req.params.id));
  }));

  for (const action of ['send', 'confirm', 'receive', 'cancel'] as const) {
    router.post(`/procurement/purchase-orders/:id/${action}`, wrap(async (req, res) => {
      const { ProcurementEngine } = await import('../../lib/commerce/ProcurementEngine');
      res.json(await (ProcurementEngine as any)[`${action}PO`](req.params.id, (req as any).authUser?.uid, req.body));
    }));
  }

  router.get('/procurement/stock-alerts', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    const threshold = parseInt((req.query.threshold as string) || '10');
    res.json(await NexusDB.find('products', { where: [{ field: 'stock', op: '<=', value: threshold }], limit: 100 }));
  }));

  // ── Backup ─────────────────────────────────────────────────────────────────
  router.post('/backup/run', wrap(async (_req, res) => {
    const { BackupEngine } = await import('../../lib/database/BackupEngine');
    res.json(await BackupEngine.run());
  }));

  router.get('/backup/list', wrap(async (_req, res) => {
    const { BackupEngine } = await import('../../lib/database/BackupEngine');
    res.json(await BackupEngine.list());
  }));

  router.post('/backup/restore/dry-run', wrap(async (req, res) => {
    const { BackupEngine } = await import('../../lib/database/BackupEngine');
    res.json(await BackupEngine.restoreDryRun(req.body.backupId));
  }));

  router.post('/backup/restore', wrap(async (req, res) => {
    const { BackupEngine } = await import('../../lib/database/BackupEngine');
    res.json(await BackupEngine.restore(req.body.backupId, (req as any).authUser?.uid));
  }));

  router.get('/backup/export/:collection', wrap(async (req, res) => {
    const { BackupEngine } = await import('../../lib/database/BackupEngine');
    const data = await BackupEngine.exportCollection(req.params.collection);
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.collection}.json"`);
    res.json(data);
  }));

  // ── Coupons ────────────────────────────────────────────────────────────────
  router.get('/coupons', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.find('coupons', { limit: 200 }));
  }));

  router.post('/coupons', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    const id = `coupon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await NexusDB.set('coupons', id, { ...req.body, id, code: req.body.code.toUpperCase().trim(), usageCount: 0, createdAt: new Date().toISOString() });
    res.status(201).json({ id });
  }));

  router.delete('/coupons/:id', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    await NexusDB.update('coupons', req.params.id, { active: false, deletedAt: new Date().toISOString() });
    res.json({ success: true });
  }));

  // ── Fraud ──────────────────────────────────────────────────────────────────
  router.post('/fraud/blocklist', wrap(async (req, res) => {
    const { CODFraudDetector } = await import('../../lib/security/fraud/CODFraudDetector');
    await CODFraudDetector.addToBlocklist(req.body.type, req.body.value, req.body.reason, (req as any).authUser?.uid ?? 'admin');
    res.json({ success: true });
  }));

  router.get('/fraud/stats', wrap(async (_req, res) => {
    const { FraudDetectionEngine } = await import('../../lib/security/FraudDetectionEngine');
    res.json(await FraudDetectionEngine.getSummary(24));
  }));

  router.get('/fraud/alerts', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    const limit = parseInt((req.query.limit as string) || '50');
    res.json(await NexusDB.find('fraud_alerts', { orderBy: 'detectedAt', orderDir: 'desc', limit }));
  }));

  // ── Queue ──────────────────────────────────────────────────────────────────
  router.post('/queue/enqueue', wrap(async (req, res) => {
    const { taskQueue } = await import('../../lib/queue/RedisTaskQueue');
    const jobId = await taskQueue.enqueue({ type: req.body.jobType, payload: req.body.payload, ...req.body.options });
    res.status(201).json({ jobId });
  }));

  router.get('/queue/stats', wrap(async (_req, res) => {
    const { taskQueue } = await import('../../lib/queue/RedisTaskQueue');
    res.json(await taskQueue.getStats());
  }));

  // ── Alerts ────────────────────────────────────────────────────────────────
  router.get('/alerts', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    const limit = parseInt((req.query.limit as string) || '50');
    const where = (req.query.unread === 'true') ? [{ field: 'read', op: '==' as const, value: false }] : [];
    res.json(await NexusDB.find('system_alerts', { where, orderBy: 'createdAt', orderDir: 'desc', limit }));
  }));

  router.patch('/alerts/:id/read', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    await NexusDB.update('system_alerts', req.params.id, { read: true, readAt: new Date().toISOString() });
    res.json({ success: true });
  }));

  router.patch('/alerts/read-all', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    const alerts = await NexusDB.find('system_alerts', { where: [{ field: 'read', op: '==', value: false }], limit: 500 });
    await Promise.all((alerts as any[]).map((a: any) => NexusDB.update('system_alerts', a.id, { read: true })));
    res.json({ success: true, count: alerts.length });
  }));

  router.delete('/alerts/:id', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    await NexusDB.update('system_alerts', req.params.id, { deleted: true });
    res.json({ success: true });
  }));

  // ── Pricing ───────────────────────────────────────────────────────────────
  router.get('/pricing/suggestions', wrap(async (req, res) => {
    const { DynamicPricingEngine } = await import('../../lib/pricing/DynamicPricingEngine');
    const limit = parseInt((req.query.limit as string) || '20');
    res.json(await DynamicPricingEngine.suggestForAll(limit));
  }));

  router.get('/pricing/suggestions/:productId', wrap(async (req, res) => {
    const { DynamicPricingEngine } = await import('../../lib/pricing/DynamicPricingEngine');
    res.json(await DynamicPricingEngine.suggestForProduct(req.params.productId));
  }));

  router.post('/pricing/simulate', wrap(async (req, res) => {
    const { DynamicPricingEngine } = await import('../../lib/pricing/DynamicPricingEngine');
    const { productId, currentPrice, newPrice } = req.body;
    res.json(await DynamicPricingEngine.simulate(productId, currentPrice, newPrice));
  }));

  router.post('/pricing/apply', wrap(async (req, res) => {
    const { DynamicPricingEngine } = await import('../../lib/pricing/DynamicPricingEngine');
    const { productId, newPrice } = req.body;
    const suggestion = await DynamicPricingEngine.suggestForProduct(productId);
    if (!suggestion) return res.status(404).json({ error: `No pricing data available for product ${productId}` });
    await DynamicPricingEngine.applyPrice(productId, newPrice, suggestion, (req as any).authUser?.uid ?? 'admin');
    res.json({ success: true });
  }));

  router.get('/pricing/log', wrap(async (_req, res) => {
    const { DynamicPricingEngine } = await import('../../lib/pricing/DynamicPricingEngine');
    res.json(await DynamicPricingEngine.getSuggestionsLog());
  }));

  // ── Forecast & competitor ─────────────────────────────────────────────────
  router.get('/forecast/products', wrap(async (req, res) => {
    const { DemandForecastEngine } = await import('../../lib/business-intelligence/DemandForecastEngine');
    const limit = parseInt((req.query.limit as string) || '10');
    res.json(await DemandForecastEngine.getTopForecasts(limit));
  }));

  router.get('/forecast/products/:productId', wrap(async (req, res) => {
    const { DemandForecastEngine } = await import('../../lib/business-intelligence/DemandForecastEngine');
    res.json(await DemandForecastEngine.getForecast(req.params.productId));
  }));

  router.get('/forecast/restock-alerts', wrap(async (_req, res) => {
    const { DemandForecastEngine } = await import('../../lib/business-intelligence/DemandForecastEngine');
    res.json(await DemandForecastEngine.getRestockAlerts());
  }));

  router.post('/competitor/analyse', wrap(async (req, res) => {
    const { CompetitorAI } = await import('../../lib/intelligence/CompetitorAI');
    res.json(await CompetitorAI.analysePricing(req.body.productName, req.body.currentPrice, req.body.productId));
  }));

  router.get('/competitor/history/:productId', wrap(async (req, res) => {
    const { CompetitorAI } = await import('../../lib/intelligence/CompetitorAI');
    res.json(await CompetitorAI.getAnalysisHistory(req.params.productId));
  }));

  // ── CEO reports ───────────────────────────────────────────────────────────
  router.get('/ceo/report', wrap(async (_req, res) => {
    const { CEOReportEngine } = await import('../../lib/business-intelligence/CEOReportEngine');
    res.json(await CEOReportEngine.getLatest());
  }));

  router.post('/ceo/report/generate', wrap(async (_req, res) => {
    const { CEOReportEngine } = await import('../../lib/business-intelligence/CEOReportEngine');
    res.json(await CEOReportEngine.generate());
  }));

  router.get('/ceo/report/history', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.find('ceo_reports', { orderBy: 'generatedAt', orderDir: 'desc', limit: 10 }));
  }));

  // ── Misc admin ────────────────────────────────────────────────────────────
  router.get('/loyalty/award-bonus', wrap(async (req, res) => {
    const { LoyaltyEngine } = await import('../../lib/loyalty/LoyaltyEngine');
    await LoyaltyEngine.awardBonus(
      req.body.userId,
      req.body.points,
      'earn_bonus',
      `admin_bonus_${Date.now()}`,
      req.body.reason,
      (req as any).authUser?.uid ?? 'system',
    );
    res.json({ success: true });
  }));

  router.get('/cart-recovery-log', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.find('cart_recovery_log', { orderBy: 'sentAt', orderDir: 'desc', limit: 100 }));
  }));

  router.get('/referral/leaderboard', wrap(async (_req, res) => {
    const { ReferralEngine } = await import('../../lib/growth/ReferralEngine');
    res.json(await ReferralEngine.getLeaderboard());
  }));

  router.get('/financial-reports', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.find('financial_reports', { orderBy: 'generatedAt', orderDir: 'desc', limit: 20 }));
  }));

  router.post('/financial-reports/generate', wrap(async (req, res) => {
    const { FinancialReportEngine } = await import('../../lib/finance/FinancialReportEngine');
    res.json(await FinancialReportEngine.generate(req.body.period, (req as any).authUser?.uid));
  }));

  router.get('/learning/stats', wrap(async (req, res) => {
    const { LearningApprovalGate } = await import('../../lib/memory/LearningApprovalGate');
    res.json(await LearningApprovalGate.getStats());
  }));

  router.delete('/learning/:id', wrap(async (req, res) => {
    const { LearningApprovalGate } = await import('../../lib/memory/LearningApprovalGate');
    const { reason } = req.body;
    await LearningApprovalGate.reject(req.params.id, (req as any).authUser?.uid, reason);
    res.json({ success: true });
  }));

  router.get('/sla/stats', wrap(async (req, res) => {
    const { SLAMonitor } = await import('../../lib/support/SLAMonitor');
    const hours = parseInt((req.query.hours as string) || '24');
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    res.json(await SLAMonitor.getStats(since));
  }));

  router.get('/cache/stats', ((_req: Request, res: Response) => {
    const { NexusCache } = require('../../lib/cache/NexusCache');
    res.json(NexusCache.getStats());
  }) as any);

  router.delete('/cache/tag/:tag', wrap(async (req, res) => {
    const { NexusCache } = await import('../../lib/cache/NexusCache');
    await NexusCache.invalidateTag(req.params.tag);
    res.json({ success: true });
  }));

  router.get('/next-order-id', wrap(async (_req, res) => {
    const { OrderRepository } = await import('../../lib/database/repositories/OrderRepository');
    res.json({ orderId: await OrderRepository.generateOrderId() });
  }));

  router.post('/cleanup/webhook-nonces', wrap(async (_req, res) => {
    const { WebhookGuard } = await import('../../lib/payments/guard/WebhookGuard');
    const count = await WebhookGuard.cleanupExpiredNonces();
    res.json({ success: true, cleaned: count });
  }));

  router.post('/cleanup/inventory-reservations', wrap(async (_req, res) => {
    const { InventoryReservationService } = await import('../../lib/commerce/InventoryReservationService');
    const count = await InventoryReservationService.cleanupExpired();
    res.json({ success: true, cleaned: count });
  }));

  router.get('/db/status', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.healthCheck());
  }));

  // ── System capacity (hardware profile + estimated user/order capacity) ────
  // ── Brand theme (customizable color identity, not hardcoded to any one brand) ──
  router.get('/theme', wrap(async (_req, res) => {
    const { BrandThemeService } = await import('../../lib/theme/BrandThemeService');
    res.json(await BrandThemeService.getDerivedPalettes());
  }));

  router.get('/theme/presets', wrap(async (_req, res) => {
    const { BrandThemeService } = await import('../../lib/theme/BrandThemeService');
    res.json(BrandThemeService.getPresets());
  }));

  router.post('/theme', wrap(async (req, res) => {
    const { BrandThemeService } = await import('../../lib/theme/BrandThemeService');
    const saved = await BrandThemeService.set(
      { primary: req.body.primary, secondary: req.body.secondary },
      (req as any).authUser?.uid,
    );
    res.json(saved);
  }));

  router.post('/theme/reset', wrap(async (_req, res) => {
    const { BrandThemeService } = await import('../../lib/theme/BrandThemeService');
    res.json(await BrandThemeService.reset());
  }));

  // ── Developer Hub: API keys & webhooks ─────────────────────────────────────
  router.get('/dev/api-keys', wrap(async (_req, res) => {
    const { ApiKeyService } = await import('../../lib/security/ApiKeyService');
    res.json(await ApiKeyService.list());
  }));

  router.post('/dev/api-keys', wrap(async (req, res) => {
    const { ApiKeyService } = await import('../../lib/security/ApiKeyService');
    res.json(await ApiKeyService.generate(req.body.name, (req as any).authUser?.uid));
  }));

  router.delete('/dev/api-keys/:id', wrap(async (req, res) => {
    const { ApiKeyService } = await import('../../lib/security/ApiKeyService');
    await ApiKeyService.revoke(req.params.id);
    res.json({ success: true });
  }));

  router.get('/dev/webhooks', wrap(async (_req, res) => {
    const { WebhookService } = await import('../../lib/integrations/WebhookService');
    res.json(await WebhookService.list());
  }));

  router.post('/dev/webhooks', wrap(async (req, res) => {
    const { WebhookService } = await import('../../lib/integrations/WebhookService');
    res.json(await WebhookService.create(req.body.url, req.body.events || []));
  }));

  router.delete('/dev/webhooks/:id', wrap(async (req, res) => {
    const { WebhookService } = await import('../../lib/integrations/WebhookService');
    await WebhookService.remove(req.params.id);
    res.json({ success: true });
  }));

  router.post('/dev/webhooks/:id/test', wrap(async (req, res) => {
    const { WebhookService } = await import('../../lib/integrations/WebhookService');
    res.json(await WebhookService.test(req.params.id));
  }));

  router.get('/system/capacity', wrap(async (req, res) => {
    const { HardwareAutoConfig } = await import('../../lib/infrastructure/HardwareAutoConfig');
    const { CapacityEstimator } = await import('../../lib/infrastructure/CapacityEstimator');
    const forceRefresh = req.query.refresh === 'true';
    const [hardware, capacity, tuning] = await Promise.all([
      HardwareAutoConfig.detect(),
      CapacityEstimator.estimateCapacity(forceRefresh),
      CapacityEstimator.getRecommendedTuning(),
    ]);
    res.json({ hardware, capacity, appliedTuning: tuning });
  }));

  router.post('/db/migrate', wrap(async (req, res) => {
    const { MigrationTool } = await import('../../lib/database/MigrationTool');
    const { source, destination, collections } = req.body;
    res.json(await MigrationTool.migrate(source, destination, collections));
  }));

  router.post('/db/verify', wrap(async (req, res) => {
    const { MigrationTool } = await import('../../lib/database/MigrationTool');
    const { source, destination, collections } = req.body;
    res.json(await MigrationTool.verify(source, destination, collections));
  }));

  router.get('/db/providers', wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.healthCheck());
  }));

  router.get('/api-usage-by-day', (_req: Request, res: Response) => {
    res.json({ message: 'API usage tracking requires Prometheus/Grafana setup — see DEPLOY.md' });
  });

  // ── OmniChannel customer data ─────────────────────────────────────────────
  router.get('/omni/customers/search', wrap(async (req, res) => {
    const { CustomerJourneyService } = await import('../../lib/omnichannel/CustomerJourneyService');
    res.json(await CustomerJourneyService.search(req.query.q as string));
  }));

  router.get('/omni/customers/:customerId/journey', wrap(async (req, res) => {
    const { CustomerJourneyService } = await import('../../lib/omnichannel/CustomerJourneyService');
    res.json(await CustomerJourneyService.getJourney(req.params.customerId));
  }));

  router.get('/omni/customers/:customerId', wrap(async (req, res) => {
    const { CustomerIdentityService } = await import('../../lib/omnichannel/CustomerIdentityService');
    res.json(await CustomerIdentityService.getById(req.params.customerId));
  }));

  router.post('/omni/customers/merge', wrap(async (req, res) => {
    const { CustomerIdentityService } = await import('../../lib/omnichannel/CustomerIdentityService');
    res.json(await CustomerIdentityService.merge(req.body.targetId, req.body.sourceId));
  }));

  router.get('/omni/customers/:customerId/timeline', wrap(async (req, res) => {
    const { MessageHistoryService } = await import('../../lib/omnichannel/MessageHistoryService');
    const limit = parseInt((req.query.limit as string) || '20');
    res.json(await MessageHistoryService.getTimeline(req.params.customerId, limit));
  }));

  // ── Owner AI ──────────────────────────────────────────────────────────────
  router.post('/owner-ai/parse', wrap(async (req, res) => {
    const { AIProviderOrchestrator } = await import('../../lib/ai/providers/AIProviderOrchestrator');
    const result = await AIProviderOrchestrator.call({
      systemPrompt: 'You are a business assistant. Parse natural language commands into structured actions for a business OS.',
      messages: [{ role: 'user', content: req.body.command }],
    });
    res.json({ parsed: result?.text ?? '', raw: req.body.command });
  }));

  // ── Memory ─────────────────────────────────────────────────────────────────
  router.get('/memory/overview', wrap(async (_req, res) => {
    const { MemoryCore } = await import('../../lib/core/MemoryCore');
    res.json({
      vaultStats: MemoryCore.getVaultStats(),
      recentLogs: await MemoryCore.fetchVaultLogs(10),
    });
  }));

  // ── Automation rules ──────────────────────────────────────────────────────
  router.get('/automation-rules', wrap(async (_req, res) => {
    const { AutomationEngine } = await import('../../lib/automation/AutomationEngine');
    res.json(AutomationEngine.listWorkflows());
  }));

  router.post('/automation-rules', wrap(async (req, res) => {
    const { AutomationEngine } = await import('../../lib/automation/AutomationEngine');
    AutomationEngine.registerWorkflow(req.body);
    res.status(201).json({ id: req.body.id });
  }));

  router.patch('/automation-rules/:id/toggle', wrap(async (req, res) => {
    const { AutomationEngine } = await import('../../lib/automation/AutomationEngine');
    const workflows = AutomationEngine.listWorkflows();
    const wf = workflows.find((w: any) => w.id === req.params.id);
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    wf.enabled = req.body.enabled ?? !wf.enabled;
    res.json({ id: req.params.id, enabled: wf.enabled });
  }));

  router.delete('/automation-rules/:id', wrap(async (req, res) => {
    const { AutomationEngine } = await import('../../lib/automation/AutomationEngine');
    AutomationEngine.unregisterWorkflow(req.params.id);
    res.json({ success: true });
  }));

  router.post('/automation-rules/:id/run', wrap(async (req, res) => {
    const { AutomationEngine } = await import('../../lib/automation/AutomationEngine');
    await AutomationEngine.triggerEvent(req.params.id as any, req.body.payload || {});
    res.json({ success: true });
  }));

  router.post('/automation-rules/:id/preview', wrap(async (req, res) => {
    res.json({ preview: true, id: req.params.id, payload: req.body.payload, note: 'Dry-run — no side effects' });
  }));

  return router;
}
