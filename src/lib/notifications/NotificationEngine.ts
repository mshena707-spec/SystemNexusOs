import { SecretVault } from '../security/vault/SecretVault';
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         NOTIFICATION ENGINE — Phase A Replacement            ║
 * ║                                                              ║
 * ║  Replaces deprecated fcm.googleapis.com/fcm/send legacy API  ║
 * ║  (shut down June 2024) with Firebase Admin SDK v12+          ║
 * ║                                                              ║
 * ║  Channels: FCM Push, SMS (Twilio), Email (SMTP), In-App     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * SETUP:
 *  Set FIREBASE_SERVICE_ACCOUNT_JSON env var to the base64-encoded
 *  contents of your Firebase service account JSON file.
 *  (from Firebase Console → Project Settings → Service Accounts)
 *
 *  For SMS: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *  For Email: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

const IS_SERVER = typeof window === 'undefined';

export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  link?: string;
}

export interface SMSPayload {
  to: string;      // E.164 format: +8801XXXXXXXXX
  body: string;
}

export interface GenericNotifyPayload {
  userId: string;
  title: string;
  message: string;
  channels?: Array<'push' | 'in_app' | 'sms' | 'email'>;
  link?: string;
  phone?: string;
}

// ── Firebase Admin singleton ───────────────────────────────────────────────
let _adminApp: any = null;
let _messaging: any = null;

async function getAdminMessaging() {
  if (_messaging) return _messaging;
  if (!IS_SERVER) return null;

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.warn('[NotificationEngine] FIREBASE_SERVICE_ACCOUNT_JSON not set — push disabled.');
    return null;
  }

  try {
    const admin = await import('firebase-admin');
    if (!_adminApp) {
      const serviceAccount = JSON.parse(
        Buffer.from(saJson, 'base64').toString('utf-8')
      );
      _adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      }, 'nexus-notify-' + Date.now());
    }
    _messaging = _adminApp.messaging();
    return _messaging;
  } catch (err) {
    console.error('[NotificationEngine] Firebase Admin init failed:', err);
    return null;
  }
}

// ── Main engine ────────────────────────────────────────────────────────────
export class NotificationEngine {

  // ── FCM Push (Firebase Admin SDK — NOT legacy REST) ────────────────────
  static async sendPush(payload: PushPayload): Promise<boolean> {
    if (!IS_SERVER) {
      console.warn('[NotificationEngine] Push must be sent server-side.');
      return false;
    }

    const messaging = await getAdminMessaging();
    if (!messaging) return false;

    try {
      // Get token from Firestore
      const { db } = await import('../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'user_fcm_tokens', payload.userId));
      const fcmToken = snap.data()?.token;

      if (!fcmToken) {
        console.warn(`[NotificationEngine] No FCM token for user ${payload.userId}`);
        // Still persist in-app notification
        await NotificationEngine._saveInApp(payload);
        return false;
      }

      await messaging.send({
        token: fcmToken,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        webpush: payload.link ? {
          fcmOptions: { link: payload.link },
        } : undefined,
        data: payload.data,
      });

      await NotificationEngine._saveInApp(payload);
      return true;
    } catch (err: any) {
      // Token invalid/expired — clean it up
      if (err?.code === 'messaging/registration-token-not-registered') {
        const { db } = await import('../../firebase');
        const { doc, deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'user_fcm_tokens', payload.userId));
        console.warn(`[NotificationEngine] Stale FCM token removed for ${payload.userId}`);
      } else {
        console.error('[NotificationEngine] FCM send error:', err);
      }
      return false;
    }
  }

  // ── SMS via Twilio ─────────────────────────────────────────────────────
  static async sendSMS(payload: SMSPayload): Promise<boolean> {
    if (!IS_SERVER) return false;

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = SecretVault.get('TWILIO_AUTH_TOKEN', { caller: 'system', module: 'NotificationEngine' });
    const from = process.env.TWILIO_FROM_NUMBER;

    if (!sid || !token || !from) {
      console.warn('[NotificationEngine] Twilio credentials not set — SMS skipped.');
      return false;
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const body = new URLSearchParams({ From: from, To: payload.to, Body: payload.body });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[NotificationEngine] Twilio error:', err);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[NotificationEngine] SMS send error:', err);
      return false;
    }
  }

  // ── Email ──────────────────────────────────────────────────────────────
  static async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!IS_SERVER) return false;
    try {
      const { EmailAdapter } = await import('../integrations/channels/EmailAdapter');
      await EmailAdapter.send({ to, subject, html });
      return true;
    } catch (err) {
      console.error('[NotificationEngine] Email send error:', err);
      return false;
    }
  }

  // ── In-App notification (always runs) ─────────────────────────────────
  private static async _saveInApp(payload: PushPayload): Promise<void> {
    try {
      const { db } = await import('../../firebase');
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
      await addDoc(collection(db, 'notifications'), {
        userId: payload.userId,
        title: payload.title,
        body: payload.body,
        link: payload.link ?? null,
        data: payload.data ?? null,
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[NotificationEngine] In-app save failed:', err);
    }
  }

  // ── Convenience: notify via all configured channels ────────────────────
  static async notifyAll(payload: PushPayload & { phone?: string }): Promise<void> {
    const results = await Promise.allSettled([
      NotificationEngine.sendPush(payload),
      payload.phone ? NotificationEngine.sendSMS({ to: payload.phone, body: `${payload.title}: ${payload.body}` }) : Promise.resolve(false),
    ]);
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`[NotificationEngine] Channel ${i} failed:`, r.reason);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Added during CTO Audit Part 2 response (2026-07-18): every method below
  // this line was already being called from AutomationEngine.ts (11 sites)
  // and TaskQueue.ts (2 sites) — confirmed by running `tsc --noEmit` — but
  // never actually existed on this class. Signatures match the exact shape
  // those real call sites already pass, not a guessed API. See
  // docs/governance/TECHNICAL_DEBT_REGISTER.md for the full finding.
  // ══════════════════════════════════════════════════════════════════════

  /** Public entry point to persist an in-app notification without necessarily
   *  sending a push — this is what every `saveInApp(userId, title, body, link)`
   *  call site in AutomationEngine.ts/TaskQueue.ts actually needs. Wraps the
   *  existing private _saveInApp rather than duplicating its Firestore write. */
  static async saveInApp(userId: string, title: string, body: string, link?: string): Promise<void> {
    await NotificationEngine._saveInApp({ userId, title, body, link });
  }

  /** General-purpose "notify this user, respecting the requested channels."
   *  `sendPush` already persists an in-app record as a side effect, so the
   *  in_app-only path below calls _saveInApp directly instead of double-writing. */
  static async notify(payload: GenericNotifyPayload): Promise<void> {
    const channels = payload.channels ?? ['push', 'in_app'];
    const pushPayload: PushPayload = { userId: payload.userId, title: payload.title, body: payload.message, link: payload.link };

    if (channels.includes('push')) {
      await NotificationEngine.sendPush(pushPayload);
    } else if (channels.includes('in_app')) {
      await NotificationEngine._saveInApp(pushPayload);
    }
    if (channels.includes('sms') && payload.phone) {
      await NotificationEngine.sendSMS({ to: payload.phone, body: `${payload.title}: ${payload.message}` });
    }
    if (channels.includes('email')) {
      console.warn('[NotificationEngine] notify() channels included "email" but notify() does not have an email address to send to — use sendEmail() directly for email.');
    }
  }

  // ── Order-lifecycle convenience wrappers ────────────────────────────────
  // Thin, named wrappers over notify() — exist because AutomationEngine.ts's
  // event handlers (handleOrderCreated/Paid/Dispatched/Delivered) already call
  // these by name; this is what makes those handlers actually work end to end.

  static async notifyOrderPlaced(orderId: string, userId: string): Promise<void> {
    await NotificationEngine.notify({
      userId,
      title: '🛒 Order Placed',
      message: `Your order #${orderId.slice(0, 8)} has been placed successfully.`,
      channels: ['push', 'in_app'],
      link: `/orders/${orderId}`,
    });
  }

  static async notifyOrderPaid(orderId: string, userId: string): Promise<void> {
    await NotificationEngine.notify({
      userId,
      title: '✅ Payment Confirmed',
      message: `Payment received for order #${orderId.slice(0, 8)}.`,
      channels: ['push', 'in_app'],
      link: `/orders/${orderId}`,
    });
  }

  static async notifyOrderDispatched(orderId: string, userId: string, riderName: string, phone?: string): Promise<void> {
    await NotificationEngine.notify({
      userId,
      title: '🏍️ Order Dispatched',
      message: `${riderName} is on the way with your order #${orderId.slice(0, 8)}.`,
      channels: phone ? ['push', 'in_app', 'sms'] : ['push', 'in_app'],
      link: `/orders/${orderId}/track`,
      phone,
    });
  }

  static async notifyOrderDelivered(orderId: string, userId: string): Promise<void> {
    await NotificationEngine.notify({
      userId,
      title: '📦 Delivered',
      message: `Order #${orderId.slice(0, 8)} has been delivered. Enjoy!`,
      channels: ['push', 'in_app'],
      link: `/orders/${orderId}`,
    });
  }
}
