/**
 * ApiKeyService — real API key generation/verification/revocation.
 *
 * The raw key is shown to the owner exactly once, at generation time — the
 * same pattern GitHub/Stripe/every real API platform uses. After that, only
 * a hash is stored, so even a full database leak can't recover working
 * keys. `verify()` is here so any future route can require an API key the
 * same way requireAdminAuth requires a session — not wired into every route
 * automatically in this pass, since deciding which external routes should
 * accept API-key auth is a product decision for the owner, not something to
 * silently flip on everywhere.
 */
import { NexusDB } from '../database/NexusDB';

const COLLECTION = 'api_keys';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;   // first 12 chars, safe to display forever
  keyHash: string;     // sha256 of the full key — never the raw key
  createdAt: string;
  createdBy?: string;
  lastUsedAt?: string;
}

export type ApiKeyPublic = Omit<ApiKeyRecord, 'keyHash'>;

function sha256(input: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(input).digest('hex');
}

function randomKey(): string {
  const { randomBytes } = require('crypto');
  return `nx_live_${randomBytes(24).toString('base64url')}`;
}

export class ApiKeyService {
  /** Returns the raw key ONCE — caller must show/copy it now, it can never be retrieved again. */
  static async generate(name: string, createdBy?: string): Promise<{ rawKey: string; record: ApiKeyPublic }> {
    const rawKey = randomKey();
    const id = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: ApiKeyRecord = {
      id, name: name || 'Unnamed key',
      keyPrefix: rawKey.slice(0, 12),
      keyHash: sha256(rawKey),
      createdAt: new Date().toISOString(),
      createdBy,
    };
    await NexusDB.set(COLLECTION, id, record);
    const { keyHash, ...publicRecord } = record;
    return { rawKey, record: publicRecord };
  }

  static async list(): Promise<ApiKeyPublic[]> {
    const rows = await NexusDB.find(COLLECTION, { orderBy: 'createdAt', orderDir: 'desc', limit: 100 });
    return rows.map(({ keyHash, ...rest }: any) => rest);
  }

  static async revoke(id: string): Promise<void> {
    await NexusDB.delete(COLLECTION, id);
  }

  /** For future route middleware: does this raw key match a live record? Updates lastUsedAt if so. */
  static async verify(rawKey: string): Promise<ApiKeyPublic | null> {
    if (!rawKey?.startsWith('nx_live_')) return null;
    const hash = sha256(rawKey);
    const matches = await NexusDB.find(COLLECTION, { where: [{ field: 'keyHash', op: '==', value: hash }], limit: 1 });
    if (matches.length === 0) return null;
    const record = matches[0] as ApiKeyRecord;
    await NexusDB.update(COLLECTION, record.id, { lastUsedAt: new Date().toISOString() }).catch(() => {});
    const { keyHash, ...publicRecord } = record;
    return publicRecord;
  }
}
