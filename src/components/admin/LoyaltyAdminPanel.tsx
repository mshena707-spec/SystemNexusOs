/**
 * LOYALTY ADMIN PANEL — Phase V
 * Admin UI for LoyaltyEngine (Phase R) + AbandonedCartRecoveryEngine log.
 */
import React, { useState, useCallback } from 'react';
import { Gift, Search, Loader2, RefreshCw, Plus, ShoppingCart } from 'lucide-react';

function adminH(): Record<string, string> {
  const t = localStorage.getItem('owner_secret') || localStorage.getItem('admin_token') || '';
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
}

const TIER_COLORS: Record<string, string> = {
  bronze: 'bg-amber-100 text-amber-800',
  silver: 'bg-gray-100 text-nexus-text-faint',
  gold: 'bg-yellow-100 text-yellow-800',
  platinum: 'bg-purple-100 text-purple-800',
};

// ── Tab 1: Customer Lookup ────────────────────────────────────────────────────
const CustomerLookup: React.FC = () => {
  const [uid, setUid] = useState('');
  const [balance, setBalance] = useState<any>(null);
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bonusForm, setBonusForm] = useState({ points: '', note: '' });
  const [awarding, setAwarding] = useState(false);
  const [awardMsg, setAwardMsg] = useState('');

  const lookup = async () => {
    if (!uid.trim()) return;
    setLoading(true); setError(''); setBalance(null); setTxns([]); setAwardMsg('');
    try {
      const [balRes, txnRes] = await Promise.all([
        fetch(`/api/loyalty/${uid}`, { headers: adminH() }),
        fetch(`/api/loyalty/${uid}/transactions?limit=20`, { headers: adminH() }),
      ]);
      if (!balRes.ok) throw new Error('Customer not found or no loyalty data');
      const balData = await balRes.json();
      const txnData = await txnRes.json();
      setBalance(balData);
      setTxns(txnData.transactions ?? []);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const awardBonus = async () => {
    if (!uid || !bonusForm.points || !bonusForm.note) return;
    setAwarding(true);
    try {
      const res = await fetch('/api/admin/loyalty/award-bonus', {
        method: 'POST', headers: adminH(),
        body: JSON.stringify({ customerId: uid, points: Number(bonusForm.points), type: 'admin_adjust', referenceId: 'admin_panel', note: bonusForm.note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAwardMsg(`✅ Awarded ${bonusForm.points} points`);
      setBonusForm({ points: '', note: '' });
      lookup();
    } catch (e: any) { setAwardMsg(`❌ ${e.message}`); } finally { setAwarding(false); }
  };

  const txTypeLabel: Record<string, string> = {
    earn_order: '🛍️ Order', earn_referral: '🔗 Referral', earn_bonus: '🎁 Bonus',
    admin_adjust: '⚙️ Admin', redeem_order: '💳 Redeemed', expire: '⌛ Expired',
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <input value={uid} onChange={e => setUid(e.target.value)} placeholder="Customer UID"
          className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
          onKeyDown={e => e.key === 'Enter' && lookup()} />
        <button onClick={lookup} disabled={!uid.trim() || loading}
          className="flex items-center gap-2 bg-yellow-600 text-nexus-text rounded-lg px-4 py-2 text-sm font-semibold hover:bg-yellow-700 disabled:opacity-40">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Lookup
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {balance && (
        <div className="space-y-3">
          {/* Balance card */}
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-yellow-700">{balance.currentPoints.toLocaleString()} pts</p>
                <p className="text-xs text-nexus-text-muted">Lifetime earned: {balance.lifetimeEarned.toLocaleString()} pts</p>
              </div>
              <span className={`text-sm font-bold rounded-full px-3 py-1 capitalize ${TIER_COLORS[balance.tier] ?? 'bg-gray-100 text-nexus-text-faint'}`}>
                {balance.tier}
              </span>
            </div>
            {balance.nextTier && (
              <p className="text-xs text-nexus-text-muted mt-2">
                {balance.pointsToNextTier.toLocaleString()} pts to <strong className="capitalize">{balance.nextTier}</strong>
              </p>
            )}
          </div>

          {/* Manual bonus */}
          <div className="bg-gray-50 rounded-xl border p-4 space-y-2">
            <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider">Award Manual Bonus</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={bonusForm.points} onChange={e => setBonusForm(f => ({ ...f, points: e.target.value }))}
                placeholder="Points" className="border rounded px-3 py-1.5 text-sm" />
              <input value={bonusForm.note} onChange={e => setBonusForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Reason / note" className="border rounded px-3 py-1.5 text-sm" />
            </div>
            <button onClick={awardBonus} disabled={!bonusForm.points || !bonusForm.note || awarding}
              className="flex items-center gap-2 bg-green-700 text-nexus-text rounded px-4 py-1.5 text-sm font-semibold hover:bg-green-800 disabled:opacity-40">
              {awarding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Award Points
            </button>
            {awardMsg && <p className="text-xs font-medium">{awardMsg}</p>}
          </div>

          {/* Transaction history */}
          <div>
            <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider mb-2">Recent Transactions</p>
            {txns.length === 0 && <p className="text-xs text-nexus-text-muted">No transactions yet.</p>}
            {txns.map((t, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0 text-sm">
                <span className="text-xs">{txTypeLabel[t.type] ?? t.type}</span>
                <span className={`font-bold ml-auto ${t.points > 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {t.points > 0 ? '+' : ''}{t.points}
                </span>
                <span className="text-xs text-nexus-text-muted w-28 text-right">{new Date(t.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Tab 2: Cart Recovery Log ──────────────────────────────────────────────────
const CartRecoveryLog: React.FC = () => {
  const [log, setLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/cart-recovery-log', { headers: adminH() });
      const data = await res.json();
      setLog(data.log ?? []);
    } finally { setLoading(false); }
  }, []);

  const ACTION_LABEL: Record<string, string> = {
    coupon_issued: '🎟️ Coupon issued',
    loyalty_bonus: '🎁 Loyalty bonus',
    notification_only: '🔔 Notified only',
    skipped: '⏭️ Skipped',
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider">Abandoned Cart Recovery Log</p>
        <button onClick={load} className="text-xs text-blue-500 flex items-center gap-1 hover:underline">
          <RefreshCw size={12} /> Load
        </button>
      </div>
      {loading && <div className="text-nexus-text-muted text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Loading…</div>}
      {!loading && log.length === 0 && (
        <div className="text-center py-10 text-nexus-text-muted">
          <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No recovery attempts yet. Click Load to refresh.</p>
        </div>
      )}
      {log.map((entry, i) => (
        <div key={i} className="bg-white rounded-xl border p-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-nexus-text-muted">{ACTION_LABEL[entry.action] ?? entry.action}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${entry.notificationSent ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-nexus-text-muted'}`}>
              {entry.notificationSent ? 'Notified' : 'Notification failed'}
            </span>
          </div>
          <p className="text-xs text-nexus-text-muted">Customer: <code className="bg-gray-100 px-1 rounded">{entry.customerId}</code></p>
          {entry.couponCode && <p className="text-xs text-blue-600">Coupon: <strong>{entry.couponCode}</strong></p>}
          {entry.loyaltyPointsAwarded && <p className="text-xs text-green-600">+{entry.loyaltyPointsAwarded} loyalty pts</p>}
          <p className="text-xs text-nexus-text-muted">{new Date(entry.recoveredAt).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const LoyaltyAdminPanel: React.FC = () => {
  const [tab, setTab] = useState<'lookup' | 'recovery'>('lookup');
  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-gradient-to-r from-yellow-600 to-amber-600 text-nexus-text px-5 py-4 shrink-0">
        <h2 className="text-base font-bold flex items-center gap-2"><Gift size={16} /> Loyalty Admin</h2>
        <p className="text-xs text-yellow-100 mt-0.5">Customer points, tiers, bonuses, cart recovery</p>
      </div>
      <div className="flex border-b bg-white shrink-0">
        {([['lookup', '🎖️ Customer Lookup'], ['recovery', '🛒 Cart Recovery']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === id ? 'border-yellow-600 text-yellow-700' : 'border-transparent text-nexus-text-muted hover:text-nexus-text-faint'
            }`}>{label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'lookup' && <CustomerLookup />}
        {tab === 'recovery' && <CartRecoveryLog />}
      </div>
    </div>
  );
};
