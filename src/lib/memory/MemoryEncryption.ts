/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  MEMORY ENCRYPTION                                                       ║
 * ║  Answers CTO Audit Part 4, section 14.                                   ║
 * ║                                                                           ║
 * ║  Confirmed gap: OwnerMemory's write path had a literal comment —          ║
 * ║  `content, // In production: encrypt this field` — in NexusMemoryEngine  ║
 * ║  .writeOwner(). The schema anticipated encryption (encryptionKeyId?,     ║
 * ║  encrypt? fields already existed on MemoryTypes.ts) but nothing acted    ║
 * ║  on them — the same "schema ready, nothing consumes it" pattern found    ║
 * ║  with expiresAt/ttlSeconds in Part 2's memory_cleanup work.              ║
 * ║                                                                           ║
 * ║  AES-256-GCM via Node's built-in `crypto` (no new dependency). Keyed via ║
 * ║  SecretVault (Part 4) rather than a raw env read, so the encryption key  ║
 * ║  itself gets the same access-logging/caller-type protection as any       ║
 * ║  other secret.                                                           ║
 * ║                                                                           ║
 * ║  GRACEFUL DEGRADATION, STATED HONESTLY: if MEMORY_ENCRYPTION_KEY isn't   ║
 * ║  configured, encrypt() passes content through unencrypted with a logged  ║
 * ║  warning rather than throwing — this was a deliberate choice so a        ║
 * ║  deployment that hasn't set the key up yet doesn't suddenly fail to      ║
 * ║  write Owner memory. Check logs for that warning; don't assume           ║
 * ║  encryption is active without confirming the key is actually set.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import crypto from 'crypto';
import { SecretVault } from '../security/vault/SecretVault';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('MemoryEncryption');
const ALGORITHM = 'aes-256-gcm';
const KEY_ENV_VAR = 'MEMORY_ENCRYPTION_KEY'; // expected: 32-byte key, hex-encoded (64 hex chars)

export interface EncryptedPayload {
  ciphertext: string; // hex
  iv: string;          // hex
  authTag: string;     // hex
  encrypted: true;
}

class MemoryEncryptionImpl {
  private _keyWarningLogged = false;

  private _getKey(): Buffer | null {
    if (!SecretVault.hasSecret(KEY_ENV_VAR)) {
      if (!this._keyWarningLogged) {
        log.warn(`${KEY_ENV_VAR} not configured — Owner memory will be written UNENCRYPTED. Set this env var to enable encryption at rest.`);
        this._keyWarningLogged = true;
      }
      return null;
    }
    const raw = SecretVault.get(KEY_ENV_VAR, { caller: 'system', module: 'MemoryEncryption' });
    const key = Buffer.from(raw, 'hex');
    if (key.length !== 32) {
      log.error(`${KEY_ENV_VAR} is set but is not a valid 32-byte hex key (got ${key.length} bytes) — writing UNENCRYPTED`);
      return null;
    }
    return key;
  }

  /** Returns the plaintext unchanged (not wrapped in EncryptedPayload) if no
   *  key is configured — see the file header for why this is a deliberate
   *  fallback, not a bug. Callers should treat the return type as
   *  `string | EncryptedPayload` and check `.encrypted` before assuming shape. */
  encrypt(plaintext: string): string | EncryptedPayload {
    const key = this._getKey();
    if (!key) return plaintext;

    const iv = crypto.randomBytes(12); // GCM standard IV size
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { ciphertext: ciphertext.toString('hex'), iv: iv.toString('hex'), authTag: authTag.toString('hex'), encrypted: true };
  }

  decrypt(payload: string | EncryptedPayload): string {
    if (typeof payload === 'string') return payload; // was never encrypted (no key at write time)

    const key = this._getKey();
    if (!key) {
      throw new Error('MemoryEncryption: cannot decrypt — MEMORY_ENCRYPTION_KEY is not configured, but this content was encrypted (key was rotated/removed?)');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'hex')), decipher.final()]);
    return plaintext.toString('utf8');
  }

  isEncrypted(value: unknown): value is EncryptedPayload {
    return typeof value === 'object' && value !== null && (value as EncryptedPayload).encrypted === true;
  }
}

export const MemoryEncryption = new MemoryEncryptionImpl();
