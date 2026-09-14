import React, { useState, useEffect } from 'react';

/**
 * AdminSecretGate
 *
 * FIX for a confirmed, system-wide gap: every admin panel (FinancialOSApp,
 * PaymentOSApp, NerveCenterApp, DeveloperAPIHubApp, and ~15 others) reads
 * `window.__NEXUS_ADMIN_SECRET__` and sends it as `Authorization: Bearer
 * <value>` on every API call — but nothing anywhere in the codebase ever
 * SET that variable. Every admin API call was going out with an empty
 * token, which `requireAdminAuth` (src/api/middleware/AuthMiddleware.ts)
 * correctly rejects with 401. Net effect: no admin panel could ever
 * successfully load or save data, regardless of how correct its own code
 * was.
 *
 * This wraps /ceo and /admin (see App.tsx) with a one-time entry screen
 * for the OWNER_SECRET value (the same value set as OWNER_SECRET in the
 * server's environment — see OWNER_CHECKLIST). It stores it in
 * localStorage, sets window.__NEXUS_ADMIN_SECRET__ so every existing
 * panel picks it up unchanged, and does a real round-trip against a live
 * admin endpoint before accepting it, so a mistyped key fails immediately
 * with a clear message instead of leaving every panel silently broken.
 *
 * Longer-term: OWNER_SECRET is a long-lived shared bearer secret, which
 * the technical audit already flags as something to move off of in favor
 * of per-admin accounts with real, expiring sessions. This gate makes the
 * *existing* architecture actually work; it isn't a replacement for that
 * migration.
 */

const STORAGE_KEY = 'nexus_admin_secret';

declare global {
  interface Window {
    __NEXUS_ADMIN_SECRET__?: string;
  }
}

async function verifySecret(secret: string): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/system/capacity', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    return res.status !== 401;
  } catch {
    // Network/server error shouldn't block entry — the real check happens
    // on every subsequent call anyway. Only a confirmed 401 is rejected here.
    return true;
  }
}

export const AdminSecretGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      window.__NEXUS_ADMIN_SECRET__ = saved;
      setUnlocked(true);
    }
    setReady(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setError('');

    const ok = await verifySecret(trimmed);
    if (!ok) {
      setChecking(false);
      setError('That key was rejected by the server. Double-check OWNER_SECRET in your environment and try again.');
      return;
    }

    localStorage.setItem(STORAGE_KEY, trimmed);
    window.__NEXUS_ADMIN_SECRET__ = trimmed;
    setUnlocked(true);
    setChecking(false);
  };

  const handleSignOut = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.__NEXUS_ADMIN_SECRET__ = undefined;
    setUnlocked(false);
    setInput('');
  };

  if (!ready) return null;

  if (!unlocked) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a', fontFamily: 'system-ui, sans-serif', padding: 16,
      }}>
        <form onSubmit={handleSubmit} style={{
          background: '#1e293b', padding: 32, borderRadius: 16, width: '100%', maxWidth: 380,
          border: '1px solid #334155',
        }}>
          <h1 style={{ color: '#f1f5f9', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Admin Access</h1>
          <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
            Enter your OWNER_SECRET key to unlock the admin dashboard.
          </p>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Admin access key"
            autoFocus
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #334155',
              background: '#0f172a', color: '#f1f5f9', fontSize: 14, marginBottom: 12, boxSizing: 'border-box',
            }}
          />
          {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button
            type="submit"
            disabled={checking || !input.trim()}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none',
              background: checking || !input.trim() ? '#475569' : '#3b82f6', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: checking || !input.trim() ? 'default' : 'pointer',
            }}
          >
            {checking ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {children}
      <button
        onClick={handleSignOut}
        title="Clear admin key"
        style={{
          position: 'fixed', bottom: 12, right: 12, zIndex: 9999, fontSize: 11,
          padding: '4px 10px', borderRadius: 999, border: '1px solid #334155',
          background: '#1e293b', color: '#94a3b8', cursor: 'pointer', opacity: 0.6,
        }}
      >
        Sign out
      </button>
    </>
  );
};

export default AdminSecretGate;
