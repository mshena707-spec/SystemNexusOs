import { NexusDB } from '../database/NexusDB';

const COLLECTION = 'webhook_endpoints';

export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'disabled';
  createdAt: string;
  lastTestAt?: string;
  lastTestResult?: { ok: boolean; statusCode?: number; error?: string };
}

export class WebhookService {
  static async list(): Promise<WebhookRecord[]> {
    return NexusDB.find(COLLECTION, { orderBy: 'createdAt', orderDir: 'desc', limit: 100 }) as Promise<WebhookRecord[]>;
  }

  static async create(url: string, events: string[]): Promise<WebhookRecord> {
    if (!/^https?:\/\//.test(url)) throw new Error('Webhook URL must start with http:// or https://');
    const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: WebhookRecord = { id, url, events, status: 'active', createdAt: new Date().toISOString() };
    await NexusDB.set(COLLECTION, id, record);
    return record;
  }

  static async remove(id: string): Promise<void> {
    await NexusDB.delete(COLLECTION, id);
  }

  static async setStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
    await NexusDB.update(COLLECTION, id, { status });
  }

  /** Actually sends a test payload to the registered URL — a real network call, not a simulated success. */
  static async test(id: string): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
    const record = await NexusDB.get(COLLECTION, id) as WebhookRecord | null;
    if (!record) throw new Error('Webhook not found');

    let result: { ok: boolean; statusCode?: number; error?: string };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(record.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Nexus-Event': 'webhook.test' },
        body: JSON.stringify({ event: 'webhook.test', timestamp: new Date().toISOString(), message: 'Test payload from NexusOS Developer Hub' }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      result = { ok: res.ok, statusCode: res.status };
    } catch (err: any) {
      result = { ok: false, error: err.name === 'AbortError' ? 'Timed out after 8s' : err.message };
    }

    await NexusDB.update(COLLECTION, id, { lastTestAt: new Date().toISOString(), lastTestResult: result }).catch(() => {});
    return result;
  }
}
