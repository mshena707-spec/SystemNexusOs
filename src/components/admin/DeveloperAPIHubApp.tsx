import React, { useState, useEffect } from 'react';
import { Code, Webhook, Key, Copy, CheckCircle2, Plus, Trash2, RefreshCw, Globe, Server, Database, CheckSquare, ArrowRight, X, Loader2, AlertTriangle } from 'lucide-react';

const adminHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${(window as unknown as Record<string, unknown>).__NEXUS_ADMIN_SECRET__ as string ?? ''}`,
});

interface ApiKey { id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt?: string }
interface WebhookEndpoint { id: string; url: string; events: string[]; status: 'active' | 'disabled'; lastTestAt?: string; lastTestResult?: { ok: boolean; statusCode?: number; error?: string } }

export const DeveloperAPIHubApp = () => {
  const [activeTab, setActiveTab] = useState<'keys' | 'webhooks' | 'setup' | 'extensions'>('setup');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKeyReveal, setNewKeyReveal] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [showNewWebhookForm, setShowNewWebhookForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  // The actual URL this system is reachable at right now — not a hardcoded
  // guess. Every deployment (dev, staging, the owner's real domain) gets
  // its own correct webhook URLs automatically.
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const loadData = async () => {
    const [keysRes, hooksRes] = await Promise.allSettled([
      fetch('/api/admin/dev/api-keys', { headers: adminHeaders() }),
      fetch('/api/admin/dev/webhooks', { headers: adminHeaders() }),
    ]);
    if (keysRes.status === 'fulfilled' && keysRes.value.ok) setApiKeys(await keysRes.value.json());
    if (hooksRes.status === 'fulfilled' && hooksRes.value.ok) setWebhooks(await hooksRes.value.json());
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleGenerateKey = async () => {
    const res = await fetch('/api/admin/dev/api-keys', { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ name: newKeyName || 'Unnamed key' }) });
    if (res.ok) {
      const { rawKey, record } = await res.json();
      setNewKeyReveal(rawKey);
      setApiKeys((prev) => [record, ...prev]);
      setNewKeyName('');
      setShowNewKeyForm(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    await fetch(`/api/admin/dev/api-keys/${id}`, { method: 'DELETE', headers: adminHeaders() });
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const handleAddWebhook = async () => {
    if (!newWebhookUrl) return;
    const res = await fetch('/api/admin/dev/webhooks', { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ url: newWebhookUrl, events: ['order.created', 'payment.success'] }) });
    if (res.ok) {
      const created = await res.json();
      setWebhooks((prev) => [created, ...prev]);
      setNewWebhookUrl('');
      setShowNewWebhookForm(false);
    }
  };

  const handleRemoveWebhook = async (id: string) => {
    await fetch(`/api/admin/dev/webhooks/${id}`, { method: 'DELETE', headers: adminHeaders() });
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
  };

  const handleTestWebhook = async (id: string) => {
    setTestingId(id);
    const res = await fetch(`/api/admin/dev/webhooks/${id}/test`, { method: 'POST', headers: adminHeaders() });
    const result = await res.json();
    setWebhooks((prev) => prev.map((w) => w.id === id ? { ...w, lastTestAt: new Date().toISOString(), lastTestResult: result } : w));
    setTestingId(null);
  };

  const CopyField = ({ label, value, hint }: { label: string, value: string, hint?: string }) => (
    <div className="mb-4">
      <div className="flex justify-between items-end mb-1">
        <label className="text-sm font-medium text-nexus-text">{label}</label>
        {hint && <span className="text-xs text-nexus-info">{hint}</span>}
      </div>
      <div className="flex items-center gap-2">
        <div className="bg-nexus-surface-raised border border-nexus-border-strong rounded-lg px-4 py-2 flex-1 font-mono text-sm text-nexus-text-muted overflow-x-auto whitespace-nowrap">
          {value}
        </div>
        <button onClick={() => handleCopy(value)} className="bg-nexus-surface-raised hover:bg-nexus-surface border border-nexus-border-strong text-nexus-text p-2.5 rounded-lg transition-colors flex shrink-0" title="Copy">
          {copiedKey === value ? <CheckCircle2 size={18} className="text-nexus-success" /> : <Copy size={18} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-nexus-void text-nexus-text p-6 overflow-y-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-nexus-text flex items-center gap-2 mb-2">
          <Code className="text-nexus-primary" /> Developer & API Hub
        </h2>
        <p className="text-nexus-text-muted text-sm max-w-3xl">
          Central configuration center. Follow the setup guide to connect your AI models and payment gateways
          via environment variables. Manage real API keys and webhooks for programmatic access below.
        </p>
      </div>

      <div className="flex gap-4 border-b border-nexus-border mb-6 overflow-x-auto no-scrollbar">
        {([['setup', 'Connection Guide', CheckSquare], ['keys', 'API Keys', Key], ['webhooks', 'Webhooks', Webhook], ['extensions', 'Integrations', Globe]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setActiveTab(id)} className={`pb-3 px-4 text-sm font-medium transition-colors relative whitespace-nowrap ${activeTab === id ? 'text-nexus-primary' : 'text-nexus-text-muted hover:text-nexus-text'}`}>
            <div className="flex items-center gap-2"><Icon size={16} /> {label}</div>
            {activeTab === id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nexus-primary" />}
          </button>
        ))}
      </div>

      {activeTab === 'setup' && (
        <div className="space-y-8 max-w-4xl">
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
              <span className="bg-nexus-primary-muted text-nexus-primary p-1.5 rounded-lg"><Key size={20} /></span>
              Step 1: AI Engine Keys
            </h3>
            <p className="text-sm text-nexus-text-muted mb-6">
              Add these as environment variables in your deployment (.env or your host's secrets panel). This activates the hybrid local/cloud intelligent fallbacks.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <CopyField label="GEMINI_API_KEY" value="(set in your .env)" hint="For Deep Analytics/Vision" />
               <CopyField label="GROQ_API_KEY" value="(set in your .env)" hint="For Fast Routing/LLaMA" />
               <CopyField label="HUGGINGFACE_API_KEY" value="(set in your .env)" hint="For free-tier SLMs" />
               <CopyField label="OPENAI_API_KEY" value="(set in your .env)" hint="For legacy fallbacks" />
            </div>
            <div className="mt-4 p-3 bg-nexus-info/10 border border-nexus-info/20 rounded-lg text-sm text-nexus-info flex items-start gap-2">
               <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
               <p>If you don't add a key, the system gracefully falls back to offline keyword-based intents so the Omni-Channel keeps working without failures.</p>
            </div>
          </div>

          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
              <span className="bg-nexus-info/20 text-nexus-info p-1.5 rounded-lg"><Webhook size={20} /></span>
              Step 2: Social Media Webhooks Configuration
            </h3>
            <p className="text-sm text-nexus-text-muted mb-6">
              These URLs point at <strong>this</strong> deployment ({baseUrl || 'load in browser to see your real URL'}) — copy them into the respective Developer Portals (Meta, TikTok, etc.) to start receiving live messages.
            </p>
            <div className="space-y-6">
               <div className="bg-nexus-surface-raised p-4 rounded-xl border border-nexus-border-strong">
                 <div className="flex items-center gap-2 mb-3"><div className="w-2 h-2 bg-nexus-success rounded-full"></div><h4 className="font-bold text-nexus-text">WhatsApp & Instagram (Meta)</h4></div>
                 <CopyField label="Webhook Callback URL" value={`${baseUrl}/api/webhooks/meta`} />
                 <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-sm text-nexus-info hover:underline flex items-center gap-1 mt-2">Open Meta Developers Portal <ArrowRight size={14}/></a>
               </div>
               <div className="bg-nexus-surface-raised p-4 rounded-xl border border-nexus-border-strong">
                 <div className="flex items-center gap-2 mb-3"><div className="w-2 h-2 bg-nexus-info rounded-full"></div><h4 className="font-bold text-nexus-text">Facebook Messenger</h4></div>
                 <CopyField label="Webhook Callback URL" value={`${baseUrl}/api/webhooks/messenger`} />
               </div>
               <div className="bg-nexus-surface-raised p-4 rounded-xl border border-nexus-border-strong">
                 <div className="flex items-center gap-2 mb-3"><div className="w-2 h-2 bg-nexus-secondary rounded-full"></div><h4 className="font-bold text-nexus-text">TikTok & Others</h4></div>
                 <CopyField label="Global Inbound Webhook" value={`${baseUrl}/api/webhooks/global-inbound`} />
               </div>
            </div>
          </div>

          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
              <span className="bg-nexus-success/20 text-nexus-success p-1.5 rounded-lg"><Key size={20} /></span>
              Step 3: Payment Gateways
            </h3>
            <p className="text-sm text-nexus-text-muted mb-6">Set these as environment variables — the system automatically enables secure checkout when present.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <CopyField label="STRIPE_SECRET_KEY" value="(set in your .env)" hint="Global Cards (Stripe)" />
               <CopyField label="SSLCOMMERZ_STORE_ID" value="(set in your .env)" hint="BD Local Cards/MFS" />
            </div>
            <p className="text-xs text-nexus-text-muted mt-2">For manual bKash/Nagad/Rocket numbers (no gateway), set these under Settings ▸ Payment Numbers.</p>
          </div>

          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-6">
             <h3 className="text-lg font-bold text-nexus-text mb-2 flex items-center gap-2">
              <span className="bg-nexus-warning/20 text-nexus-warning p-1.5 rounded-lg"><Globe size={20} /></span>
              Step 4: Maps & Rider Fleet API
            </h3>
            <CopyField label="GOOGLE_MAPS_API_KEY" value="(set in your .env)" hint="Maps SDK & Distance Matrix" />
            <p className="text-xs text-nexus-text-muted mt-2">When this key is present, Fleet Manager automatically unlocks real-time GPS tracking and live routing for riders.</p>
          </div>
        </div>
      )}

      {activeTab === 'keys' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-nexus-text">Active API Keys</h3>
            <button onClick={() => setShowNewKeyForm(true)} className="bg-nexus-primary text-nexus-primary-text px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
              <Plus size={16} /> Generate New Key
            </button>
          </div>

          {showNewKeyForm && (
            <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 flex items-center gap-3">
              <input autoFocus value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Key name (e.g. Mobile App)" className="flex-1 bg-nexus-void border border-nexus-border-strong rounded-lg px-3 py-2 text-sm text-nexus-text" />
              <button onClick={handleGenerateKey} className="bg-nexus-primary text-nexus-primary-text px-4 py-2 rounded-lg text-sm font-medium">Create</button>
              <button onClick={() => setShowNewKeyForm(false)} className="text-nexus-text-muted p-2"><X size={16} /></button>
            </div>
          )}

          {newKeyReveal && (
            <div className="bg-nexus-warning/10 border border-nexus-warning/30 rounded-xl p-4">
              <div className="flex items-center gap-2 text-nexus-warning text-sm font-medium mb-2"><AlertTriangle size={16} /> Copy this now — it will never be shown again</div>
              <div className="flex items-center gap-2">
                <div className="bg-nexus-void border border-nexus-border-strong rounded-lg px-4 py-2 flex-1 font-mono text-sm text-nexus-text overflow-x-auto">{newKeyReveal}</div>
                <button onClick={() => handleCopy(newKeyReveal)} className="bg-nexus-surface-raised p-2.5 rounded-lg border border-nexus-border-strong">{copiedKey === newKeyReveal ? <CheckCircle2 size={18} className="text-nexus-success" /> : <Copy size={18} />}</button>
                <button onClick={() => setNewKeyReveal(null)} className="text-nexus-text-muted p-2"><X size={16} /></button>
              </div>
            </div>
          )}

          <div className="bg-nexus-surface border border-nexus-border rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-6 flex items-center gap-2 text-nexus-text-muted text-sm"><Loader2 size={16} className="animate-spin" /> Loading…</div>
            ) : apiKeys.length === 0 ? (
              <p className="p-6 text-sm text-nexus-text-faint">No API keys yet — generate one above.</p>
            ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-nexus-surface-raised border-b border-nexus-border text-nexus-text-muted">
                <tr><th className="p-4 font-medium">Name</th><th className="p-4 font-medium">Key</th><th className="p-4 font-medium">Created</th><th className="p-4 font-medium">Last Used</th><th className="p-4 font-medium text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-nexus-border">
                {apiKeys.map(key => (
                  <tr key={key.id} className="hover:bg-nexus-surface-raised transition-colors">
                    <td className="p-4 font-medium text-nexus-text">{key.name}</td>
                    <td className="p-4"><span className="font-mono text-nexus-text-muted bg-nexus-void px-3 py-1.5 rounded border border-nexus-border-strong">{key.keyPrefix}••••••••••••</span></td>
                    <td className="p-4 text-nexus-text-muted">{new Date(key.createdAt).toLocaleDateString()}</td>
                    <td className="p-4 text-nexus-text-muted">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}</td>
                    <td className="p-4 text-right"><button onClick={() => handleRevokeKey(key.id)} className="text-nexus-danger hover:opacity-80 p-2 rounded-lg hover:bg-nexus-danger/10 transition-colors"><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-nexus-text">Webhook Endpoints</h3>
            <button onClick={() => setShowNewWebhookForm(true)} className="bg-nexus-primary text-nexus-primary-text px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"><Plus size={16} /> Add Endpoint</button>
          </div>

          {showNewWebhookForm && (
            <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 flex items-center gap-3">
              <input autoFocus value={newWebhookUrl} onChange={(e) => setNewWebhookUrl(e.target.value)} placeholder="https://your-server.com/webhook" className="flex-1 bg-nexus-void border border-nexus-border-strong rounded-lg px-3 py-2 text-sm text-nexus-text font-mono" />
              <button onClick={handleAddWebhook} className="bg-nexus-primary text-nexus-primary-text px-4 py-2 rounded-lg text-sm font-medium">Add</button>
              <button onClick={() => setShowNewWebhookForm(false)} className="text-nexus-text-muted p-2"><X size={16} /></button>
            </div>
          )}

          {loading ? (
            <div className="p-6 flex items-center gap-2 text-nexus-text-muted text-sm"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : webhooks.length === 0 ? (
            <p className="text-sm text-nexus-text-faint">No webhooks registered yet.</p>
          ) : (
          <div className="grid grid-cols-1 gap-4">
            {webhooks.map(webhook => (
              <div key={webhook.id} className="bg-nexus-surface border border-nexus-border rounded-xl p-5 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-2 h-2 rounded-full ${webhook.status === 'active' ? 'bg-nexus-success' : 'bg-nexus-text-faint'}`}></div>
                    <span className="font-mono text-sm text-nexus-info break-all">{webhook.url}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {webhook.events.map(ev => <span key={ev} className="bg-nexus-surface-raised text-nexus-text text-xs px-2 py-1 rounded border border-nexus-border-strong">{ev}</span>)}
                  </div>
                  {webhook.lastTestResult && (
                    <div className={`text-xs mt-2 ${webhook.lastTestResult.ok ? 'text-nexus-success' : 'text-nexus-danger'}`}>
                      Last test: {webhook.lastTestResult.ok ? `✓ ${webhook.lastTestResult.statusCode}` : `✗ ${webhook.lastTestResult.error || webhook.lastTestResult.statusCode}`} — {webhook.lastTestAt && new Date(webhook.lastTestAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => handleTestWebhook(webhook.id)} disabled={testingId === webhook.id} className="px-3 py-1.5 bg-nexus-surface-raised hover:bg-nexus-surface text-nexus-text rounded-lg text-sm transition-colors border border-nexus-border-strong flex items-center gap-2 disabled:opacity-50">
                    {testingId === webhook.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Test
                  </button>
                  <button onClick={() => handleRemoveWebhook(webhook.id)} className="text-nexus-danger hover:opacity-80 p-2 rounded-lg hover:bg-nexus-danger/10 transition-colors"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {activeTab === 'extensions' && (
        <div className="space-y-6">
          <h3 className="text-lg font-medium text-nexus-text">Marketplace Integrations</h3>
          <p className="text-sm text-nexus-text-muted -mt-4">These integrations aren't built yet — shown here so you know what's on the roadmap, not because they're connected.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: 'Shopify Sync', desc: 'Sync inventory and orders with Shopify.', icon: <Globe className="text-nexus-text-faint" /> },
              { name: 'WooCommerce', desc: 'Two-way sync for WooCommerce stores.', icon: <Database className="text-nexus-text-faint" /> },
              { name: 'QuickBooks ERP', desc: 'Automated accounting and invoicing.', icon: <Server className="text-nexus-text-faint" /> },
            ].map(ext => (
              <div key={ext.name} className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
                <div className="w-10 h-10 bg-nexus-surface-raised rounded-lg flex items-center justify-center mb-4">{ext.icon}</div>
                <h4 className="font-medium text-nexus-text mb-1">{ext.name}</h4>
                <p className="text-sm text-nexus-text-muted mb-4">{ext.desc}</p>
                <button disabled className="w-full py-2 rounded-lg text-sm font-medium bg-nexus-surface-raised text-nexus-text-faint border border-nexus-border cursor-not-allowed">Not available yet</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
