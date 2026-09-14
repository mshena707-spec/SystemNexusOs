/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CAMPAIGN ENGINE — Phase I                                           ║
 * ║                                                                      ║
 * ║  Real campaign creation, real delivery (via Phase A's                ║
 * ║  NotificationEngine — sendPush/sendSMS/sendEmail), and real           ║
 * ║  attribution: ROI is measured from ACTUAL orders placed by recipients║
 * ║  in a follow-up window after the campaign sent, never an invented     ║
 * ║  percentage.                                                          ║
 * ║                                                                      ║
 * ║  This replaces the pattern in GrowthEngine.suggestCampaign(), which   ║
 * ║  returned `expectedROI: '+14%'` as a hardcoded literal regardless     ║
 * ║  of audience, channel, or content — a number with no basis in any     ║
 * ║  real data, presented as if it were a measurement.                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import type { CustomerSegment } from './SegmentationEngine';

export type CampaignChannel = 'push' | 'sms' | 'email';
export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed';

export interface Campaign {
  id?: string;
  name: string;
  segment: CustomerSegment | 'all';
  channel: CampaignChannel;
  subject?: string;       // for email
  content: string;
  discountCode?: string;
  status: CampaignStatus;
  audienceSize?: number;
  sentCount?: number;
  failedCount?: number;
  createdBy: string;
  createdAt?: string;
  sentAt?: string;
  attributionWindowDays: number; // how many days post-send to attribute orders to this campaign
}

export interface CampaignAttribution {
  campaignId: string;
  campaignName: string;
  audienceSize: number;
  ordersAttributed: number;     // orders placed by a campaign recipient within the attribution window
  revenueAttributed: number;
  conversionRatePct: number;    // ordersAttributed / audienceSize
  measuredAt: string;
}

export class CampaignEngine {

  /**
   * Create a campaign draft. Does not send — call send() separately so
   * the admin can review the audience size and content first.
   */
  static async create(input: Omit<Campaign, 'status' | 'createdAt'>): Promise<string> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.add('campaigns', { ...input, status: 'draft' as CampaignStatus, createdAt: new Date().toISOString() });
  }

  /**
   * Send a campaign to its target segment via the requested channel.
   * Uses real NotificationEngine delivery — sendPush/sendSMS/sendEmail —
   * not a simulated send. Records actual sent/failed counts from real
   * delivery attempts, not an assumed 100% success rate.
   */
  static async send(campaignId: string): Promise<{ success: boolean; sentCount: number; failedCount: number; error?: string }> {
    const { NexusDB } = await import('../database/NexusDB');
    const { SegmentationEngine } = await import('./SegmentationEngine');
    const { NotificationEngine } = await import('../notifications/NotificationEngine');

    const campaign = await NexusDB.get('campaigns', campaignId) as Campaign | null;
    if (!campaign) return { success: false, sentCount: 0, failedCount: 0, error: 'Campaign not found' };
    if (campaign.status === 'sent' || campaign.status === 'sending') {
      return { success: false, sentCount: 0, failedCount: 0, error: `Campaign already ${campaign.status}` };
    }

    await NexusDB.update('campaigns', campaignId, { status: 'sending' });

    // Build audience
    let audience: string[];
    if (campaign.segment === 'all') {
      const allScored = await SegmentationEngine.scoreAllCustomers();
      audience = allScored.map(c => c.userId);
    } else {
      const members = await SegmentationEngine.getSegmentMembers(campaign.segment as CustomerSegment);
      audience = members.map(m => m.userId);
    }

    let sentCount = 0, failedCount = 0;

    for (const userId of audience) {
      try {
        let delivered = false;
        if (campaign.channel === 'push') {
          delivered = await NotificationEngine.sendPush({ userId, title: campaign.name, body: campaign.content });
        } else if (campaign.channel === 'sms') {
          // sendSMS requires a phone — look it up via CustomerIdentityService (Phase G)
          const { CustomerIdentityService } = await import('../omnichannel/CustomerIdentityService');
          const identity = await CustomerIdentityService.getById(userId);
          if (identity?.primaryPhone) {
            delivered = await NotificationEngine.sendSMS({ to: identity.primaryPhone, body: campaign.content });
          }
        } else if (campaign.channel === 'email') {
          const { CustomerIdentityService } = await import('../omnichannel/CustomerIdentityService');
          const identity = await CustomerIdentityService.getById(userId);
          if (identity?.primaryEmail) {
            delivered = await NotificationEngine.sendEmail(identity.primaryEmail, campaign.subject ?? campaign.name, campaign.content);
          }
        }
        if (delivered) sentCount++; else failedCount++;
      } catch {
        failedCount++;
      }
    }

    await NexusDB.update('campaigns', campaignId, {
      status: 'sent', audienceSize: audience.length, sentCount, failedCount, sentAt: new Date().toISOString(),
    });

    // Record which userIds were targeted, so attribution can later check
    // "did this specific person order afterward" rather than guessing.
    await NexusDB.set('campaign_recipients', campaignId, { campaignId, userIds: audience, sentAt: new Date().toISOString() }, true);

    return { success: true, sentCount, failedCount };
  }

  /**
   * Measure REAL attribution: for each recipient, check if they placed an
   * order within `attributionWindowDays` after the campaign sent. This is
   * the actual replacement for GrowthEngine's fabricated `expectedROI`.
   * A campaign sent to 0 responsive customers will correctly show 0%
   * conversion — there is no floor or assumed minimum.
   */
  static async measureAttribution(campaignId: string): Promise<CampaignAttribution | null> {
    const { NexusDB } = await import('../database/NexusDB');
    const { OrderRepository } = await import('../database/repositories/OrderRepository');

    const campaign = await NexusDB.get('campaigns', campaignId) as Campaign | null;
    const recipients = await NexusDB.get('campaign_recipients', campaignId) as { userIds: string[] } | null;
    if (!campaign || !recipients || campaign.status !== 'sent' || !campaign.sentAt) return null;

    const windowEnd = new Date(new Date(campaign.sentAt).getTime() + campaign.attributionWindowDays * 24 * 60 * 60 * 1000).toISOString();

    let ordersAttributed = 0;
    let revenueAttributed = 0;

    for (const userId of recipients.userIds) {
      const orders = await OrderRepository.findByUser(userId, { limit: 20 });
      const inWindow = orders.filter(o => {
        const createdAt = (o.createdAt ?? '').toString();
        return createdAt >= campaign.sentAt! && createdAt <= windowEnd && (o.status === 'Paid' || o.status === 'Delivered');
      });
      if (inWindow.length > 0) {
        ordersAttributed += inWindow.length;
        revenueAttributed += inWindow.reduce((s, o) => s + (o.total ?? 0), 0);
      }
    }

    const attribution: CampaignAttribution = {
      campaignId, campaignName: campaign.name,
      audienceSize: recipients.userIds.length,
      ordersAttributed, revenueAttributed,
      conversionRatePct: recipients.userIds.length > 0 ? (ordersAttributed / recipients.userIds.length) * 100 : 0,
      measuredAt: new Date().toISOString(),
    };

    await NexusDB.set('campaign_attribution', campaignId, attribution, true);
    return attribution;
  }

  static async list(limit = 50): Promise<Campaign[]> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.find('campaigns', { orderBy: 'createdAt', orderDir: 'desc', limit }) as Promise<Campaign[]>;
  }

  static async getById(campaignId: string): Promise<Campaign | null> {
    const { NexusDB } = await import('../database/NexusDB');
    return NexusDB.get('campaigns', campaignId) as Promise<Campaign | null>;
  }
}
