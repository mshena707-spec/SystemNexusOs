/**
 * AdminSDK.ts — the ONE place where the server talks to Firebase as an administrator.
 *
 * Everything on the server that needs Firebase (checking a customer's login token,
 * reading/writing orders & products in Firestore, sending push messages) goes through
 * this file, so credentials are read in one place and the connection is created once.
 *
 * ── What the owner has to provide (Railway → your service → Variables) ───────────────
 *   FIREBASE_PROJECT_ID     the Firebase project id
 *   FIREBASE_CLIENT_EMAIL   "client_email" from the service-account key file
 *   FIREBASE_PRIVATE_KEY    "private_key" from the service-account key file
 * (or, instead of those three: FIREBASE_SERVICE_ACCOUNT_JSON = the whole key file,
 *  pasted as-is or base64-encoded)
 * Optional:
 *   FIRESTORE_DATABASE_ID   only if the Firestore database is not the one named in
 *                           firebase-applet-config.json
 *
 * Without these the shop pages still open; only the secure-server features
 * (checkout, order confirmation, server-side login) are switched off, and
 * getAdminStatus() says exactly why so the owner's setup screen can show it.
 *
 * ── Why the sub-path imports (firebase-admin/app, /auth, ...) ──────────────────────
 * This project is an ES-module project. The classic `import('firebase-admin')` entry is a
 * CommonJS object whose functions are NOT visible as named exports under ESM — the old
 * code did `admin.initializeApp(...)` on it, which silently failed, so Firebase Admin never
 * started and every server-side login failed. The sub-path entries have real ES-module
 * builds and work everywhere.
 */

import fs from 'fs';
import path from 'path';

const IS_SERVER = typeof window === 'undefined';
const APP_NAME = 'nexus-admin';

interface ServiceAccountLike { projectId: string; clientEmail: string; privateKey: string }

let _app: any = null;
let _initPromise: Promise<any | null> | null = null;
let _auth: any = null;
let _messaging: any = null;
let _firestore: any = null;
let _lastError: string | null = null;
let _credentialMode: 'env' | 'json' | 'adc' | 'none' = 'none';

// ── Reading configuration ──────────────────────────────────────────────────────────

function readAppletConfig(): Record<string, any> {
  try {
    const p = path.join(process.cwd(), 'firebase-applet-config.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

/** Railway/GitHub UIs often wrap pasted values in quotes or turn real newlines into "\n". */
function cleanPrivateKey(raw: string): string {
  let k = raw.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\n/g, '\n');
}

interface ReadResult { sa: ServiceAccountLike | null; mode: 'env' | 'json' | 'none'; error?: string }

function readServiceAccount(): ReadResult {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY ? cleanPrivateKey(process.env.FIREBASE_PRIVATE_KEY) : '';
  if (projectId && clientEmail && privateKey) {
    return { sa: { projectId, clientEmail, privateKey }, mode: 'env' };
  }

  const blob = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (blob) {
    try {
      const text = blob.startsWith('{') ? blob : Buffer.from(blob, 'base64').toString('utf-8');
      const sa = JSON.parse(text);
      const pid = sa.project_id || sa.projectId;
      const email = sa.client_email || sa.clientEmail;
      const key = sa.private_key || sa.privateKey;
      if (pid && email && key) {
        return { sa: { projectId: pid, clientEmail: email, privateKey: cleanPrivateKey(String(key)) }, mode: 'json' };
      }
      return { sa: null, mode: 'none', error: 'FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id / client_email / private_key' };
    } catch {
      return { sa: null, mode: 'none', error: 'FIREBASE_SERVICE_ACCOUNT_JSON could not be read (paste the whole key file, or its base64)' };
    }
  }

  // Some of the three variables present but not all — tell the owner which one is missing.
  const present = [projectId, clientEmail, privateKey].filter(Boolean).length;
  if (present > 0 && present < 3) {
    const missing = [
      !projectId && 'FIREBASE_PROJECT_ID',
      !clientEmail && 'FIREBASE_CLIENT_EMAIL',
      !privateKey && 'FIREBASE_PRIVATE_KEY',
    ].filter(Boolean).join(', ');
    return { sa: null, mode: 'none', error: `Firebase service-account variable(s) missing: ${missing}` };
  }
  return { sa: null, mode: 'none' };
}

function hasApplicationDefaultCredentials(): boolean {
  return !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.KUBERNETES_SERVICE_HOST);
}

/** True when the owner has put Firebase admin credentials in place (does not connect). */
export function isAdminConfigured(): boolean {
  if (!IS_SERVER) return false;
  return !!readServiceAccount().sa || hasApplicationDefaultCredentials();
}

export function resolveProjectId(): string | undefined {
  return process.env.FIREBASE_PROJECT_ID?.trim()
    || readServiceAccount().sa?.projectId
    || process.env.GOOGLE_CLOUD_PROJECT
    || readAppletConfig().projectId
    || undefined;
}

/** The Firestore database the storefront (browser) uses — the server MUST use the same one. */
export function resolveDatabaseId(): string {
  return process.env.FIRESTORE_DATABASE_ID?.trim()
    || readAppletConfig().firestoreDatabaseId
    || '(default)';
}

// ── Connecting ─────────────────────────────────────────────────────────────────────

export async function getAdminApp(): Promise<any | null> {
  if (!IS_SERVER) return null;
  if (_app) return _app;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const appMod: any = await import('firebase-admin/app');
      const existing = (appMod.getApps?.() ?? []).find((a: any) => a?.name === APP_NAME);
      if (existing) { _app = existing; return _app; }

      const read = readServiceAccount();
      const sa = read.sa;
      const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || readAppletConfig().storageBucket || undefined;

      if (sa) {
        _credentialMode = read.mode;
        _app = appMod.initializeApp({
          credential: appMod.cert({ projectId: sa.projectId, clientEmail: sa.clientEmail, privateKey: sa.privateKey }),
          projectId: sa.projectId,
          storageBucket,
        }, APP_NAME);
        _lastError = null;
        console.log(`[AdminSDK] ✅ Connected to Firebase project "${sa.projectId}" (${_credentialMode})`);
        return _app;
      }

      if (hasApplicationDefaultCredentials()) {
        _credentialMode = 'adc';
        _app = appMod.initializeApp({
          credential: appMod.applicationDefault(),
          projectId: resolveProjectId(),
          storageBucket,
        }, APP_NAME);
        _lastError = null;
        console.log('[AdminSDK] ✅ Connected via Application Default Credentials');
        return _app;
      }

      _credentialMode = 'none';
      _lastError = read.error || 'No Firebase service-account credentials found';
      console.warn('[AdminSDK] ⚠️  No Firebase service-account credentials — secure checkout, server-side login and push are OFF.');
      console.warn('[AdminSDK]    Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in Railway → Variables.');
      return null;
    } catch (err) {
      _lastError = err instanceof Error ? err.message : String(err);
      console.error('[AdminSDK] ❌ Init failed:', _lastError);
      return null;
    } finally {
      // Allow a later retry (e.g. owner fixed the variables and the app re-checks) but keep
      // concurrent callers on one attempt while it is running.
      if (!_app) setTimeout(() => { _initPromise = null; }, 30_000).unref?.();
    }
  })();

  return _initPromise;
}

export async function getAdminAuth(): Promise<any | null> {
  if (_auth) return _auth;
  const app = await getAdminApp();
  if (!app) return null;
  const { getAuth }: any = await import('firebase-admin/auth');
  _auth = getAuth(app);
  return _auth;
}

export async function getAdminMessaging(): Promise<any | null> {
  if (_messaging) return _messaging;
  const app = await getAdminApp();
  if (!app) return null;
  const { getMessaging }: any = await import('firebase-admin/messaging');
  _messaging = getMessaging(app);
  return _messaging;
}

/**
 * The Firestore database used by the whole business (orders, products, users ...).
 * Returns null when Firebase admin credentials are not configured.
 */
export async function getAdminFirestore(): Promise<any | null> {
  if (_firestore) return _firestore;
  const app = await getAdminApp();
  if (!app) return null;
  const { getFirestore }: any = await import('firebase-admin/firestore');
  const databaseId = resolveDatabaseId();
  const db = databaseId && databaseId !== '(default)' ? getFirestore(app, databaseId) : getFirestore(app);
  try {
    // A field that is `undefined` should simply be skipped instead of failing the whole write.
    db.settings({ ignoreUndefinedProperties: true });
  } catch { /* settings() can only be called once — already applied */ }
  _firestore = db;
  return _firestore;
}

/** FieldValue (serverTimestamp / increment / arrayUnion ...) and Timestamp helpers. */
export async function getFirestoreHelpers(): Promise<{ FieldValue: any; Timestamp: any }> {
  const mod: any = await import('firebase-admin/firestore');
  return { FieldValue: mod.FieldValue, Timestamp: mod.Timestamp };
}

// ── Convenience wrappers ───────────────────────────────────────────────────────────

/** Verify a Firebase ID token from the browser. Returns the decoded token, or null if it is invalid. */
export async function verifyIdToken(idToken: string): Promise<Record<string, unknown> | null> {
  try {
    const auth = await getAdminAuth();
    if (!auth) return null;
    return await auth.verifyIdToken(idToken) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Plain-language status for the owner's setup/health screen. Never contains secret values. */
export function getAdminStatus(): {
  configured: boolean;
  connected: boolean;
  projectId?: string;
  databaseId: string;
  credential: 'env' | 'json' | 'adc' | 'none';
  problem?: string;
} {
  const read = readServiceAccount();
  const configured = !!read.sa || hasApplicationDefaultCredentials();
  const credential: 'env' | 'json' | 'adc' | 'none' = read.sa ? read.mode as 'env' | 'json' : hasApplicationDefaultCredentials() ? 'adc' : 'none';
  let problem: string | undefined;
  if (!configured) problem = read.error ?? 'Firebase service-account variables are not set';
  else if (!_app) problem = _lastError ?? undefined;
  return {
    configured,
    connected: !!_app,
    projectId: resolveProjectId(),
    databaseId: resolveDatabaseId(),
    credential,
    problem,
  };
}
