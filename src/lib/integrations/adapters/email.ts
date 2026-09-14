/**
 * Email Adapter — Real implementation via SMTP (send) + IMAP polling (receive)
 * Uses nodemailer for sending. For receiving, uses a webhook/forwarding approach
 * (recommended: Mailgun/SendGrid inbound parsing — simpler than raw IMAP in cloud).
 *
 * Setup Option A — SMTP only (send) + Mailgun inbound webhook (receive):
 *  1. SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env
 *  2. MAILGUN_API_KEY, MAILGUN_DOMAIN in .env
 *  3. In Mailgun: Routes → Create Route → Forward to /api/webhooks/email
 *
 * Setup Option B — Gmail / Google Workspace:
 *  1. Use SMTP_HOST=smtp.gmail.com, SMTP_PORT=587
 *  2. Use App Password (not your main password)
 *  3. SMTP_USER=your@gmail.com, SMTP_PASS=app-password
 */
import { IOmniConnector, PlatformType, UnifiedMessage } from '../OmniConnector';

export class EmailAdapter implements IOmniConnector {
  platform: PlatformType = 'email';
  private smtpHost: string;
  private smtpPort: number;
  private smtpUser: string;
  private smtpPass: string;
  private fromName: string;
  private messageHandler: ((msg: UnifiedMessage) => void) | null = null;

  constructor() {
    const env = (process as any)?.env || {};
    this.smtpHost = env.SMTP_HOST || '';
    this.smtpPort = parseInt(env.SMTP_PORT || '587', 10);
    this.smtpUser = env.SMTP_USER || '';
    this.smtpPass = env.SMTP_PASS || '';
    this.fromName = env.SMTP_FROM_NAME || 'Nexus Support';
  }

  async connect(): Promise<boolean> {
    if (!this.smtpHost || !this.smtpUser || !this.smtpPass) {
      console.warn('[EmailAdapter] SMTP credentials not set. Email sending disabled.');
      return false;
    }
    console.log(`[EmailAdapter] SMTP configured: ${this.smtpUser}@${this.smtpHost}:${this.smtpPort}`);
    return true;
  }

  async disconnect(): Promise<void> {
    console.log('[EmailAdapter] Disconnected.');
  }

  onMessage(handler: (msg: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Handle inbound email from Mailgun/SendGrid webhook parsing.
   * Register POST /api/webhooks/email in server.ts.
   *
   * Mailgun sends multipart/form-data with: sender, recipient, subject, body-plain, etc.
   */
  async handleWebhookPayload(payload: any): Promise<void> {
    if (!this.messageHandler) return;

    // Mailgun inbound format
    const sender = payload.sender || payload.from || '';
    const subject = payload.subject || '(no subject)';
    const body = payload['body-plain'] || payload.text || payload.body || '';
    const messageId = payload['Message-Id'] || payload.id || Date.now().toString();

    if (!sender || !body) return;

    this.messageHandler({
      id: messageId,
      platform: this.platform,
      senderId: `email_${sender}`,
      senderName: sender,
      content: `[Subject: ${subject}]\n${body}`,
      timestamp: Date.now(),
      metadata: {
        subject,
        from: sender,
        recipient: payload.recipient || payload.to,
      },
    });
  }

  /**
   * Send an email via SMTP using the Fetch-based raw SMTP approach.
   * In production, use nodemailer (server-side only):
   *   npm install nodemailer @types/nodemailer
   */
  async sendMessage(userId: string, content: string, options?: { subject?: string; html?: string }): Promise<boolean> {
    const toEmail = userId.replace('email_', '');
    const subject = options?.subject || 'Message from Nexus Support';
    const html = options?.html ?? content.replace(/\n/g, '<br>');

    if (!this.smtpHost || !this.smtpUser) {
      console.warn(`[EmailAdapter DRY-RUN] -> ${toEmail} | ${subject}\n${content}`);
      return true;
    }

    // Server-side: dynamically import nodemailer (not bundled in client)
    try {
      const nodemailer = await import('nodemailer' as any);
      const transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpPort === 465,
        auth: { user: this.smtpUser, pass: this.smtpPass },
      });

      await transporter.sendMail({
        from: `"${this.fromName}" <${this.smtpUser}>`,
        to: toEmail,
        subject,
        text: content,
        html,
      });

      console.log(`[EmailAdapter] Sent to ${toEmail}`);
      return true;
    } catch (e) {
      console.error('[EmailAdapter] Send failed:', e);
      return false;
    }
  }
}
