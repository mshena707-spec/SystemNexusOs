/**
 * IntegrationManagerApp — API Status + Webhook URL Generator
 *
 * Phase P: Converted from fake save form → real read-only status panel
 * Phase Z+: Added webhook URL generation for WhatsApp/Telegram/Meta setup
 *
 * Admin workflow:
 *   1. Set ENV vars on server (.env file or deployment secrets)
 *   2. Come here to verify they're detected
 *   3. Copy the generated webhook URLs for each platform
 *   4. Paste them into Meta/Telegram developer consoles
 *   5. Done — messages start flowing automatically
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Network, MessageCircle, Key, CheckCircle2, XCircle, RefreshCw,
  Copy, ExternalLink, Globe, Bot, Shield, Zap } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface IntegrationStatus {
  ai: Record<string, boolean>;
  messaging: Record<string, boolean>;
  payments: Record<string, boolean>;
  webhookBaseUrl: string;
}

const AI_PROVIDERS = [
  { key: 'gemini',       env: 'GEMINI_API_KEY',      label: 'Google Gemini',    tier: 'Free', link: 'https://aistudio.google.com/app/apikey' },
  { key: 'groq',         env: 'GROQ_API_KEY',         label: 'Groq (Llama3)',    tier: 'Free', link: 'https://console.groq.com/keys' },
  { key: 'openai',       env: 'OPENAI_API_KEY',       label: 'OpenAI GPT',       tier: 'Paid', link: 'https://platform.openai.com/api-keys' },
  { key: 'anthropic',    env: 'ANTHROPIC_API_KEY',    label: 'Anthropic Claude', tier: 'Paid', link: 'https://console.anthropic.com/' },
  { key: 'huggingface',  env: 'HUGGINGFACE_API_KEY',  label: 'HuggingFace',      tier: 'Free', link: 'https://huggingface.co/settings/tokens' },
  { key: 'deepseek',     env: 'DEEPSEEK_API_KEY',     label: 'DeepSeek',         tier: 'Cheap', link: 'https://platform.deepseek.com/' },
  { key: 'mistral',      env: 'MISTRAL_API_KEY',      label: 'Mistral',          tier: 'Cheap', link: 'https://console.mistral.ai/' },
  { key: 'ollama',       env: 'OLLAMA_BASE_URL',      label: 'Ollama (Local)',   tier: 'Free', link: 'https://ollama.ai' },
];

const CHANNELS = [
  {
    key: 'whatsapp', env: 'WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID',
    label: 'WhatsApp Business', webhookPath: '/api/webhooks/whatsapp',
    verifyParam: 'hub.verify_token', verifyEnv: 'WHATSAPP_VERIFY_TOKEN',
    setupLink: 'https://developers.facebook.com/apps',
    steps: [
      'Create a Meta App at developers.facebook.com',
      'Add WhatsApp product → set your phone number',
      'Set Webhook URL to the address below',
      'Set Verify Token to your WHATSAPP_VERIFY_TOKEN value',
      'Subscribe to messages, message_deliveries events',
    ],
  },
  {
    key: 'telegram', env: 'TELEGRAM_BOT_TOKEN',
    label: 'Telegram Bot', webhookPath: '/api/webhooks/telegram',
    verifyParam: null, verifyEnv: null,
    setupLink: 'https://t.me/BotFather',
    steps: [
      'Create a bot via @BotFather on Telegram',
      'Copy the bot token to TELEGRAM_BOT_TOKEN in .env',
      'The system auto-registers the webhook URL on startup',
    ],
  },
  {
    key: 'facebook', env: 'FB_PAGE_ACCESS_TOKEN + FACEBOOK_APP_SECRET',
    label: 'Facebook Messenger', webhookPath: '/api/webhooks/facebook',
    verifyParam: 'hub.verify_token', verifyEnv: 'WHATSAPP_VERIFY_TOKEN',
    setupLink: 'https://developers.facebook.com/apps',
    steps: [
      'Create or use existing Meta App',
      'Add Messenger product',
      'Set Webhook URL to the address below',
      'Subscribe to messages events',
    ],
  },
  {
    key: 'discord', env: 'DISCORD_BOT_TOKEN',
    label: 'Discord Bot', webhookPath: '/api/webhooks/discord',
    verifyParam: null, verifyEnv: null,
    setupLink: 'https://discord.com/developers/applications',
    steps: [
      'Create application at discord.com/developers',
      'Add a Bot, copy the token to DISCORD_BOT_TOKEN',
      'Invite the bot to your server with message permissions',
    ],
  },
  {
    key: 'tiktok', env: 'TIKTOK_ACCESS_TOKEN',
    label: 'TikTok Business', webhookPath: '/api/webhooks/tiktok',
    verifyParam: null, verifyEnv: null,
    setupLink: 'https://business.tiktok.com/',
    steps: [
      'Apply for TikTok Business API access',
      'Set access token in TIKTOK_ACCESS_TOKEN',
      'Configure webhook to the URL below',
    ],
  },
];

const PAYMENTS = [
  { key: 'stripe', env: 'STRIPE_SECRET_KEY', label: 'Stripe', link: 'https://dashboard.stripe.com/apikeys' },
  { key: 'bkash',  env: 'BKASH_APP_KEY',     label: 'bKash',  link: 'https://developer.bka.sh/' },
  { key: 'nagad',  env: 'NAGAD_MERCHANT_ID',  label: 'Nagad',  link: 'https://nagad.com.bd/developer' },
];

export const IntegrationManagerApp: React.FC = () => {
  const { userRole } = useAuth();
  const [activeTab, setActiveTab] = useState<'ai' | 'channels' | 'payments'>('ai');
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  const auth = { Authorization: `Bearer ${(window as unknown as Record<string, unknown>).__NEXUS_ADMIN_SECRET__ as string ?? ''}` };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/audit/integration-status', { headers: auth });
      if (r.ok) setStatus(await r.json() as IntegrationStatus);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const getWebhookUrl = (path: string): string => {
    const base = status?.webhookBaseUrl || window.location.origin;
    return `${base}${path}`;
  };

  if (userRole !== 'admin' && userRole !== 'ceo') {
    return <div className="p-6 text-red-500">Access Restricted.</div>;
  }

  const tabs = ['ai', 'channels', 'payments'] as const;

  return (
    <div className="h-full flex flex-col bg-white text-sm">
      {/* Header */}
      <div className="p-5 border-b flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-gray-900">
            <Network className="text-blue-500" size={22} /> Integration Hub
          </h2>
          <p className="text-xs text-nexus-text-muted mt-0.5">
            Real configuration status — set ENV vars on server, verify here, copy webhook URLs
          </p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-nexus-text-faint transition text-xs">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white">
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-5 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-nexus-text-muted hover:text-nexus-text-faint'
            }`}>
            {t === 'ai' ? '🤖 AI Providers' : t === 'channels' ? '📱 Channels' : '💳 Payments'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">

        {/* AI Providers */}
        {activeTab === 'ai' && (
          <div className="space-y-2">
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 mb-4">
              <p className="text-blue-700 text-xs">
                <strong>AI Cascade:</strong> System auto-routes: Ollama (local) → Groq (free) → Gemini (free) → DeepSeek (cheap) → OpenAI (paid).
                Configure any combination — unconfigured providers are automatically skipped.
              </p>
            </div>
            {AI_PROVIDERS.map(p => {
              const configured = status?.ai?.[p.key] ?? false;
              return (
                <div key={p.key} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3">
                    <Bot size={16} className={configured ? 'text-green-500' : 'text-nexus-text'} />
                    <div>
                      <div className="font-medium text-nexus-text-faint">{p.label}</div>
                      <div className="font-mono text-[10px] text-nexus-text-muted">{p.env}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      p.tier === 'Free' ? 'bg-green-50 text-green-600' :
                      p.tier === 'Cheap' ? 'bg-yellow-50 text-yellow-600' : 'bg-orange-50 text-orange-600'
                    }`}>{p.tier}</span>
                    {configured
                      ? <span className="flex items-center gap-1 text-green-600 font-medium text-xs"><CheckCircle2 size={13}/> Active</span>
                      : <a href={p.link} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                          Get Key <ExternalLink size={11}/>
                        </a>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Channels */}
        {activeTab === 'channels' && (
          <div className="space-y-3">
            <div className="p-3 bg-green-50 rounded-xl border border-green-100 mb-4">
              <p className="text-green-700 text-xs">
                <strong>Plugin System:</strong> Each channel is a plug-in. Set the ENV var → it auto-registers.
                Copy the webhook URL below and paste it into the platform's developer console.
              </p>
            </div>
            {CHANNELS.map(ch => {
              const configured = status?.messaging?.[ch.key] ?? false;
              const webhookUrl = getWebhookUrl(ch.webhookPath);
              const isExpanded = expandedChannel === ch.key;

              return (
                <div key={ch.key} className={`rounded-xl border transition ${
                  configured ? 'border-green-200 bg-green-50/30' : 'border-gray-200'
                }`}>
                  <button onClick={() => setExpandedChannel(isExpanded ? null : ch.key)}
                    className="w-full flex items-center justify-between p-3 text-left">
                    <div className="flex items-center gap-3">
                      <MessageCircle size={16} className={configured ? 'text-green-500' : 'text-nexus-text-muted'} />
                      <div>
                        <div className="font-semibold text-nexus-text-faint text-xs">{ch.label}</div>
                        <div className="font-mono text-[10px] text-nexus-text-muted">{ch.env.split(' + ')[0]}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {configured
                        ? <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={10}/> Connected
                          </span>
                        : <span className="text-[10px] text-nexus-text-muted">Not configured</span>
                      }
                      <span className="text-nexus-text-muted text-xs">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                      {/* Webhook URL */}
                      <div>
                        <div className="text-[10px] font-semibold text-nexus-text-muted uppercase mb-1">Webhook URL</div>
                        <div className="flex items-center gap-2 bg-nexus-void rounded-lg px-3 py-2">
                          <Globe size={11} className="text-nexus-text-muted flex-shrink-0" />
                          <span className="font-mono text-[11px] text-green-400 flex-1 truncate">{webhookUrl}</span>
                          <button onClick={() => copyToClipboard(webhookUrl, ch.key)}
                            className="text-nexus-text-muted hover:text-nexus-text transition flex-shrink-0">
                            {copied === ch.key ? <CheckCircle2 size={13} className="text-green-400"/> : <Copy size={13}/>}
                          </button>
                        </div>
                      </div>

                      {/* Env vars needed */}
                      <div>
                        <div className="text-[10px] font-semibold text-nexus-text-muted uppercase mb-1">ENV Variables Required</div>
                        {ch.env.split(' + ').map(e => (
                          <div key={e} className="font-mono text-[11px] text-nexus-text-faint bg-gray-100 px-2 py-1 rounded mb-1">{e}</div>
                        ))}
                      </div>

                      {/* Setup steps */}
                      <div>
                        <div className="text-[10px] font-semibold text-nexus-text-muted uppercase mb-1">Setup Steps</div>
                        <ol className="text-xs text-nexus-text-faint space-y-1">
                          {ch.steps.map((step, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-blue-400 font-bold flex-shrink-0">{i + 1}.</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>

                      <a href={ch.setupLink} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline">
                        Open Developer Console <ExternalLink size={11}/>
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Payments */}
        {activeTab === 'payments' && (
          <div className="space-y-2">
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-100 mb-4">
              <p className="text-purple-700 text-xs">
                <strong>Payment cascade:</strong> All gateways are independent. Enable any combination.
                Start with Stripe test mode (sk_test_...) — no charges until you switch to live key.
              </p>
            </div>
            {PAYMENTS.map(p => {
              const configured = status?.payments?.[p.key] ?? false;
              return (
                <div key={p.key} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3">
                    <Zap size={16} className={configured ? 'text-green-500' : 'text-nexus-text'} />
                    <div>
                      <div className="font-medium text-nexus-text-faint">{p.label}</div>
                      <div className="font-mono text-[10px] text-nexus-text-muted">{p.env}</div>
                    </div>
                  </div>
                  {configured
                    ? <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle2 size={13}/> Active</span>
                    : <a href={p.link} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                        Setup <ExternalLink size={11}/>
                      </a>
                  }
                </div>
              );
            })}
            <div className="mt-4 p-3 bg-yellow-50 rounded-xl border border-yellow-100">
              <p className="text-yellow-700 text-xs">
                <Shield size={12} className="inline mr-1"/> <strong>Security:</strong>
                Payment keys are read server-side from ENV only — never stored in database or sent to browser.
                Use your deployment platform's secrets manager (Railway/Render/Fly.io secrets) in production.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
