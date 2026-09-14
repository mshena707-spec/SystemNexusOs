/**
 * EmailAdapter (channels/) — thin facade
 *
 * `NotificationEngine.ts` was written against a module of this name/shape
 * (`static send({ to, subject, html })`) that never existed. The real,
 * working SMTP implementation is the instance-based `EmailAdapter` in
 * src/lib/integrations/adapters/email.ts (nodemailer, dry-run logging when
 * SMTP env vars aren't set) — this file exposes it under the simple static
 * shape NotificationEngine expects.
 */
import { EmailAdapter as RealEmailAdapter } from '../adapters/email';

const instance = new RealEmailAdapter();

export class EmailAdapter {
  static async send({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> {
    // sendMessage() strips an 'email_' prefix if present; a plain address is unaffected.
    return instance.sendMessage(to, html.replace(/<[^>]+>/g, ' ').trim(), { subject, html });
  }
}
