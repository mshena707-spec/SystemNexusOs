/**
 * OWNER AI CONTROL CENTER — Phase Q
 *
 * Tab 1 — Natural Language Builder: owner types a plain-English command,
 *          AI parses it into a structured preview, owner confirms → rule saved.
 * Tab 2 — Automation Rules: list of IF→THEN rules, Run Now, dry-run preview,
 *          toggle active/inactive, delete.
 * Tab 3 — Coupon Manager: create and list coupons.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Wand2, Zap, Tag, Play, Trash2, ToggleLeft, ToggleRight,
  CheckCircle, AlertCircle, Eye, Loader2, RefreshCw, Plus,
} from 'lucide-react';

function adminHeaders(): Record<string, string> {
  const token = localStorage.getItem('owner_secret') || localStorage.getItem('admin_token') || '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ParsedCommand {
  understood: boolean;
  ruleName?: string;
  conditionType?: string;
  conditionParams?: Record<string, any>;
  actionType?: string;
  actionParams?: Record<string, any>;
  explanation: string;
  rawCommand: string;
}

interface RunResult { matched: number; actioned: boolean; summary: string; error?: string; }

interface AutomationRule {
  id: string;
  name: string;
  conditionType: string;
  conditionParams: Record<string, any>;
  actionType: string;
  actionParams: Record<string, any>;
  active: boolean;
  source: string;
  originalCommand?: string;
  createdAt: string;
  lastRunAt?: string;
  lastRunResult?: RunResult;
}

interface Coupon {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  reason: string;
  active: boolean;
  redemptionCount: number;
  maxRedemptions: number;
  expiresAt: string | null;
  source: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COND_LABELS: Record<string, string> = {
  customer_inactive: '👤 Customer Inactive',
  low_stock: '📦 Low Stock',
  rider_performance_low: '🏍️ Rider Performance Low',
};
const ACTION_LABELS: Record<string, string> = {
  issue_coupon: '🎟️ Issue Coupon',
  alert_admin: '🔔 Alert Admin',
  notify_supplier: '📤 Notify Supplier',
};

function condSummary(condType: string, p: Record<string, any>): string {
  if (condType === 'customer_inactive') return `Inactive ≥ ${p.minDaysInactive ?? 30} days`;
  if (condType === 'low_stock') return `Stock ≤ ${p.maxDaysOfStockRemaining ?? 3} days remaining`;
  if (condType === 'rider_performance_low') return `Score ≤ ${p.maxPerformanceScore ?? 50}`;
  return JSON.stringify(p);
}

function actSummary(actionType: string, p: Record<string, any>): string {
  if (actionType === 'issue_coupon') return `${p.discountValue}${p.discountType === 'percent' ? '%' : ' fixed'} off, expires ${p.expiresInDays ?? 14}d`;
  if (actionType === 'alert_admin') return 'Alert admin';
  if (actionType === 'notify_supplier') return 'Notify supplier(s)';
  return JSON.stringify(p);
}

// ─── Tab 1 — NL Builder ───────────────────────────────────────────────────────
const NLBuilder: React.FC<{ onRuleCreated: () => void }> = ({ onRuleCreated }) => {
  const [command, setCommand] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedCommand | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');

  const EXAMPLES = [
    'Give 10% discount to customers inactive for 30 days',
    'Alert me when any product has less than 3 days of stock',
    'Notify supplier when stock is critically low',
    'Send 15% off coupon to customers inactive for 60 days',
    'Alert admin when rider performance score is below 40',
  ];

  const handleParse = async () => {
    if (!command.trim()) return;
    setParsing(true); setParsed(null); setError(''); setSavedMsg('');
    try {
      const res = await fetch('/api/admin/owner-ai/parse', {
        method: 'POST', headers: adminHeaders(),
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setParsed(data);
    } catch (e: any) { setError(e.message); } finally { setParsing(false); }
  };

  const handleCreate = async () => {
    if (!parsed?.understood) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/admin/automation-rules', {
        method: 'POST', headers: adminHeaders(),
        body: JSON.stringify({
          name: parsed.ruleName,
          conditionType: parsed.conditionType,
          conditionParams: parsed.conditionParams,
          actionType: parsed.actionType,
          actionParams: parsed.actionParams,
          source: 'nl_command',
          originalCommand: parsed.rawCommand,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedMsg(`✅ Rule created successfully (ID: ${data.id})`);
      setParsed(null); setCommand('');
      onRuleCreated();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-xs font-bold text-nexus-text-muted uppercase tracking-wider mb-1">Natural Language Command</label>
        <textarea
          value={command}
          onChange={e => setCommand(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
          rows={3}
          placeholder="e.g. Give 10% discount to customers inactive for 30 days"
        />
        <div className="flex flex-wrap gap-2 mt-1">
          {EXAMPLES.map((ex, i) => (
            <button key={i} onClick={() => setCommand(ex)}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-nexus-text-faint rounded px-2 py-1 transition-colors">
              {ex.length > 48 ? ex.slice(0, 48) + '…' : ex}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleParse}
        disabled={!command.trim() || parsing}
        className="flex items-center gap-2 bg-blue-600 text-nexus-text rounded-lg px-5 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
      >
        {parsing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
        {parsing ? 'Parsing…' : 'Parse Command'}
      </button>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {parsed && !parsed.understood && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          <strong>Couldn't understand: </strong>{parsed.explanation}
          <p className="mt-1 text-xs text-yellow-600">Try rephrasing. Supported: discount for inactive customers, alert for low stock, notify supplier for low stock, alert for low rider performance.</p>
        </div>
      )}

      {parsed?.understood && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-bold text-green-800 flex items-center gap-2">
            <CheckCircle size={16} /> Preview — please confirm before saving
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-white rounded p-3 border border-green-100">
              <p className="text-xs text-nexus-text-muted font-bold uppercase mb-1">Rule Name</p>
              <p className="font-medium text-nexus-text-faint">{parsed.ruleName}</p>
            </div>
            <div className="bg-white rounded p-3 border border-green-100">
              <p className="text-xs text-nexus-text-muted font-bold uppercase mb-1">IF Condition</p>
              <p className="font-medium text-nexus-text-faint">{COND_LABELS[parsed.conditionType!] ?? parsed.conditionType}</p>
              <p className="text-xs text-nexus-text-muted mt-0.5">{condSummary(parsed.conditionType!, parsed.conditionParams ?? {})}</p>
            </div>
            <div className="bg-white rounded p-3 border border-green-100 col-span-2">
              <p className="text-xs text-nexus-text-muted font-bold uppercase mb-1">THEN Action</p>
              <p className="font-medium text-nexus-text-faint">{ACTION_LABELS[parsed.actionType!] ?? parsed.actionType}</p>
              <p className="text-xs text-nexus-text-muted mt-0.5">{actSummary(parsed.actionType!, parsed.actionParams ?? {})}</p>
            </div>
          </div>
          <p className="text-sm text-nexus-text-faint italic">"{parsed.explanation}"</p>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-2 bg-green-600 text-nexus-text rounded-lg px-5 py-2 text-sm font-semibold hover:bg-green-700 disabled:opacity-40 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              {saving ? 'Saving…' : 'Confirm & Create Rule'}
            </button>
            <button onClick={() => setParsed(null)} className="text-sm text-nexus-text-muted underline px-2">Cancel</button>
          </div>
          {savedMsg && <p className="text-sm text-green-700 font-semibold">{savedMsg}</p>}
        </div>
      )}
    </div>
  );
};

// ─── Tab 2 — Rule Manager ─────────────────────────────────────────────────────
const RuleManager: React.FC<{ refresh: number }> = ({ refresh }) => {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [runResults, setRunResults] = useState<Record<string, RunResult>>({});
  const [previewResults, setPreviewResults] = useState<Record<string, { matched: number; targets: any[] }>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/automation-rules', { headers: adminHeaders() });
      const data = await res.json();
      setRules(data.rules ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  const toggle = async (rule: AutomationRule) => {
    await fetch(`/api/admin/automation-rules/${rule.id}/toggle`, {
      method: 'PATCH', headers: adminHeaders(),
      body: JSON.stringify({ active: !rule.active }),
    });
    load();
  };

  const del = async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    await fetch(`/api/admin/automation-rules/${id}`, { method: 'DELETE', headers: adminHeaders() });
    load();
  };

  const runNow = async (id: string) => {
    setRunning(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/admin/automation-rules/${id}/run`, { method: 'POST', headers: adminHeaders() });
      const data = await res.json();
      setRunResults(prev => ({ ...prev, [id]: data }));
    } finally {
      setRunning(prev => { const s = new Set(prev); s.delete(id); return s; });
      load();
    }
  };

  const preview = async (id: string) => {
    setPreviewing(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/admin/automation-rules/${id}/preview`, { method: 'POST', headers: adminHeaders() });
      const data = await res.json();
      setPreviewResults(prev => ({ ...prev, [id]: data }));
    } finally {
      setPreviewing(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  if (loading) return <div className="p-6 text-sm text-nexus-text-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading rules…</div>;
  if (!rules.length) return (
    <div className="p-6 text-center text-nexus-text-muted text-sm">
      <Zap size={36} className="mx-auto mb-2 opacity-30" />
      <p>No rules yet. Use the Natural Language Builder above to create your first rule.</p>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center mb-2">
        <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider">{rules.length} rule(s)</p>
        <button onClick={load} className="text-xs text-blue-500 flex items-center gap-1 hover:underline"><RefreshCw size={12} /> Refresh</button>
      </div>
      {rules.map(rule => (
        <div key={rule.id} className="border rounded-lg bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${rule.active ? 'bg-green-400' : 'bg-gray-300'}`} />
              <span className="font-semibold text-sm text-nexus-text-faint truncate">{rule.name}</span>
              {rule.source === 'nl_command' && <span className="text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 shrink-0">NL</span>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => toggle(rule)} title={rule.active ? 'Deactivate' : 'Activate'}
                className={`p-1 rounded transition-colors ${rule.active ? 'text-green-600 hover:text-green-800' : 'text-nexus-text-muted hover:text-nexus-text-faint'}`}>
                {rule.active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              </button>
              <button onClick={() => preview(rule.id)} disabled={previewing.has(rule.id)}
                className="p-1 text-blue-500 hover:text-blue-700 disabled:opacity-40" title="Dry-run preview (no action)">
                {previewing.has(rule.id) ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
              </button>
              <button onClick={() => runNow(rule.id)} disabled={running.has(rule.id)}
                className="p-1 text-emerald-600 hover:text-emerald-800 disabled:opacity-40" title="Run now">
                {running.has(rule.id) ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              </button>
              <button onClick={() => del(rule.id)} className="p-1 text-red-400 hover:text-red-600" title="Delete">
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="px-4 py-3 grid grid-cols-2 gap-2 text-xs text-nexus-text-faint">
            <div>
              <span className="font-bold text-nexus-text-muted uppercase tracking-wider text-[10px]">IF</span>
              <p className="mt-0.5 font-medium">{COND_LABELS[rule.conditionType] ?? rule.conditionType}</p>
              <p className="text-nexus-text-muted">{condSummary(rule.conditionType, rule.conditionParams)}</p>
            </div>
            <div>
              <span className="font-bold text-nexus-text-muted uppercase tracking-wider text-[10px]">THEN</span>
              <p className="mt-0.5 font-medium">{ACTION_LABELS[rule.actionType] ?? rule.actionType}</p>
              <p className="text-nexus-text-muted">{actSummary(rule.actionType, rule.actionParams)}</p>
            </div>
          </div>

          {rule.originalCommand && (
            <div className="px-4 pb-2">
              <p className="text-xs text-nexus-text-muted italic">"{rule.originalCommand}"</p>
            </div>
          )}

          {rule.lastRunAt && rule.lastRunResult && (
            <div className={`px-4 py-2 text-xs border-t ${rule.lastRunResult.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              <span className="font-bold">Last run:</span> {new Date(rule.lastRunAt).toLocaleString()} — {rule.lastRunResult.summary}
            </div>
          )}

          {previewResults[rule.id] !== undefined && (
            <div className="px-4 py-2 bg-blue-50 border-t text-xs text-blue-800">
              <span className="font-bold">Preview (no action taken):</span> {previewResults[rule.id].matched} target(s) would match.
              {previewResults[rule.id].targets.slice(0, 5).map((t: any, i: number) => (
                <span key={i} className="ml-1 bg-blue-100 rounded px-1">{t.label}</span>
              ))}
              {previewResults[rule.id].matched > 5 && <span className="ml-1 text-blue-500">…+{previewResults[rule.id].matched - 5} more</span>}
            </div>
          )}

          {runResults[rule.id] && (
            <div className={`px-4 py-2 border-t text-xs font-medium ${runResults[rule.id].error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
              {runResults[rule.id].summary}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ─── Tab 3 — Coupon Manager ───────────────────────────────────────────────────
const CouponManager: React.FC = () => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ type: 'percent', value: '10', reason: '', expiresInDays: '14' });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/coupons', { headers: adminHeaders() });
    const data = await res.json();
    setCoupons(data.coupons ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCoupon = async () => {
    setCreating(true); setMsg('');
    try {
      const res = await fetch('/api/admin/coupons', {
        method: 'POST', headers: adminHeaders(),
        body: JSON.stringify({
          type: form.type,
          value: Number(form.value),
          reason: form.reason,
          expiresInDays: Number(form.expiresInDays),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg(`✅ Created ${data.coupon.code}`);
      setForm({ type: 'percent', value: '10', reason: '', expiresInDays: '14' });
      load();
    } catch (e: any) { setMsg(`❌ ${e.message}`); } finally { setCreating(false); }
  };

  const deactivate = async (id: string, code: string) => {
    if (!confirm(`Deactivate coupon ${code}?`)) return;
    await fetch(`/api/admin/coupons/${id}`, { method: 'DELETE', headers: adminHeaders() });
    load();
  };

  return (
    <div className="p-4 space-y-4">
      {/* Create form */}
      <div className="bg-gray-50 rounded-lg border p-4 space-y-3">
        <p className="text-xs font-bold text-nexus-text-muted uppercase tracking-wider">Create Manual Coupon</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-nexus-text-muted">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm">
              <option value="percent">Percent (%)</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-nexus-text-muted">Value</label>
            <input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm" min={1} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-nexus-text-muted">Reason / Description</label>
            <input type="text" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm" placeholder="e.g. Holiday promo" />
          </div>
          <div>
            <label className="text-xs text-nexus-text-muted">Expires in (days)</label>
            <input type="number" value={form.expiresInDays} onChange={e => setForm(f => ({ ...f, expiresInDays: e.target.value }))}
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm" min={1} />
          </div>
        </div>
        <button onClick={createCoupon} disabled={!form.reason || creating}
          className="flex items-center gap-2 bg-blue-600 text-nexus-text rounded px-4 py-1.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Create Coupon
        </button>
        {msg && <p className="text-sm font-medium">{msg}</p>}
      </div>

      {/* List */}
      {loading
        ? <div className="text-sm text-nexus-text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        : coupons.length === 0
          ? <p className="text-sm text-nexus-text-muted text-center py-4">No coupons yet.</p>
          : (
            <div className="space-y-2">
              {coupons.map(c => (
                <div key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${c.active ? 'bg-white' : 'bg-gray-50 opacity-60'}`}>
                  <Tag size={16} className={c.active ? 'text-blue-500' : 'text-nexus-text-muted'} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-nexus-text-faint font-mono">{c.code}</p>
                    <p className="text-xs text-nexus-text-muted">
                      {c.type === 'percent' ? `${c.value}% off` : `${c.value} fixed`} — {c.reason}
                    </p>
                    <p className="text-xs text-nexus-text-muted">
                      {c.redemptionCount}/{c.maxRedemptions} redeemed
                      {c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString()}` : ' · no expiry'}
                      {' · '}{c.source}
                    </p>
                  </div>
                  {c.active && (
                    <button onClick={() => deactivate(c.id, c.code)} className="text-red-400 hover:text-red-600 p-1" title="Deactivate">
                      <Trash2 size={15} />
                    </button>
                  )}
                  {!c.active && <span className="text-xs text-nexus-text-muted px-1">Inactive</span>}
                </div>
              ))}
            </div>
          )
      }
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
export const OwnerAIControlApp: React.FC = () => {
  const [tab, setTab] = useState<'nl' | 'rules' | 'coupons'>('nl');
  const [ruleRefresh, setRuleRefresh] = useState(0);

  const tabs = [
    { id: 'nl' as const, label: '🧠 NL Builder', icon: Wand2 },
    { id: 'rules' as const, label: '⚡ Automation Rules', icon: Zap },
    { id: 'coupons' as const, label: '🎟️ Coupons', icon: Tag },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-purple-700 text-nexus-text px-5 py-4 shrink-0">
        <h2 className="text-base font-bold">Owner AI Control Center</h2>
        <p className="text-xs text-blue-200 mt-0.5">Create rules in plain language — no developer needed</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-nexus-text-muted hover:text-nexus-text-faint'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'nl' && <NLBuilder onRuleCreated={() => { setTab('rules'); setRuleRefresh(r => r + 1); }} />}
        {tab === 'rules' && <RuleManager refresh={ruleRefresh} />}
        {tab === 'coupons' && <CouponManager />}
      </div>
    </div>
  );
};
