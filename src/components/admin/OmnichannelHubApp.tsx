/**
 * OMNICHANNEL HUB — Phase G
 *
 * Two tabs:
 *  - Channels: real registered platform status (from OmniConnector),
 *    config modal for webhook setup, and a test-message panel that
 *    routes through the REAL pipeline (identity resolution -> memory ->
 *    AI -> persistent history) instead of a hardcoded prompt + direct
 *    Firestore writes.
 *  - Customer Journey: search any customer by phone/email/name/channel ID
 *    and view their unified cross-channel timeline (messages, orders,
 *    payments, preferences) — powered by CustomerJourneyService.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, MessageCircle, Instagram, Youtube, Globe, Plus, Settings, Power,
  ShieldCheck, Send, RefreshCw, CheckCircle2, Key, X, Search, User, Package,
  CreditCard, Clock, Sparkles,
} from 'lucide-react';

const PLATFORM_META: Record<string, { name: string; icon: JSX.Element; type: 'internal'|'external' }> = {
  web:       { name: 'Website Chatbot',     icon: <Globe size={20}/>,        type: 'internal' },
  whatsapp:  { name: 'WhatsApp Business',   icon: <MessageCircle size={20}/>, type: 'external' },
  messenger: { name: 'Facebook Messenger',  icon: <MessageSquare size={20}/>, type: 'external' },
  instagram: { name: 'Instagram Direct',    icon: <Instagram size={20}/>,    type: 'external' },
  telegram:  { name: 'Telegram',            icon: <MessageCircle size={20}/>, type: 'external' },
  discord:   { name: 'Discord',             icon: <MessageSquare size={20}/>, type: 'external' },
  email:     { name: 'Email',               icon: <Globe size={20}/>,        type: 'external' },
  tiktok:    { name: 'TikTok',              icon: <Youtube size={20}/>,      type: 'external' },
};
const ALL_PLATFORM_IDS = Object.keys(PLATFORM_META);

export const OmnichannelHubApp = () => {
  const [tab, setTab] = useState<'channels' | 'journey'>('channels');

  // ── Channels tab state ──────────────────────────────────────────────
  const [registeredPlatforms, setRegisteredPlatforms] = useState<string[]>([]);
  const [liveMessages, setLiveMessages] = useState<any[]>([]);
  const [stats, setStats] = useState<{ totalMessages: number; platformCounts: Record<string, number>; intentCounts: Record<string, number>; lastMessageAt: string | null } | null>(null);
  const [testChannel, setTestChannel] = useState('whatsapp');
  const [testMessage, setTestMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);

  // Configuration Modal State
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [activeConfigChannel, setActiveConfigChannel] = useState<string | null>(null);
  const [configToken, setConfigToken] = useState('');

  // ── Customer Journey tab state ───────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [journey, setJourney] = useState<any | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingJourney, setLoadingJourney] = useState(false);

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  // ── Load registered platforms + recent message logs + stats ──────────
  const refresh = useCallback(async () => {
    try {
      const [logsRes, statsRes] = await Promise.all([
        fetch('/api/omni/logs?limit=30', { headers: auth }),
        fetch('/api/omni/stats', { headers: auth }),
      ]);
      if (logsRes.ok) setLiveMessages(await logsRes.json());
      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats(s);
        setRegisteredPlatforms(s.activePlatforms ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    setTimeout(() => feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [liveMessages]);

  // ── Test message: routes through REAL pipeline ───────────────────────
  // Calls /api/omni/test-message which goes through CustomerIdentityService
  // -> ConversationMemory -> NexusUnifiedCore -> MessageHistoryService,
  // exactly like a real webhook — no hardcoded prompts, no direct Firestore writes.
  const sendTestMessage = async () => {
    if (!testMessage.trim()) return;
    const content = testMessage;
    setTestMessage('');
    setTesting(true);
    try {
      await fetch('/api/omni/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ platform: testChannel, content, senderId: `test_${testChannel}_admin` }),
      });
      await refresh();
    } catch { /* silent */ }
    setTesting(false);
  };

  // ── Customer Journey search ───────────────────────────────────────────
  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSelectedCustomer(null); setJourney(null);
    try {
      const r = await fetch(`/api/admin/omni/customers/search?q=${encodeURIComponent(searchQuery)}`, { headers: auth });
      if (r.ok) { const d = await r.json(); setSearchResults(d.results ?? []); }
    } catch { /* silent */ }
    setSearching(false);
  };

  const selectCustomer = async (customerId: string) => {
    setSelectedCustomer(customerId);
    setLoadingJourney(true);
    try {
      const r = await fetch(`/api/admin/omni/customers/${customerId}/journey`, { headers: auth });
      if (r.ok) setJourney(await r.json());
    } catch { /* silent */ }
    setLoadingJourney(false);
  };

  const getChannelIcon = (platform: string) => PLATFORM_META[platform]?.icon ?? <Globe size={16}/>;

  const eventIcon = (type: string) =>
    type === 'order' ? <Package size={13} className="text-purple-400"/> :
    type === 'payment' ? <CreditCard size={13} className="text-green-400"/> :
    <MessageSquare size={13} className="text-blue-400"/>;

  return (
    <div className="h-full flex flex-col bg-nexus-void text-nexus-text">

      {/* Header */}
      <div className="p-6 pb-0">
        <h2 className="text-2xl font-bold text-nexus-text flex items-center gap-2 mb-2">
          <Globe className="text-blue-500" /> Omnichannel OS
        </h2>
        <p className="text-nexus-text-muted text-sm max-w-2xl mb-4">
          Every channel routes through one pipeline: cross-channel customer identity, shared conversation memory,
          and a persistent unified timeline — no per-channel logic, no in-memory state lost on restart.
        </p>

        {/* Tabs */}
        <div className="flex border-b border-nexus-border -mx-6 px-6">
          {(['channels','journey'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm capitalize border-b-2 transition-colors ${tab===t ? 'border-blue-500 text-blue-400' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'}`}>
              {t === 'journey' ? 'Customer Journey' : 'Channels'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">

        {/* ══════════════ CHANNELS TAB ══════════════ */}
        {tab === 'channels' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                {ALL_PLATFORM_IDS.map((id) => {
                  const meta = PLATFORM_META[id];
                  const active = registeredPlatforms.includes(id);
                  const msgCount = stats?.platformCounts?.[id] ?? 0;
                  return (
                    <div key={id} className="bg-nexus-surface border border-nexus-border rounded-xl p-5 hover:border-nexus-border-strong transition-colors relative overflow-hidden group">
                      <div className="flex justify-between items-start mb-4">
                        <div className={`p-3 rounded-lg ${active ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-nexus-text-muted'}`}>
                          {meta.icon}
                        </div>
                        <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full ${active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-nexus-text-muted'}`}>
                          {active ? 'connected' : 'not configured'}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-nexus-text mb-1">{meta.name}</h3>
                      <p className="text-xs text-nexus-text-muted mb-2">
                        {meta.type === 'internal' ? 'Native integration' : 'Requires API webhook setup'}
                      </p>
                      {active && (
                        <p className="text-xs text-blue-400 mb-4">{msgCount} message{msgCount!==1?'s':''} (recent)</p>
                      )}
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => { setActiveConfigChannel(id); setConfigToken(''); setConfigModalOpen(true); }}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${active ? 'bg-nexus-surface-raised hover:bg-nexus-surface-raised text-nexus-text' : 'bg-blue-600 hover:bg-blue-500 text-nexus-text'}`}>
                          {active ? <><Settings size={14}/> Configure</> : <><Power size={14}/> Connect</>}
                        </button>
                      </div>
                      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  );
                })}

                <div className="bg-nexus-surface border border-dashed border-nexus-border-strong rounded-xl p-5 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all flex flex-col items-center justify-center min-h-[160px] text-nexus-text-muted hover:text-blue-400">
                  <Plus size={32} className="mb-2" />
                  <span className="font-medium">Add Custom Channel</span>
                  <span className="text-xs mt-1 text-center px-4">
                    Implement IOmniConnector + register — no other code changes needed (plugin architecture)
                  </span>
                </div>
              </div>

              {/* Test Message Panel — routes through REAL pipeline */}
              <div className="bg-nexus-surface border border-nexus-border-strong rounded-xl p-5 flex flex-col h-[500px]">
                <h3 className="text-lg font-bold text-nexus-text mb-1 flex items-center gap-2">
                  <Sparkles size={18} className="text-blue-500" /> Live Pipeline Test
                </h3>
                <p className="text-xs text-nexus-text-muted mb-4">
                  Sends a message through the real pipeline: identity resolution → shared memory → AI → persistent history.
                  Appears in Customer Journey afterward.
                </p>

                <div className="flex-1 overflow-y-auto bg-nexus-void rounded-lg p-4 mb-4 border border-nexus-border space-y-3">
                  {liveMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-nexus-text-faint">
                      <MessageSquare size={32} className="mb-2 opacity-50" />
                      <span className="text-sm">No messages yet.</span>
                    </div>
                  ) : (
                    liveMessages.map((msg, idx) => (
                      <div key={msg.id || idx} className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 text-[10px] text-nexus-text-muted uppercase">
                          {getChannelIcon(msg.platform)} {msg.senderName ?? msg.senderId} via {msg.platform}
                          {msg.intent && <span className="ml-1 px-1.5 py-0.5 rounded bg-nexus-surface text-nexus-text-muted">{msg.intent}</span>}
                        </div>
                        <div className="p-2 rounded-lg bg-nexus-surface-raised border border-nexus-border text-sm text-nexus-text">{msg.content}</div>
                        {msg.reply && (
                          <div className="p-2 rounded-lg bg-blue-900/15 border border-blue-500/20 text-sm text-blue-100 flex items-start gap-1">
                            <CheckCircle2 size={12} className="text-blue-400 mt-0.5 flex-shrink-0"/> {msg.reply}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  {testing && (
                    <div className="flex items-center gap-2 text-blue-400 text-sm">
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                    </div>
                  )}
                  <div ref={feedEndRef} />
                </div>

                <div className="flex flex-col gap-2">
                  <select value={testChannel} onChange={(e) => setTestChannel(e.target.value)}
                    className="w-full bg-nexus-surface-raised border border-nexus-border-strong rounded-lg px-3 py-2 text-sm text-nexus-text focus:outline-none focus:border-blue-500">
                    {ALL_PLATFORM_IDS.map(id => <option key={id} value={id}>{PLATFORM_META[id].name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <input type="text" value={testMessage} onChange={(e) => setTestMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendTestMessage()}
                      placeholder="Type a test message..."
                      className="flex-1 bg-nexus-surface-raised border border-nexus-border-strong rounded-lg px-3 py-2 text-sm text-nexus-text focus:outline-none focus:border-blue-500" />
                    <button onClick={sendTestMessage} disabled={testing || !testMessage.trim()}
                      className="bg-blue-600 hover:bg-blue-500 text-nexus-text px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-900/10 border border-blue-500/20 rounded-xl p-6">
              <h4 className="text-blue-400 font-bold flex items-center gap-2 mb-2">
                <ShieldCheck size={18} /> Unified Pipeline Active
              </h4>
              <p className="text-sm text-nexus-text-muted">
                Every channel above shares one identity resolver, one conversation memory, and one persistent
                message history (NexusDB). A customer messaging on WhatsApp and later on Telegram is recognized
                as the same person — see the Customer Journey tab.
              </p>
            </div>
          </>
        )}

        {/* ══════════════ CUSTOMER JOURNEY TAB ══════════════ */}
        {tab === 'journey' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Search + results */}
            <div className="lg:col-span-1 space-y-3">
              <div className="flex gap-2">
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  placeholder="Search phone, email, name, channel ID..."
                  className="flex-1 bg-nexus-surface-raised border border-nexus-border-strong rounded-lg px-3 py-2 text-sm text-nexus-text focus:outline-none focus:border-blue-500" />
                <button onClick={runSearch} disabled={searching}
                  className="bg-blue-600 hover:bg-blue-500 text-nexus-text px-4 py-2 rounded-lg disabled:opacity-50">
                  <Search size={16}/>
                </button>
              </div>

              <div className="space-y-2">
                {searchResults.map((c: any) => (
                  <button key={c.customerId} onClick={() => selectCustomer(c.customerId)}
                    className={`w-full text-left bg-nexus-surface border rounded-xl p-3 transition-colors ${selectedCustomer === c.customerId ? 'border-blue-500' : 'border-nexus-border hover:border-nexus-border-strong'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <User size={14} className="text-nexus-text-muted"/>
                      <span className="text-sm font-medium text-nexus-text">{c.displayName ?? c.customerId}</span>
                    </div>
                    <div className="text-xs text-nexus-text-muted">{c.primaryPhone ?? c.primaryEmail ?? '—'}</div>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {c.channels?.map((ch: any) => (
                        <span key={ch.platform+ch.channelId} className="text-[10px] px-1.5 py-0.5 rounded bg-nexus-surface-raised text-nexus-text-muted flex items-center gap-1">
                          {getChannelIcon(ch.platform)} {ch.platform}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
                {searchResults.length === 0 && !searching && (
                  <div className="text-center text-nexus-text-muted text-sm py-8">Search for a customer to view their journey</div>
                )}
              </div>
            </div>

            {/* Journey detail */}
            <div className="lg:col-span-2">
              {loadingJourney ? (
                <div className="text-center text-nexus-text-muted py-12">
                  <RefreshCw size={24} className="mx-auto mb-2 animate-spin opacity-60"/> Loading journey…
                </div>
              ) : journey ? (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
                      <div className="text-xs text-nexus-text-muted mb-1">Orders</div>
                      <div className="text-2xl font-bold text-nexus-text">{journey.orderCount}</div>
                    </div>
                    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
                      <div className="text-xs text-nexus-text-muted mb-1">Total Spend</div>
                      <div className="text-2xl font-bold text-nexus-text">${journey.totalSpend?.toFixed(2)}</div>
                    </div>
                    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
                      <div className="text-xs text-nexus-text-muted mb-1">Channels</div>
                      <div className="text-2xl font-bold text-nexus-text">{journey.identity?.channels?.length ?? 0}</div>
                    </div>
                  </div>

                  {/* Preferences */}
                  {Object.keys(journey.preferences ?? {}).length > 0 && (
                    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
                      <h4 className="text-sm font-bold text-nexus-text mb-2">Preferences</h4>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(journey.preferences).map(([k,v]) => (
                          <span key={k} className="text-xs px-2 py-1 rounded bg-nexus-surface-raised text-nexus-text">{k}: <strong>{v as string}</strong></span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Linked channels */}
                  <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
                    <h4 className="text-sm font-bold text-nexus-text mb-2">Linked Channels</h4>
                    <div className="space-y-1">
                      {journey.identity?.channels?.map((ch: any) => (
                        <div key={ch.platform+ch.channelId} className="flex items-center gap-2 text-xs text-nexus-text-muted">
                          {getChannelIcon(ch.platform)} <span className="capitalize">{ch.platform}</span>
                          <span className="text-nexus-text-faint">— {ch.displayName ?? ch.channelId}</span>
                          <span className="text-nexus-text-faint ml-auto">linked {new Date(ch.linkedAt).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
                    <h4 className="text-sm font-bold text-nexus-text mb-3 flex items-center gap-2"><Clock size={14}/> Unified Timeline</h4>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {journey.timeline?.map((e: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          {eventIcon(e.type)}
                          <div className="flex-1">
                            <div className="text-nexus-text">{e.summary}</div>
                            <div className="text-nexus-text-faint">{e.timestamp ? new Date(e.timestamp).toLocaleString() : ''}</div>
                          </div>
                        </div>
                      ))}
                      {(!journey.timeline || journey.timeline.length === 0) && (
                        <div className="text-center text-nexus-text-muted py-4">No activity yet</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-nexus-text-muted py-12">
                  <User size={32} className="mx-auto mb-2 opacity-40"/>
                  Select a customer to view their 360° journey
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Configuration Modal */}
      {configModalOpen && activeConfigChannel && (
        <div className="fixed inset-0 bg-nexus-void/80 flex items-center justify-center z-50 p-4">
          <div className="bg-nexus-surface border border-nexus-border-strong rounded-2xl p-6 w-full max-w-md relative">
            <button onClick={() => setConfigModalOpen(false)} className="absolute top-4 right-4 text-nexus-text-muted hover:text-nexus-text">
              <X size={20} />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400">{PLATFORM_META[activeConfigChannel].icon}</div>
              <div>
                <h3 className="text-xl font-bold text-nexus-text">Configure {PLATFORM_META[activeConfigChannel].name}</h3>
                <p className="text-sm text-nexus-text-muted">Connect via Developer Portal API</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-nexus-text mb-1">Access Token / API Key</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Key size={16} className="text-nexus-text-muted" />
                  </div>
                  <input type="password" value={configToken} onChange={(e) => setConfigToken(e.target.value)}
                    placeholder="Paste your token here..."
                    className="flex-1 w-full bg-nexus-surface-raised border border-nexus-border-strong rounded-xl py-3 pl-10 pr-4 text-nexus-text placeholder-gray-600 focus:outline-none focus:border-blue-500" />
                </div>
                <p className="text-xs text-nexus-text-muted mt-2">
                  Set this as an environment variable (see .env.example) and restart the server — tokens are read from env, not stored via this UI.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-nexus-text mb-1">Webhook URL (For Developer Portal)</label>
                <div className="bg-nexus-surface-raised border border-nexus-border-strong rounded-xl p-3 text-sm text-nexus-text-muted select-all font-mono">
                  https://your-domain.com/api/webhooks/{activeConfigChannel}
                </div>
                <p className="text-xs text-nexus-text-muted mt-2">
                  Copy and paste this URL into the Webhook configuration of your {PLATFORM_META[activeConfigChannel].name} app.
                </p>
              </div>
              <div className="pt-4 border-t border-nexus-border-strong">
                <button onClick={() => setConfigModalOpen(false)}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-nexus-text font-medium py-3 rounded-xl transition-colors">
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
