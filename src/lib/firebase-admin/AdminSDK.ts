/**
 * AdminSDK.ts — Firebase Admin SDK singleton.
 * ALL server-side firebase-admin usage must import from here.
 * Prevents duplicate App errors and centralizes credential management.
 */

const IS_SERVER = typeof window === 'undefined';

let _app: any = null;
let _auth: any = null;
let _messaging: any = null;
let _initialized = false;

export async function getAdminApp(): Promise<any | null> {
  if (!IS_SERVER) return null;
  if (_app)         return _app;
  if (_initialized) return null;
  _initialized = true;

  try {
    const admin = await import('firebase-admin');

    // Avoid duplicate app in hot-reload environments
    if (admin.apps?.length > 0) {
      _app = admin.apps[0];
      return _app;
    }

    const projectId   = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    // Option A: individual env vars (recommended)
    if (projectId && clientEmail && privateKey) {
      _app = admin.initializeApp({
        credential:    admin.credential.cert({ projectId, clientEmail, privateKey }),
        projectId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      }, 'nexus-admin');
      console.log('[AdminSDK] ✅ Initialized via env credentials');
      return _app;
    }

    // Option B: base64-encoded full service account JSON
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (saJson) {
      const sa = JSON.parse(Buffer.from(saJson, 'base64').toString('utf-8'));
      _app = admin.initializeApp({
        credential:    admin.credential.cert(sa),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      }, 'nexus-admin');
      console.log('[AdminSDK] ✅ Initialized via base64 service account');
      return _app;
    }

    // Option C: Google Application Default Credentials (Cloud Run / GKE)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.KUBERNETES_SERVICE_HOST) {
      _app = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId:  projectId ?? process.env.GOOGLE_CLOUD_PROJECT,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      }, 'nexus-admin');
      console.log('[AdminSDK] ✅ Initialized via Application Default Credentials');
      return _app;
    }

    console.warn('[AdminSDK] ⚠️  No credentials found — auth verification and FCM unavailable.');
    console.warn('[AdminSDK]    Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY');
    return null;
  } catch (err) {
    console.error('[AdminSDK] ❌ Init failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function getAdminAuth(): Promise<any | null> {
  if (_auth) return _auth;
  const app = await getAdminApp();
  if (!app)  return null;
  const admin = await import('firebase-admin');
  _auth = admin.auth(app);
  return _auth;
}

export async function getAdminMessaging(): Promise<any | null> {
  if (_messaging) return _messaging;
  const app = await getAdminApp();
  if (!app)  return null;
  const admin = await import('firebase-admin');
  _messaging = admin.messaging(app);
  return _messaging;
}

/** Verify Firebase ID token — used by /api/auth/login */
export async function verifyIdToken(
  idToken: string,
): Promise<Record<string, unknown> | null> {
  try {
    const auth = await getAdminAuth();
    if (!auth) return null;
    return await auth.verifyIdToken(idToken) as Record<string, unknown>;
  } catch {
    return null;
  }
}
