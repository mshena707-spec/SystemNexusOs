/**
 * NEXUS MEMORY API ROUTES — Phase 2
 * Exposes all 8 memory types via REST API.
 * All routes protected by requireAdminAuth or caller identity.
 *
 * Mount in server.ts:
 *   import { memoryRoutes } from './src/lib/memory/MemoryRoutes';
 *   memoryRoutes(app, requireAdminAuth);
 */

import { MemoryEngine } from './NexusMemoryEngine';
import { MemoryType } from './interfaces/MemoryTypes';
import { MemoryCaller } from './acl/MemoryACL';

/** Build MemoryCaller from Express request */
function callerFromReq(req: any): MemoryCaller {
  return {
    id: req.user?.uid || req.headers['x-user-id'] || 'anonymous',
    type: req.user?.isOwner ? 'owner' : req.user?.type || 'user',
    roles: req.user?.roles || (req.headers['x-admin-token'] ? ['admin'] : []),
    tenantId: req.headers['x-tenant-id'],
    isOwner: req.user?.isOwner || false,
  };
}

export function memoryRoutes(app: any, requireAdminAuth: any) {

  // ── Initialize memory engine ─────────────────────────────────────────
  MemoryEngine.initialize().catch(console.error);

  // ── GET /api/memory/status ────────────────────────────────────────────
  app.get('/api/memory/status', requireAdminAuth, (_req: any, res: any) => {
    res.json({
      adapters: MemoryEngine.getAdapterStatus(),
      stats: MemoryEngine.getStats(),
    });
  });

  // ── POST /api/memory/personal ─────────────────────────────────────────
  app.post('/api/memory/personal', requireAdminAuth, async (req: any, res: any) => {
    const { agentId, ownerId, content, ttlSeconds, tags } = req.body;
    if (!agentId || !ownerId || !content) {
      return res.status(400).json({ error: 'agentId, ownerId, content required' });
    }
    const caller = callerFromReq(req);
    const result = await MemoryEngine.writePersonal(agentId, ownerId, content, { ttlSeconds, tags }, caller);
    res.json({ success: !!result, entry: result });
  });

  // ── POST /api/memory/shared ───────────────────────────────────────────
  app.post('/api/memory/shared', requireAdminAuth, async (req: any, res: any) => {
    const { ownerId, content, writePolicy, ttlSeconds, tags } = req.body;
    if (!ownerId || !content) return res.status(400).json({ error: 'ownerId, content required' });
    const caller = callerFromReq(req);
    const result = await MemoryEngine.writeShared(ownerId, content, writePolicy || 'multi_writer', { ttlSeconds, tags }, caller);
    res.json({ success: !!result, entry: result });
  });

  // ── POST /api/memory/immutable ────────────────────────────────────────
  app.post('/api/memory/immutable', requireAdminAuth, async (req: any, res: any) => {
    const { ownerId, signedBy, content, chainPrev, witnesses } = req.body;
    if (!ownerId || !content) return res.status(400).json({ error: 'ownerId, content required' });
    const caller = callerFromReq(req);
    const result = await MemoryEngine.writeImmutable(ownerId, signedBy || ownerId, content, { chainPrev, witnesses }, caller);
    res.json({ success: !!result, entry: result });
  });

  // ── POST /api/memory/restricted ──────────────────────────────────────
  app.post('/api/memory/restricted', requireAdminAuth, async (req: any, res: any) => {
    const { ownerId, content, allowedRoles, classification } = req.body;
    if (!ownerId || !content || !allowedRoles) {
      return res.status(400).json({ error: 'ownerId, content, allowedRoles required' });
    }
    const caller = callerFromReq(req);
    const result = await MemoryEngine.writeRestricted(ownerId, content, allowedRoles, classification, {}, caller);
    res.json({ success: !!result, entry: result });
  });

  // ── Episode endpoints ─────────────────────────────────────────────────
  app.post('/api/memory/episode/create', async (req: any, res: any) => {
    const { sessionId, userId, platform, agentId } = req.body;
    if (!sessionId || !userId) return res.status(400).json({ error: 'sessionId, userId required' });
    const result = await MemoryEngine.createEpisode(sessionId, userId, platform, agentId);
    res.json({ success: true, entry: result });
  });

  app.post('/api/memory/episode/append', async (req: any, res: any) => {
    const { sessionId, entries } = req.body;
    if (!sessionId || !entries?.length) return res.status(400).json({ error: 'sessionId, entries required' });
    const caller = callerFromReq(req);
    const ok = await MemoryEngine.appendToEpisode(sessionId, entries, caller);
    res.json({ success: ok });
  });

  app.get('/api/memory/episode/:sessionId', async (req: any, res: any) => {
    const caller = callerFromReq(req);
    const result = await MemoryEngine.getEpisode(req.params.sessionId, caller);
    if (!result) return res.status(404).json({ error: 'Episode not found or access denied' });
    res.json(result);
  });

  app.post('/api/memory/episode/:sessionId/summarize', requireAdminAuth, async (req: any, res: any) => {
    const summary = await MemoryEngine.summarizeEpisode(req.params.sessionId);
    res.json({ success: !!summary, summary });
  });

  // ── Semantic memory endpoints ─────────────────────────────────────────
  app.post('/api/memory/semantic', requireAdminAuth, async (req: any, res: any) => {
    const { content, collection, ownerId, source, tags } = req.body;
    if (!content || !collection) return res.status(400).json({ error: 'content, collection required' });
    const caller = callerFromReq(req);
    const result = await MemoryEngine.writeSemanticKnowledge(content, collection, ownerId || 'system', { source, tags }, caller);
    res.json({ success: !!result, entry: result });
  });

  app.post('/api/memory/semantic/search', async (req: any, res: any) => {
    const { query, collection, topK, threshold } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    const results = await MemoryEngine.semanticSearch(query, { collection, topK, threshold });
    res.json({ results, count: results.length });
  });

  // ── Learning memory endpoints ─────────────────────────────────────────
  app.post('/api/memory/learning', async (req: any, res: any) => {
    const { agentId, stimulus, response, feedback, correctedResponse, feedbackSource } = req.body;
    if (!agentId || !stimulus || !response || !feedback) {
      return res.status(400).json({ error: 'agentId, stimulus, response, feedback required' });
    }
    const caller = callerFromReq(req);
    const result = await MemoryEngine.recordLearning(
      agentId, stimulus, response, feedback,
      { correctedResponse, feedbackSource }, caller
    );
    res.json({ success: !!result, entry: result });
  });

  app.get('/api/memory/learning/:agentId', requireAdminAuth, async (req: any, res: any) => {
    const limit = parseInt(req.query.limit || '20');
    const results = await MemoryEngine.getLearningContext(req.params.agentId, limit);
    res.json({ results, count: results.length });
  });

  // ── Unified query ─────────────────────────────────────────────────────
  app.post('/api/memory/query', requireAdminAuth, async (req: any, res: any) => {
    const caller = callerFromReq(req);
    const results = await MemoryEngine.query(req.body, caller);
    res.json({ results, count: results.length });
  });

  // ── Delete ────────────────────────────────────────────────────────────
  app.delete('/api/memory/:type/:id', requireAdminAuth, async (req: any, res: any) => {
    const type = req.params.type as MemoryType;
    const caller = callerFromReq(req);
    const ok = await MemoryEngine.delete(req.params.id, type, caller);
    res.json({ success: ok });
  });
}
