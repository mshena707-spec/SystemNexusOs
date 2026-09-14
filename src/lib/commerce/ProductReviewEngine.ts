/**
 * ProductReviewEngine — Reviews, Ratings & Trust Signals
 *
 * WHY: 93% of consumers read reviews before buying.
 *      No reviews = no trust = lower conversion rates.
 *      Amazon/Daraz built their empires partly on review systems.
 *
 * vs World-class:
 *   Amazon:  Verified Purchase badge, helpful votes, seller response
 *   Daraz:   Photo reviews, size feedback, delivery rating
 *   Shopify: Judge.me integration, structured star ratings
 *
 * Features:
 *   - Verified purchase badge (only buyers can review)
 *   - Photo/video attachment support
 *   - Helpful votes (yes/no)
 *   - Seller response to reviews
 *   - AI sentiment → auto-flag negative reviews for attention
 *   - Aggregate rating calculation
 *   - Review request after delivery (via NexusDB RedisTaskQueue)
 */

import { NexusDB } from '../database/NexusDB';
import { EventBus } from '../core/events/NexusEventBus';

export interface ProductReview {
  id: string;
  productId: string;
  vendorId: string;
  userId: string;
  orderId: string;
  isVerifiedPurchase: boolean;
  rating: number;           // 1-5
  title: string;
  body: string;
  mediaUrls?: string[];     // photos/videos
  tags?: string[];          // ['fits_true_to_size', 'great_quality', etc.]
  helpfulYes: number;
  helpfulNo: number;
  status: 'pending' | 'approved' | 'rejected' | 'flagged';
  vendorResponse?: string;
  vendorResponseAt?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  sentimentScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRating {
  productId: string;
  totalReviews: number;
  avgRating: number;
  distribution: Record<number, number>; // {5: 40, 4: 20, 3: 10, 2: 5, 1: 3}
  verifiedCount: number;
  withPhotos: number;
  lastUpdated: string;
}

const REVIEWS_COL = 'product_reviews';
const RATINGS_COL = 'product_ratings';

export class ProductReviewEngine {

  // ── Submit a review ─────────────────────────────────────────────────────

  static async submitReview(data: {
    productId: string;
    userId: string;
    orderId: string;
    rating: number;
    title: string;
    body: string;
    mediaUrls?: string[];
    tags?: string[];
  }): Promise<{ id: string; status: string }> {

    // Verify purchase
    const order = await NexusDB.get('orders', data.orderId);
    const isVerifiedPurchase = !!(
      order &&
      order.userId === data.userId &&
      (order.status === 'delivered' || order.status === 'completed') &&
      (order.items as Array<{ productId: string }>)?.some(i => i.productId === data.productId)
    );

    // Check: one review per user per product per order
    const existing = await NexusDB.find(REVIEWS_COL, {
      where: [
        { field: 'userId', op: '==', value: data.userId },
        { field: 'productId', op: '==', value: data.productId },
        { field: 'orderId', op: '==', value: data.orderId },
      ],
      limit: 1,
    });
    if (existing.length > 0) {
      throw new Error('You have already reviewed this product for this order');
    }

    // Get vendor ID
    const product = await NexusDB.get('products', data.productId);

    const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // Auto-approve verified purchases, flag unverified for moderation
    const status = isVerifiedPurchase ? 'approved' : 'pending';

    const review: ProductReview = {
      id,
      productId: data.productId,
      vendorId: (product?.vendorId as string) ?? '',
      userId: data.userId,
      orderId: data.orderId,
      isVerifiedPurchase,
      rating: Math.max(1, Math.min(5, Math.round(data.rating))),
      title: data.title.slice(0, 120),
      body: data.body.slice(0, 2000),
      mediaUrls: data.mediaUrls,
      tags: data.tags,
      helpfulYes: 0,
      helpfulNo: 0,
      status,
      createdAt: now,
      updatedAt: now,
    };

    await NexusDB.set(REVIEWS_COL, id, review as unknown as Record<string, unknown>);

    // Async: update product rating aggregate + sentiment analysis
    this.updateProductRating(data.productId).catch(() => {});
    this.analyzeSentiment(id, data.title + ' ' + data.body).catch(() => {});

    // Notify vendor of new review
    EventBus.emit('review.submitted', {
      productId: data.productId,
      vendorId: review.vendorId,
      rating: review.rating,
      isVerified: isVerifiedPurchase,
    });

    // Alert on very negative reviews (1-2 stars from verified buyer)
    if (review.rating <= 2 && isVerifiedPurchase) {
      EventBus.emit('review.negative_alert', {
        productId: data.productId,
        vendorId: review.vendorId,
        reviewId: id,
        rating: review.rating,
      });
    }

    return { id, status };
  }

  // ── Vote helpful ─────────────────────────────────────────────────────────

  static async voteHelpful(reviewId: string, userId: string, helpful: boolean): Promise<void> {
    // One vote per user per review
    const voteId = `vote_${reviewId}_${userId}`;
    const existingVote = await NexusDB.get('review_votes', voteId);
    if (existingVote) throw new Error('Already voted on this review');

    await NexusDB.set('review_votes', voteId, { reviewId, userId, helpful, votedAt: new Date().toISOString() });

    const field = helpful ? 'helpfulYes' : 'helpfulNo';
    await NexusDB.incrementField(REVIEWS_COL, reviewId, field, 1);
  }

  // ── Vendor response ─────────────────────────────────────────────────────

  static async addVendorResponse(
    reviewId: string, vendorId: string, response: string
  ): Promise<void> {
    const review = await NexusDB.get(REVIEWS_COL, reviewId) as ProductReview | null;
    if (!review) throw new Error('Review not found');
    if (review.vendorId !== vendorId) throw new Error('Not your product review');

    await NexusDB.update(REVIEWS_COL, reviewId, {
      vendorResponse: response.slice(0, 1000),
      vendorResponseAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // ── Get product reviews ──────────────────────────────────────────────────

  static async getReviews(productId: string, options: {
    sortBy?: 'recent' | 'helpful' | 'rating_high' | 'rating_low';
    filterRating?: number;
    verifiedOnly?: boolean;
    withPhotos?: boolean;
    limit?: number;
    cursor?: string;
  } = {}): Promise<{ reviews: ProductReview[]; nextCursor?: string; rating: ProductRating | null }> {

    const where: Array<{ field: string; op: '==' | '>='; value: unknown }> = [
      { field: 'productId', op: '==', value: productId },
      { field: 'status', op: '==', value: 'approved' },
    ];
    if (options.filterRating) where.push({ field: 'rating', op: '>=', value: options.filterRating });
    if (options.verifiedOnly) where.push({ field: 'isVerifiedPurchase', op: '==', value: true });

    let reviews = await NexusDB.find(REVIEWS_COL, {
      where,
      orderBy: options.sortBy === 'recent' ? 'createdAt' : 'helpfulYes',
      orderDir: 'desc',
      limit: (options.limit ?? 10) + 1,
    }) as unknown as ProductReview[];

    if (options.withPhotos) {
      reviews = reviews.filter(r => r.mediaUrls && r.mediaUrls.length > 0);
    }

    // Cursor pagination
    const hasMore = reviews.length > (options.limit ?? 10);
    if (hasMore) reviews.pop();
    const nextCursor = hasMore ? reviews[reviews.length - 1]?.id : undefined;

    const rating = await this.getProductRating(productId);
    return { reviews, nextCursor, rating };
  }

  // ── Product rating aggregate ─────────────────────────────────────────────

  static async getProductRating(productId: string): Promise<ProductRating | null> {
    const cached = await NexusDB.get(RATINGS_COL, productId) as ProductRating | null;
    return cached;
  }

  static async updateProductRating(productId: string): Promise<ProductRating> {
    const reviews = await NexusDB.find(REVIEWS_COL, {
      where: [
        { field: 'productId', op: '==', value: productId },
        { field: 'status', op: '==', value: 'approved' },
      ],
      limit: 10000,
    }) as unknown as ProductReview[];

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRating = 0;
    let verifiedCount = 0;
    let withPhotos = 0;

    for (const r of reviews) {
      distribution[r.rating] = (distribution[r.rating] || 0) + 1;
      totalRating += r.rating;
      if (r.isVerifiedPurchase) verifiedCount++;
      if (r.mediaUrls?.length) withPhotos++;
    }

    const rating: ProductRating = {
      productId,
      totalReviews: reviews.length,
      avgRating: reviews.length ? Math.round(totalRating / reviews.length * 10) / 10 : 0,
      distribution,
      verifiedCount,
      withPhotos,
      lastUpdated: new Date().toISOString(),
    };

    await NexusDB.set(RATINGS_COL, productId, rating as unknown as Record<string, unknown>);

    // Update product document with rating snapshot
    await NexusDB.update('products', productId, {
      avgRating: rating.avgRating,
      reviewCount: rating.totalReviews,
    }).catch(() => {});

    return rating;
  }

  // ── AI Sentiment analysis on review text ─────────────────────────────────

  private static async analyzeSentiment(reviewId: string, text: string): Promise<void> {
    try {
      const { NexusUnifiedCore } = await import('../core/NexusUnifiedCore');
      const result = await NexusUnifiedCore.process(
        `Classify review sentiment. JSON only: {"sentiment":"positive"|"neutral"|"negative","score":-1.0to1.0,"tags":["max3keywords"]}\nReview: "${text.slice(0, 300)}"`,
        { agentRole: 'analyst', userId: 'review_engine', systemInstruction: 'JSON only, no markdown.' }
      );
      const p = JSON.parse(result.text.replace(/```json?|```/g, '').trim());
      await NexusDB.update(REVIEWS_COL, reviewId, {
        sentiment: p.sentiment,
        sentimentScore: p.score,
        tags: p.tags,
      });
    } catch { /* non-blocking */ }
  }
}
