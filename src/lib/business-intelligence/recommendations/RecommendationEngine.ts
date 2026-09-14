/**
 * NEXUS RECOMMENDATION ENGINE — Phase 7
 * Personalized product recommendations using collaborative filtering + semantic memory.
 */

import { logger } from '../../core/logging/NexusLogger';
import { MemoryEngine } from '../../memory/NexusMemoryEngine';
import { EmbeddingService } from '../../ai/Embeddings';
import { NexusConfig } from '../../core/config/NexusConfig';

const log = logger.child('RecommendationEngine');
const SYSTEM_CALLER = { id: 'system', type: 'system' as const, roles: ['admin'], isOwner: false };

export interface ProductRecommendation {
  productId: string;
  name: string;
  score: number;         // 0-1
  reason: string;
  category: string;
  price: number;
}

class RecommendationEngineImpl {
  private collab = new Map<string, Map<string, number>>(); // userId → productId → rating

  /** Record user interaction for collaborative filtering */
  async recordInteraction(userId: string, productId: string, action: 'view' | 'cart' | 'purchase') {
    const weight = { view: 0.2, cart: 0.6, purchase: 1.0 }[action];
    if (!this.collab.has(userId)) this.collab.set(userId, new Map());
    const current = this.collab.get(userId)!.get(productId) || 0;
    this.collab.get(userId)!.set(productId, Math.min(1, current + weight));

    // Store in semantic memory for persistence
    await MemoryEngine.writeSemanticKnowledge(
      `User ${userId} ${action} product ${productId}`,
      'user_interactions',
      userId,
      { tags: [`user:${userId}`, `product:${productId}`, `action:${action}`] },
      SYSTEM_CALLER,
    ).catch(() => {});
  }

  /** Get personalized recommendations for a user */
  async getRecommendations(userId: string, limit = 6): Promise<ProductRecommendation[]> {
    try {
      const { db } = await import('../../../firebase');
      const { collection, getDocs, query, where } = await import('firebase/firestore');

      // 1. Get all products
      const productsSnap = await getDocs(collection(db, 'products'));
      const products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      // 2. Get user's order history
      const ordersSnap = await getDocs(query(
        collection(db, 'orders'),
        where('userId', '==', userId),
      ));
      const purchasedIds = new Set<string>();
      for (const doc of ordersSnap.docs) {
        const data = doc.data();
        for (const item of (data.items || [])) {
          purchasedIds.add(item.productId || item.id);
        }
      }

      // 3. Semantic similarity search
      let semanticScores = new Map<string, number>();
      if (purchasedIds.size > 0) {
        const purchasedNames = products
          .filter(p => purchasedIds.has(p.id))
          .map(p => p.name).join(', ');

        if (purchasedNames) {
          const results = await MemoryEngine.semanticSearch(
            `Products similar to: ${purchasedNames}`,
            { collection: 'product_kb', topK: 20, threshold: 0.5 }
          ).catch(() => []);

          results.forEach(r => {
            const productId = r.metadata?.productId;
            if (productId) semanticScores.set(productId, r.score);
          });
        }
      }

      // 4. Score each product
      const userInteractions = this.collab.get(userId) || new Map();
      const scored = products
        .filter(p => !purchasedIds.has(p.id) && p.stock > 0) // Exclude purchased + out of stock
        .map(p => {
          let score = 0.3; // Base score
          const collabScore = userInteractions.get(p.id) || 0;
          const semanticScore = semanticScores.get(p.id) || 0;
          const popularityScore = Math.min(0.3, (p.salesCount || 0) / 100);

          score += collabScore * 0.4;    // 40% collaborative
          score += semanticScore * 0.35; // 35% semantic similarity
          score += popularityScore;      // 25% popularity

          let reason = 'Popular in your area';
          if (collabScore > 0) reason = 'Based on your browsing history';
          if (semanticScore > 0.7) reason = 'Similar to products you love';
          if (purchasedIds.size === 0) reason = 'Top-rated product';

          return { productId: p.id, name: p.name, score, reason, category: p.category || 'General', price: p.price };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      log.debug('Recommendations generated', { userId, count: scored.length });
      return scored;
    } catch (e) {
      log.error('Recommendations failed', e instanceof Error ? e : undefined);
      return [];
    }
  }

  /** Get "customers also bought" for a product */
  async getRelatedProducts(productId: string, limit = 4): Promise<string[]> {
    const coOccurrence = new Map<string, number>();
    for (const [, interactions] of this.collab.entries()) {
      if (!interactions.has(productId)) continue;
      for (const [otherProductId] of interactions.entries()) {
        if (otherProductId === productId) continue;
        coOccurrence.set(otherProductId, (coOccurrence.get(otherProductId) || 0) + 1);
      }
    }
    return Array.from(coOccurrence.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }
}

export const RecommendationEngine = new RecommendationEngineImpl();
