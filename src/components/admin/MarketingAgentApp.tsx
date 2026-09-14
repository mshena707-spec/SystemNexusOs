/**
 * MARKETING INTELLIGENCE APP — Phase I
 *
 * Three tabs:
 *  - Audience: real customer segments from BIEngine scoring + churn risk
 *  - Campaigns: real creation/send/attribution (not fabricated ROI)
 *  - AI CMO: the existing real LLM-backed marketing advisor (kept, was genuine)
 *
 * The original UI was kept mostly intact for the AI CMO tab since it was
 * legitimately real (fetched real products, called real /api/chat endpoint).
 * The fabricated parts removed: GrowthEngine.suggestCampaign() calls that
 * returned hardcoded expectedROI: '+14%' are gone. Now replaced by real
 * segment+campaign data from Phase I's SegmentationEngine/CampaignEngine.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users, TrendingDown, Send, Sparkles, RefreshCw, Plus,
  CheckCircle, AlertTriangle, BarChart3, MessageSquare,
} from 'lucide-react';

type Tab = 'audience' | 'campaigns' | 'cmo';

interface SegmentSummary { segment: string; count: number; totalLtv: number; avgChurnRisk: number; }
interface ChurnCandidate { userId: string; churnRisk: number; daysSinceLastOrder: number; recommendedAction: string; }
interface Campaign { id?: string; name: string; segment: string; channel: string; status: string; sentCount?: number; audienceSize?: number; }
interface Attribution { campaignId: string; ordersAttributed: number; revenueAttributed: number; conversionRatePct: number; }

const SEGMENT_META: Record<string, { label: string; color: string; desc: string }> = {
  champion:   { label: 'Champions',    color: 'text-emerald-400 bg-emerald-900/30 border-emerald-800', desc: 'High LTV, low churn risk — your best customers' },
  vip:        { label: 'VIP',          color: 'text-blue-400 bg-blue-900/30 border-blue-800',         desc: 'Strong spenders with good retention' },
  loyal:      { label: 'Loyal',        color: 'text-indigo-400 bg-indigo-900/30 border-indigo-800',   desc: 'Consistent buyers, growing value' },
  new:        { label: 'New',          color: 'text-cyan-400 bg-cyan-900/30 border-cyan-800',         desc: 'Recent first-time buyers — nurture now' },
  at_risk:    { label: 'At Risk',      color: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',   desc: 'Declining engagement — needs win-back' },
  dormant:    { label: 'Dormant',      color: 'text-red-400 bg-red-900/30 border-red-800',            desc: 'Long inactive — recovery campaign opportunity' },
};

export const MarketingAgentApp: React.FC = () => {
  const [tab, setTab] = useState<Tab>('audience');
  const [segments, setSegments] = useState<SegmentSummary[]>([]);
  const [churn, setChurn] = useState<ChurnCandidate[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [campaignForm, setCampaignForm] = useState({ name: '', segment: 'at_risk', channel: 'push', content: '', subject: '' });
  const [attribution, setAttribution] = useState<Record<string, Attribution>>({});
  const [msg, setMsg] = useState('');

  // CMO chat state (kept real from original)
  const [messages, setMessages] = useState<Array<{ role: 'user'|'assistant'; content: string }>>([]);
  const [input, setInput] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [festivalName, setFestivalName] = useState('');
  const [generatedCopy, setGeneratedCopy] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const auth = { Authorization: `Bearer ${(window as any).__NEXUS_ADMIN_SECRET__ ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [segRes, churnRes, campaignRes] = await Promise.all([
        fetch('/api/admin/marketing/segments?maxCustomers=500', { headers: auth }),
        fetch('/api/admin/marketing/churn?threshold=50&limit=50', { headers: auth }),
        fetch('/api/admin/marketing/campaigns', { headers: auth }),
      ]);
      if (segRes.ok) { const d = await segRes.json(); setSegments(d.segments ?? []); }
      if (churnRes.ok) { const d = await churnRes.json(); setChurn(d.atRisk ?? []); }
      if (campaignRes.ok) { const d = await campaignRes.json(); setCampaigns(d.campaigns ?? []); }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // Load products for CMO context (same approach as original)
    fetch('/api/products').then(r => r.ok ? r.json() : null).then(d => { if (d?.products) setProducts(d.products.slice(0, 10)); }).catch(() => {});
  }, [refresh]);

  useEffect(() => { setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80); }, [messages]);

  const createCampaign = async () => {
    if (!campaignForm.name || !campaignForm.content) { setMsg('❌ Name and content required'); return; }
    try {
      const r = await fetch('/api/admin/marketing/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ ...campaignForm, attributionWindowDays: 7 }),
      });
      if (r.ok) {
        setMsg('✅ Campaign draft created');
        setCampaignForm({ name: '', segment: 'at_risk', channel: 'push', content: '', subject: '' });
        setShowNewCampaign(false);
        await refresh();
      } else { const d = await r.json(); setMsg(`❌ ${d.error}`); }
    } catch (e: any) { setMsg(`❌ ${e.message}`); }
  };

  const sendCampaign = async (id: string) => {
    if (!confirm('Send this campaign now to its target audience?')) return;
    try {
      const r = await fetch(`/api/admin/marketing/campaigns/${id}/send`, { method: 'POST', headers: auth });
      const d = await r.json();
      if (d.success) { setMsg(`✅ Sent to ${d.sentCount} recipients (${d.failedCount} failed)`); await refresh(); }
      else setMsg(`❌ ${d.error}`);
    } catch (e: any) { setMsg(`❌ ${e.message}`); }
  };

  const measureAttribution = async (id: string) => {
    try {
      const r = await fetch(`/api/admin/marketing/campaigns/${id}/attribution`, { method: 'POST', headers: auth });
      const d = await r.json();
      if (d.campaignId) setAttribution(prev => ({ ...prev, [id]: d }));
    } catch { /* silent */ }
  };

  const generateCopy = async () => {
    if (!festivalName) return;
    setGenerating(true);
    try {
      const r = await fetch('/api/admin/marketing/generate-copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ festivalName, targetAudience: campaignForm.segment }),
      });
      const d = await r.json();
      if (d.copy) { setGeneratedCopy(d.copy); setCampaignForm(f => ({ ...f, content: d.copy })); }
    } catch { /* silent */ }
    setGenerating(false);
  };

  const sendCMOMessage = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim(); setInput(''); setGenerating(true);
    const next = [...messages, { role: 'user' as const, content: userMsg }];
    setMessages(next);
    try {
      const systemCtx = products.length > 0 ? `Products: ${products.map(p => p.name).join(', ')}. ` : '';
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'marketing_agent', message: userMsg, systemInstruction: `${systemCtx}You are an expert CMO for a Bangladeshi e-commerce and delivery platform. Give concise, actionable marketing advice.`, history: next }),
      });
      const d = await r.json();
      const reply = d.text ?? d.response ?? d.message ?? 'No response';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch { setMessages(prev => [...prev, { role: 'assistant', content: 'AI temporarily unavailable.' }]); }
    setGenerating(false);
  };

  return (
    <div className="h-full flex flex-col bg-gray-950 text-nexus-text">
      <div className="p-4 border-b border-nexus-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="text-purple-400" size={22}/> Marketing Intelligence</h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">Real audience segments · Real campaign attribution · No fabricated ROI percentages</p>
        </div>
        <button onClick={refresh} disabled={loading} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      {msg && <div className={`mx-4 mt-2 p-2 rounded text-xs ${msg.startsWith('✅') ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>{msg}</div>}

      <div className="flex border-b border-nexus-border">
        {([['audience','Audience',<Users size={14}/>],['campaigns','Campaigns',<Send size={14}/>],['cmo','AI CMO',<MessageSquare size={14}/>]] as const).map(([t,label,icon]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-5 py-2.5 text-sm border-b-2 transition-colors flex items-center gap-1.5 ${tab===t ? 'border-purple-500 text-purple-400' : 'border-transparent text-nexus-text-muted hover:text-nexus-text'}`}>
            {icon} {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* AUDIENCE TAB */}
        {tab === 'audience' && (
          <>
            {churn.length > 0 && (
              <div className="bg-yellow-950/30 border border-yellow-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-yellow-300 flex items-center gap-2 mb-2"><TrendingDown size={14}/> Churn Risk ({churn.length} customers)</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {churn.slice(0, 10).map((c, i) => (
                    <div key={c.userId} className="text-xs flex items-start justify-between gap-2">
                      <span className="text-yellow-200 font-mono">{c.userId.slice(-8)}</span>
                      <span className="text-yellow-400">{c.churnRisk}% risk</span>
                      <span className="text-nexus-text-muted flex-1 text-right">{c.recommendedAction}</span>
                    </div>
                  ))}
                  {churn.length > 10 && <div className="text-xs text-nexus-text-muted">+{churn.length - 10} more</div>}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              {segments.map(s => {
                const meta = SEGMENT_META[s.segment] ?? { label: s.segment, color: 'text-nexus-text-muted bg-nexus-void border-nexus-border', desc: '' };
                return (
                  <div key={s.segment} className={`rounded-xl p-4 border ${meta.color.split(' ').slice(1).join(' ')}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-bold text-sm ${meta.color.split(' ')[0]}`}>{meta.label}</span>
                      <span className="text-lg font-bold text-nexus-text">{s.count}</span>
                    </div>
                    <div className="text-xs text-nexus-text-muted mb-2">{meta.desc}</div>
                    <div className="text-xs flex gap-4">
                      <span>Total LTV: <strong className="text-nexus-text">${s.totalLtv.toLocaleString(undefined,{maximumFractionDigits:0})}</strong></span>
                      <span>Avg churn risk: <strong className="text-nexus-text">{s.avgChurnRisk.toFixed(0)}%</strong></span>
                    </div>
                  </div>
                );
              })}
              {segments.length === 0 && !loading && <div className="text-center text-nexus-text-muted text-sm py-8">No customers scored yet — place some orders first</div>}
            </div>
          </>
        )}

        {/* CAMPAIGNS TAB */}
        {tab === 'campaigns' && (
          <>
            <button onClick={() => setShowNewCampaign(!showNewCampaign)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm flex items-center gap-2">
              <Plus size={14}/> New Campaign
            </button>

            {showNewCampaign && (
              <div className="bg-nexus-void rounded-xl p-4 space-y-3">
                <input type="text" placeholder="Campaign name" value={campaignForm.name}
                  onChange={e => setCampaignForm(f => ({...f, name: e.target.value}))}
                  className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                <div className="grid grid-cols-2 gap-2">
                  <select value={campaignForm.segment} onChange={e => setCampaignForm(f => ({...f, segment: e.target.value}))}
                    className="bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm">
                    <option value="all">All customers</option>
                    {Object.entries(SEGMENT_META).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <select value={campaignForm.channel} onChange={e => setCampaignForm(f => ({...f, channel: e.target.value}))}
                    className="bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm">
                    <option value="push">Push notification</option>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                {campaignForm.channel === 'email' && (
                  <input type="text" placeholder="Subject line" value={campaignForm.subject}
                    onChange={e => setCampaignForm(f => ({...f, subject: e.target.value}))}
                    className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                )}
                <textarea placeholder="Message content" value={campaignForm.content} rows={3}
                  onChange={e => setCampaignForm(f => ({...f, content: e.target.value}))}
                  className="w-full bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>

                <div className="flex gap-2 items-center">
                  <input type="text" placeholder="Eid / Puja / Boro... (AI copy)" value={festivalName}
                    onChange={e => setFestivalName(e.target.value)}
                    className="flex-1 bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm"/>
                  <button onClick={generateCopy} disabled={generating || !festivalName}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm disabled:opacity-50 flex items-center gap-1">
                    <Sparkles size={13}/> {generating ? '…' : 'AI Copy'}
                  </button>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setShowNewCampaign(false)} className="flex-1 py-2 bg-gray-700 rounded-lg text-sm">Cancel</button>
                  <button onClick={createCampaign} className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm">Save Draft</button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {campaigns.map(c => {
                const attr = c.id ? attribution[c.id] : null;
                return (
                  <div key={c.id} className="bg-nexus-void rounded-xl p-4 border border-nexus-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sm">{c.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'sent' ? 'bg-green-900 text-green-300' : c.status === 'sending' ? 'bg-yellow-900 text-yellow-300' : 'bg-nexus-surface text-nexus-text-muted'}`}>{c.status}</span>
                    </div>
                    <div className="text-xs text-nexus-text-muted">Segment: {c.segment} · Channel: {c.channel}{c.audienceSize != null && ` · Audience: ${c.audienceSize}`}{c.sentCount != null && ` · Sent: ${c.sentCount}`}</div>

                    {attr && (
                      <div className="mt-2 p-2 bg-nexus-surface rounded-lg text-xs space-y-0.5">
                        <div className="text-purple-300 font-bold">Attribution ({attr.conversionRatePct.toFixed(1)}% conversion)</div>
                        <div className="text-nexus-text-muted">{attr.ordersAttributed} orders attributed · ${attr.revenueAttributed.toLocaleString(undefined,{maximumFractionDigits:0})} revenue</div>
                      </div>
                    )}

                    <div className="flex gap-2 mt-3">
                      {c.status === 'draft' && (
                        <button onClick={() => c.id && sendCampaign(c.id)} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs flex items-center gap-1">
                          <Send size={11}/> Send
                        </button>
                      )}
                      {c.status === 'sent' && (
                        <button onClick={() => c.id && measureAttribution(c.id)} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs flex items-center gap-1">
                          <BarChart3 size={11}/> Measure Attribution
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {campaigns.length === 0 && <div className="text-center text-nexus-text-muted text-sm py-8">No campaigns yet — create your first one above</div>}
            </div>

            <div className="bg-blue-950/30 border border-blue-800 rounded-xl p-3 text-xs text-blue-200">
              Attribution measures orders actually placed by campaign recipients within 7 days of sending — real conversion data, not an assumed percentage.
            </div>
          </>
        )}

        {/* AI CMO TAB — kept from original, was genuinely real */}
        {tab === 'cmo' && (
          <div className="flex flex-col h-full space-y-3">
            <div className="flex-1 overflow-y-auto bg-nexus-void rounded-xl p-4 space-y-3 min-h-64">
              {messages.length === 0 && (
                <div className="text-center text-nexus-text-muted py-6 text-sm">
                  Ask your AI CMO anything — campaign ideas, pricing strategy, customer retention advice, seasonal promotions…
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`text-sm p-3 rounded-lg ${m.role === 'user' ? 'bg-nexus-surface text-nexus-text' : 'bg-purple-900/30 border border-purple-800/50 text-purple-100'}`}>
                  {m.role === 'assistant' && <span className="text-purple-400 font-bold text-xs block mb-1">CMO</span>}
                  {m.content}
                </div>
              ))}
              {generating && <div className="text-xs text-purple-400 animate-pulse">Thinking…</div>}
              <div ref={chatEndRef}/>
            </div>
            <div className="flex gap-2">
              <input type="text" value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendCMOMessage()}
                placeholder="Ask your AI CMO…"
                className="flex-1 bg-nexus-surface border border-nexus-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"/>
              <button onClick={sendCMOMessage} disabled={generating || !input.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm disabled:opacity-50">
                <Send size={16}/>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
