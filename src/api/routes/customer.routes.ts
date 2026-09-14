/**
 * Customer-Facing Routes — Part 14 final extraction
 *
 * Covers all remaining non-admin routes:
 *  /api/memory/*     — memory feedback, stats, knowledge, preferences
 *  /api/store/*      — coupon validation and redemption
 *  /api/loyalty/*    — points balance, transactions, award, redeem
 *  /api/referral/*   — referral code, process, stats
 *  /api/reviews/*    — product reviews CRUD
 *  /api/products/*   — search, autocomplete, index rebuild
 *  /api/csat/*       — customer satisfaction submission/summary
 *  /api/chat/*       — handoff queue
 *  /api/features     — feature flags (client config)
 *  /api/channels     — OmniChannel platform config
 *  /api/campaigns/*  — broadcast
 */

import { Router, Request, Response } from 'express';
import { requireAdminAuth, requireAuth } from '../middleware/AuthMiddleware';

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: H) => async (req: Request, res: Response) => {
  try { await fn(req, res); }
  catch (err: any) { res.status(500).json({ error: err.message ?? 'Internal error' }); }
};

// ── Memory routes ─────────────────────────────────────────────────────────

export function createMemoryRouter(): Router {
  const router = Router();

  router.post('/feedback', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    const { memoryId, userId, helpful, comment } = req.body;
    if (!memoryId || !userId) { res.status(400).json({ error: 'memoryId and userId required' }); return; }
    await NexusDB.set('memory_feedback', `${memoryId}_${userId}_${Date.now()}`, {
      memoryId, userId, helpful, comment, recordedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  }));

  router.get('/stats', requireAdminAuth, wrap(async (_req, res) => {
    const { MemoryCore } = await import('../../lib/core/MemoryCore');
    res.json(MemoryCore.getVaultStats());
  }));

  router.post('/knowledge', requireAdminAuth, wrap(async (req, res) => {
    const { LearningApprovalGate } = await import('../../lib/memory/LearningApprovalGate');
    const result = await LearningApprovalGate.submit({
      content:    req.body.content,
      collection: req.body.collection || 'semantic_knowledge',
      ownerId:    (req as any).authUser?.uid || 'admin',
      confidence: req.body.confidence ?? 0.95,
      source:     'AdminDirectWrite',
    });
    res.json(result);
  }));

  router.get('/knowledge', requireAdminAuth, wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    const limit = parseInt((req.query.limit as string) || '50');
    res.json(await NexusDB.find('semantic_knowledge', { limit }));
  }));

  router.get('/preferences/:userId', requireAdminAuth, wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.get('user_preferences', req.params.userId));
  }));

  router.post('/business-learn', requireAdminAuth, wrap(async (req, res) => {
    const { LearningApprovalGate } = await import('../../lib/memory/LearningApprovalGate');
    const result = await LearningApprovalGate.submit({
      content:    req.body.content,
      collection: 'business_knowledge',
      ownerId:    (req as any).authUser?.uid || 'admin',
      confidence: req.body.confidence ?? 0.9,
      source:     'BusinessLearn',
    });
    res.json(result);
  }));

  router.post('/summarize-session', wrap(async (req, res) => {
    const { MemoryCore } = await import('../../lib/core/MemoryCore');
    const userId = req.body.userId;
    const messages: Array<{ role: string; content: string }> = req.body.messages || [];
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
        await MemoryCore.packAndArchive({
          userId, role: 'user', prompt: messages[i].content, response: messages[i + 1].content,
        });
        i++; // skip the assistant message we just consumed
      }
    }
    res.json({ success: true });
  }));

  return router;
}

// ── Store routes ──────────────────────────────────────────────────────────

export function createStoreRouter(): Router {
  const router = Router();

  router.post('/validate-coupon', wrap(async (req, res) => {
    const { CouponEngine } = await import('../../lib/promotions/CouponEngine');
    const { code, customerId, orderSubtotal } = req.body;
    if (!code || !customerId || orderSubtotal === undefined) {
      res.status(400).json({ error: 'code, customerId, orderSubtotal required' }); return;
    }
    res.json(await CouponEngine.validate(code, customerId, Number(orderSubtotal), { ipAddress: req.ip }));
  }));

  router.post('/redeem-coupon', wrap(async (req, res) => {
    const { CouponEngine } = await import('../../lib/promotions/CouponEngine');
    const { couponId, code, customerId, orderId, discountAmount } = req.body;
    await CouponEngine.redeem(couponId, code, customerId, orderId, discountAmount);
    res.json({ success: true });
  }));

  return router;
}

// ── Loyalty routes ────────────────────────────────────────────────────────

export function createLoyaltyRouter(): Router {
  const router = Router();

  router.get('/:customerId', wrap(async (req, res) => {
    const { LoyaltyEngine } = await import('../../lib/loyalty/LoyaltyEngine');
    res.json(await LoyaltyEngine.getBalance(req.params.customerId));
  }));

  router.get('/:customerId/transactions', wrap(async (req, res) => {
    const { LoyaltyEngine } = await import('../../lib/loyalty/LoyaltyEngine');
    const limit = parseInt((req.query.limit as string) || '20');
    res.json(await LoyaltyEngine.getTransactions(req.params.customerId, limit));
  }));

  router.post('/award', wrap(async (req, res) => {
    const { LoyaltyEngine } = await import('../../lib/loyalty/LoyaltyEngine');
    const { userId, orderId, orderTotal } = req.body;
    if (!userId || !orderId || orderTotal === undefined) {
      res.status(400).json({ error: 'userId, orderId, orderTotal required' }); return;
    }
    res.json(await LoyaltyEngine.awardForOrder(userId, orderId, Number(orderTotal)));
  }));

  router.post('/redeem', wrap(async (req, res) => {
    const { LoyaltyEngine } = await import('../../lib/loyalty/LoyaltyEngine');
    const { userId, points, orderId } = req.body;
    if (!userId || !points || !orderId) { res.status(400).json({ error: 'userId, points, orderId required' }); return; }
    res.json(await LoyaltyEngine.redeem(userId, Number(points), orderId));
  }));

  return router;
}

// ── Referral routes ───────────────────────────────────────────────────────

export function createReferralRouter(): Router {
  const router = Router();

  router.get('/code/:userId', wrap(async (req, res) => {
    const { ReferralEngine } = await import('../../lib/growth/ReferralEngine');
    res.json(await ReferralEngine.getOrCreateUserCode(req.params.userId));
  }));

  router.post('/process', wrap(async (req, res) => {
    const { ReferralEngine } = await import('../../lib/growth/ReferralEngine');
    const { referralCode, newUserId } = req.body;
    if (!referralCode || !newUserId) { res.status(400).json({ error: 'referralCode and newUserId required' }); return; }
    res.json(await ReferralEngine.processReferral(referralCode, newUserId));
  }));

  router.get('/stats/:userId', wrap(async (req, res) => {
    const { ReferralEngine } = await import('../../lib/growth/ReferralEngine');
    res.json(await ReferralEngine.getStats(req.params.userId));
  }));

  return router;
}

// ── Reviews routes ────────────────────────────────────────────────────────

export function createReviewsRouter(): Router {
  const router = Router();

  router.post('/', wrap(async (req, res) => {
    const { ProductReviewEngine } = await import('../../lib/commerce/ProductReviewEngine');
    const id = await ProductReviewEngine.submitReview(req.body);
    res.status(201).json({ id });
  }));

  router.get('/:productId', wrap(async (req, res) => {
    const { ProductReviewEngine } = await import('../../lib/commerce/ProductReviewEngine');
    const limit = parseInt((req.query.limit as string) || '20');
    res.json(await ProductReviewEngine.getReviews(req.params.productId, { limit }));
  }));

  router.post('/:reviewId/helpful', wrap(async (req, res) => {
    const { ProductReviewEngine } = await import('../../lib/commerce/ProductReviewEngine');
    await ProductReviewEngine.voteHelpful(req.params.reviewId, req.body.userId, true);
    res.json({ success: true });
  }));

  router.post('/:reviewId/vendor-response', requireAdminAuth, wrap(async (req, res) => {
    const { ProductReviewEngine } = await import('../../lib/commerce/ProductReviewEngine');
    await ProductReviewEngine.addVendorResponse(req.params.reviewId, req.body.vendorId, req.body.response);
    res.json({ success: true });
  }));

  return router;
}

// ── Products routes ───────────────────────────────────────────────────────

export function createProductsRouter(): Router {
  const router = Router();

  router.get('/search', wrap(async (req, res) => {
    const { ProductSearchEngine } = await import('../../lib/search/ProductSearchEngine');
    const { q, category, limit } = req.query as Record<string, string>;
    res.json(await ProductSearchEngine.search({ query: q, category, limit: parseInt(limit || '20') }));
  }));

  router.get('/autocomplete', wrap(async (req, res) => {
    const { ProductSearchEngine } = await import('../../lib/search/ProductSearchEngine');
    res.json(await ProductSearchEngine.autocomplete(req.query.q as string));
  }));

  router.post('/search-index/rebuild', requireAdminAuth, wrap(async (_req, res) => {
    const { ProductSearchEngine } = await import('../../lib/search/ProductSearchEngine');
    const count = await ProductSearchEngine.rebuildIndex();
    res.json({ success: true, indexed: count });
  }));

  return router;
}

// ── CSAT routes ───────────────────────────────────────────────────────────

export function createCSATRouter(): Router {
  const router = Router();

  router.post('/submit', wrap(async (req, res) => {
    const { CSATEngine } = await import('../../lib/commerce/CSATEngine');
    await CSATEngine.submit(req.body);
    res.json({ success: true });
  }));

  router.get('/summary', requireAdminAuth, wrap(async (req, res) => {
    const { CSATEngine } = await import('../../lib/commerce/CSATEngine');
    const days = parseInt((req.query.days as string) || '30');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    res.json(await CSATEngine.getSummary({ since }));
  }));

  return router;
}

// ── Chat handoff routes ───────────────────────────────────────────────────

export function createChatRouter(): Router {
  const router = Router();

  router.post('/handoff', wrap(async (req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    const id = `handoff_${Date.now()}`;
    await NexusDB.set('chat_handoffs', id, { ...req.body, id, status: 'pending', createdAt: new Date().toISOString() });
    res.status(201).json({ id });
  }));

  router.get('/handoff-queue', requireAdminAuth, wrap(async (_req, res) => {
    const { NexusDB } = await import('../../lib/database/NexusDB');
    res.json(await NexusDB.find('chat_handoffs', { where: [{ field: 'status', op: '==', value: 'pending' }], limit: 50 }));
  }));

  return router;
}

// ── Features & Channels routes ─────────────────────────────────────────────

export function createFeaturesRouter(featureCache: Record<string, boolean>): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => { res.json({ features: featureCache }); });

  router.put('/', requireAdminAuth, wrap(async (req, res) => {
    Object.assign(featureCache, req.body);
    res.json({ success: true, features: featureCache });
  }));

  return router;
}

export function createChannelsRouter(channelCache: Record<string, any>): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => { res.json({ channels: Object.values(channelCache) }); });

  router.put('/:platformId/toggle', requireAdminAuth, ((req: Request, res: Response) => {
    const c = channelCache[req.params.platformId];
    if (c) c.enabled = !c.enabled;
    res.json({ platformId: req.params.platformId, enabled: c?.enabled });
  }) as any);

  return router;
}

// ── Campaigns broadcast ───────────────────────────────────────────────────

export function createCampaignsBroadcastRouter(aiRateLimit: any): Router {
  const router = Router();

  router.post('/:campaignId/broadcast', requireAdminAuth, aiRateLimit, wrap(async (req, res) => {
    const { CampaignEngine } = await import('../../lib/marketing/CampaignEngine');
    res.json(await CampaignEngine.send(req.params.campaignId));
  }));

  return router;
}
