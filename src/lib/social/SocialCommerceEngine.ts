/**
 * SocialCommerceEngine — share links, referral tracking, social proof.
 * Architecture: NexusDB only, no direct firebase imports (ADR-0001).
 */
import { NexusDB } from '../database/NexusDB';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('SocialCommerceEngine');

export class SocialCommerceEngine {
  /** Build a shareable product URL with optional referral code */
  static generateShareLink(productId: string, referrerCode?: string): string {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : (process.env?.APP_URL ?? 'https://nexusos.com');
    const url = `${origin}/product/${productId}${referrerCode ? `?ref=${referrerCode}` : ''}`;
    return url;
  }

  /** Generate platform-specific share URLs */
  static async shareToPlatform(
    platform: 'whatsapp' | 'facebook' | 'telegram' | 'twitter',
    productId: string,
    productName: string,
    referrerCode?: string,
  ): Promise<string> {
    const link = this.generateShareLink(productId, referrerCode);
    const text = encodeURIComponent(`Check out ${productName}: `);
    const encodedLink = encodeURIComponent(link);

    const urls: Record<string, string> = {
      whatsapp: `https://wa.me/?text=${text}${encodedLink}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`,
      telegram: `https://t.me/share/url?url=${encodedLink}&text=${text}`,
      twitter:  `https://twitter.com/intent/tweet?url=${encodedLink}&text=${text}`,
    };

    // Track the share event
    await this.trackShare(productId, platform, referrerCode).catch(() => {});

    return urls[platform] ?? link;
  }

  /** Record a share event for analytics */
  static async trackShare(
    productId: string,
    platform: string,
    referrerCode?: string,
  ): Promise<void> {
    try {
      await NexusDB.add('share_events', {
        productId,
        platform,
        referrerCode: referrerCode ?? null,
        sharedAt: NexusDB.serverTimestamp(),
      });
    } catch (err) {
      log.warn('trackShare failed', { productId, error: String(err) });
    }
  }

  /** Get share count for a product */
  static async getShareCount(productId: string): Promise<number> {
    try {
      const shares = await NexusDB.find('share_events', {
        where: [{ field: 'productId', op: '==', value: productId }],
        limit: 1000,
      });
      return shares.length;
    } catch {
      return 0;
    }
  }
}
