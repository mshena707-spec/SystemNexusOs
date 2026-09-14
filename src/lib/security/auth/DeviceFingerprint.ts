/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DEVICE FINGERPRINTING — Phase M                                     ║
 * ║                                                                      ║
 * ║  Generates a stable, privacy-conscious device identifier from        ║
 * ║  request-level signals (no third-party fingerprinting libraries,     ║
 * ║  no canvas/WebGL probing — server-side, header + client-hint based). ║
 * ║                                                                      ║
 * ║  Used by:                                                            ║
 * ║   - AnomalyDetectionEngine: flag logins from new/unusual devices     ║
 * ║   - Bot detection: headless browsers, missing client hints           ║
 * ║   - Session binding: detect token theft (token used from a very      ║
 * ║     different device than where it was issued)                       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import crypto from 'crypto';
import type { Request } from 'express';

export interface DeviceFingerprint {
  fingerprint: string;       // stable hash of device signals
  userAgent: string;
  ipAddress: string;
  acceptLanguage: string;
  platform?: string;         // from Sec-CH-UA-Platform client hint, if present
  isMobile?: boolean;
  isLikelyBot: boolean;
  botReasons: string[];
}

// Known headless/automation user-agent fragments
const BOT_UA_PATTERNS = [
  /headlesschrome/i, /phantomjs/i, /selenium/i, /puppeteer/i, /playwright/i,
  /python-requests/i, /curl\//i, /wget/i, /scrapy/i, /go-http-client/i,
  /^$/, // empty UA
];

// Legitimate search engine / monitoring bots — don't flag as malicious,
// but still identifiable for analytics segmentation.
const KNOWN_GOOD_BOT_PATTERNS = [
  /googlebot/i, /bingbot/i, /slackbot/i, /facebookexternalhit/i, /whatsapp/i,
];

export class DeviceFingerprintService {

  /**
   * Extract a device fingerprint from an Express request.
   * Pure function — no DB access, safe to call on every request.
   */
  static extract(req: Request): DeviceFingerprint {
    const userAgent = (req.headers['user-agent'] as string) ?? '';
    const acceptLanguage = (req.headers['accept-language'] as string) ?? '';
    const ipAddress = this._extractIP(req);
    const platform = req.headers['sec-ch-ua-platform'] as string | undefined;
    const isMobile = req.headers['sec-ch-ua-mobile'] === '?1';

    const botReasons: string[] = [];
    const isKnownGoodBot = KNOWN_GOOD_BOT_PATTERNS.some(p => p.test(userAgent));

    if (!isKnownGoodBot) {
      if (BOT_UA_PATTERNS.some(p => p.test(userAgent))) {
        botReasons.push('user-agent matches known automation/headless pattern');
      }
      if (!userAgent) {
        botReasons.push('missing User-Agent header');
      }
      if (!acceptLanguage) {
        botReasons.push('missing Accept-Language header');
      }
      // Modern real browsers send Sec-Fetch-* headers; absence on non-API
      // navigation requests is a weak bot signal (kept low-weight).
      if (!req.headers['sec-fetch-site'] && !req.path.startsWith('/api/')) {
        botReasons.push('missing Sec-Fetch-Site header on page navigation');
      }
    }

    // Fingerprint: stable hash of UA + Accept-Language + platform.
    // Deliberately EXCLUDES IP so the fingerprint survives IP changes
    // (mobile networks, VPNs) while still identifying "this browser/device".
    const raw = `${userAgent}|${acceptLanguage}|${platform ?? ''}|${isMobile ? 'mobile' : 'desktop'}`;
    const fingerprint = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);

    return {
      fingerprint, userAgent, ipAddress, acceptLanguage,
      platform, isMobile,
      isLikelyBot: botReasons.length > 0,
      botReasons,
    };
  }

  /**
   * Record a device fingerprint against a user account, returning whether
   * this is a NEW device for that user (first time seen).
   */
  static async recordAndCheck(uid: string, fp: DeviceFingerprint): Promise<{ isNewDevice: boolean; knownDeviceCount: number }> {
    const { NexusDB } = await import('../../database/NexusDB');
    const docId = `${uid}_${fp.fingerprint}`;

    const existing = await NexusDB.get('user_devices', docId);
    const isNewDevice = !existing;

    await NexusDB.set('user_devices', docId, {
      uid, fingerprint: fp.fingerprint,
      userAgent: fp.userAgent, platform: fp.platform, isMobile: fp.isMobile,
      lastIp: fp.ipAddress,
      firstSeenAt: existing?.firstSeenAt ?? new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      seenCount: (existing?.seenCount ?? 0) + 1,
    }, true);

    const allDevices = await NexusDB.find('user_devices', { where: [{ field: 'uid', op: '==', value: uid }], limit: 50 });
    return { isNewDevice, knownDeviceCount: allDevices.length };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private static _extractIP(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress ?? req.ip ?? 'unknown';
  }
}
