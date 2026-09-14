/**
 * FeatureContext — Universal Feature Flag System
 *
 * BEFORE: Only 3 hardcoded features (logistics_tracking, anomaly_reports, offline_mode)
 * AFTER:  Full system — every feature/channel/integration toggleable via admin UI
 *
 * Features are stored in NexusDB (provider-agnostic).
 * Real-time updates via Firestore onSnapshot OR polling fallback.
 * Any feature can be toggled without code deploy — purely data-driven.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// Import FeatureGate to sync AI-internal toggles when admin changes settings
// This bridges the UI feature toggle system with the AI Orchestrator's runtime feature gate
type FeatureGateKey = 'enableCognitiveRouting' | 'enableOfflineBrainstem' | 'enableMoEPredictor' |
  'enableNeuroplasticity' | 'enableEmotionalResonance' | 'enableVendorFailover' |
  'enableHyperCompression' | 'enableAutoArchive' | 'enableStrictRBAC' | 'enableDeepAnalytics';

function syncFeatureGate(features: SystemFeatures): void {
  try {
    // Map FeatureContext keys → FeatureGate keys
    const mapping: Partial<Record<keyof SystemFeatures, FeatureGateKey>> = {
      ai_auto_reply:       'enableCognitiveRouting',
      ai_local_llm:        'enableOfflineBrainstem',
      ai_auto_learning:    'enableNeuroplasticity',
      ai_cloud_fallback:   'enableVendorFailover',
      ai_personalization:  'enableEmotionalResonance',
      security_audit_log:  'enableStrictRBAC',
      analytics_dashboard: 'enableDeepAnalytics',
    };

    // Dynamic import to avoid circular dependency
    import('../lib/core/security/FeatureGate').then(({ useFeatureGate }) => {
      const store = useFeatureGate.getState();
      for (const [ctxKey, gateKey] of Object.entries(mapping) as Array<[keyof SystemFeatures, FeatureGateKey]>) {
        if (features[ctxKey] !== undefined) {
          store.toggleFeature(gateKey, features[ctxKey]);
        }
      }
    }).catch(() => {}); // Non-blocking
  } catch { /* FeatureGate not available in all environments */ }
}
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

// ── Complete Feature Flag Schema ─────────────────────────────────────────────

export interface SystemFeatures {
  // ── Channels (Omnichannel) ─────────────────────────────────────
  channel_web:          boolean;  // Website chatbot
  channel_whatsapp:     boolean;  // WhatsApp Business API
  channel_messenger:    boolean;  // Facebook Messenger
  channel_instagram:    boolean;  // Instagram DM
  channel_telegram:     boolean;  // Telegram Bot
  channel_discord:      boolean;  // Discord Bot
  channel_email:        boolean;  // Email (SMTP)
  channel_tiktok:       boolean;  // TikTok Business Messaging
  channel_voice:        boolean;  // Voice/Phone (future)
  channel_sms:          boolean;  // SMS/Twilio (future)

  // ── AI Features ────────────────────────────────────────────────
  ai_local_llm:         boolean;  // Ollama local model
  ai_cloud_fallback:    boolean;  // Cloud AI fallback
  ai_auto_learning:     boolean;  // Learn from successful chats
  ai_competitor_watch:  boolean;  // CompetitorAI web search
  ai_demand_forecast:   boolean;  // DemandForecastingEngine
  ai_personalization:   boolean;  // Personalized recommendations
  ai_auto_reply:        boolean;  // AI auto-reply in chat
  ai_ceo_agent:         boolean;  // CEOAgent daily brief

  // ── Commerce ───────────────────────────────────────────────────
  commerce_dynamic_pricing:   boolean;  // DynamicPricingEngine
  commerce_loyalty:            boolean;  // Loyalty points
  commerce_coupons:            boolean;  // Coupon engine
  commerce_csat:               boolean;  // Post-order CSAT
  commerce_abandoned_cart:     boolean;  // Cart recovery
  commerce_referrals:          boolean;  // ReferralEngine

  // ── Operations ─────────────────────────────────────────────────
  ops_realtime_tracking:   boolean;  // Rider GPS tracking
  ops_route_optimization:  boolean;  // RouteOptimizationEngine
  ops_smart_assignment:    boolean;  // SmartRiderAssignment
  ops_fleet_monitoring:    boolean;  // Admin fleet map

  // ── Security ───────────────────────────────────────────────────
  security_2fa:              boolean;  // TOTP 2FA requirement
  security_bot_detection:    boolean;  // Bot detection middleware
  security_rate_limiting:    boolean;  // Redis rate limiting
  security_audit_log:        boolean;  // ImmutableAuditLog

  // ── Payments ───────────────────────────────────────────────────
  payment_stripe:     boolean;
  payment_bkash:      boolean;
  payment_nagad:      boolean;
  payment_rocket:     boolean;

  // ── Analytics & Reporting ──────────────────────────────────────
  analytics_dashboard:       boolean;
  analytics_financial_reports: boolean;
  analytics_ceo_dashboard:   boolean;

  // ── Legacy (kept for backward compat) ─────────────────────────
  logistics_tracking:   boolean;
  anomaly_reports:      boolean;
  offline_mode:         boolean;
}

export const DEFAULT_FEATURES: SystemFeatures = {
  // Channels — web always on, others off until configured
  channel_web: true, channel_whatsapp: false, channel_messenger: false,
  channel_instagram: false, channel_telegram: false, channel_discord: false,
  channel_email: true, channel_tiktok: false, channel_voice: false, channel_sms: false,

  // AI — local + auto_reply on, others need config
  ai_local_llm: true, ai_cloud_fallback: true, ai_auto_learning: true,
  ai_competitor_watch: false, ai_demand_forecast: true,
  ai_personalization: true, ai_auto_reply: true, ai_ceo_agent: true,

  // Commerce — all on by default
  commerce_dynamic_pricing: true, commerce_loyalty: true, commerce_coupons: true,
  commerce_csat: true, commerce_abandoned_cart: true, commerce_referrals: true,

  // Ops — tracking on, route opt + smart assign on
  ops_realtime_tracking: true, ops_route_optimization: true,
  ops_smart_assignment: true, ops_fleet_monitoring: true,

  // Security — all on
  security_2fa: false, security_bot_detection: true,
  security_rate_limiting: true, security_audit_log: true,

  // Payments — stripe on, local off until configured
  payment_stripe: true, payment_bkash: false, payment_nagad: false, payment_rocket: false,

  // Analytics — all on
  analytics_dashboard: true, analytics_financial_reports: true, analytics_ceo_dashboard: true,

  // Legacy
  logistics_tracking: true, anomaly_reports: true, offline_mode: false,
};

// ── Feature Groups for UI ────────────────────────────────────────────────────

export const FEATURE_GROUPS: Array<{
  key: string;
  label: string;
  description: string;
  features: Array<{ key: keyof SystemFeatures; label: string; description: string; requiresConfig?: string }>;
}> = [
  {
    key: 'channels',
    label: '📱 Messaging Channels',
    description: 'Enable channels where customers can contact you and you can run campaigns',
    features: [
      { key: 'channel_web', label: 'Website Chatbot', description: 'Embedded chat widget on your website' },
      { key: 'channel_whatsapp', label: 'WhatsApp Business', description: 'Real Meta Graph API', requiresConfig: 'WHATSAPP_TOKEN' },
      { key: 'channel_messenger', label: 'Facebook Messenger', description: 'Facebook Page inbox', requiresConfig: 'FB_PAGE_ACCESS_TOKEN' },
      { key: 'channel_instagram', label: 'Instagram DM', description: 'Instagram Business inbox', requiresConfig: 'FB_PAGE_ACCESS_TOKEN' },
      { key: 'channel_telegram', label: 'Telegram Bot', description: 'Telegram Bot API', requiresConfig: 'TELEGRAM_BOT_TOKEN' },
      { key: 'channel_discord', label: 'Discord Bot', description: 'Discord Server bot', requiresConfig: 'DISCORD_BOT_TOKEN' },
      { key: 'channel_email', label: 'Email (SMTP)', description: 'Email support & campaigns' },
      { key: 'channel_tiktok', label: 'TikTok Business', description: 'TikTok DM & comments', requiresConfig: 'TIKTOK_ACCESS_TOKEN' },
      { key: 'channel_sms', label: 'SMS (Twilio)', description: 'Text message support', requiresConfig: 'TWILIO_ACCOUNT_SID' },
    ],
  },
  {
    key: 'ai',
    label: '🤖 AI Features',
    description: 'Control AI capabilities across the platform',
    features: [
      { key: 'ai_local_llm', label: 'Local LLM (Ollama)', description: 'Run AI on your own hardware — free, private' },
      { key: 'ai_cloud_fallback', label: 'Cloud AI Fallback', description: 'Groq, Gemini, OpenAI when local fails' },
      { key: 'ai_auto_reply', label: 'AI Auto-Reply', description: 'AI answers customers before human agents' },
      { key: 'ai_auto_learning', label: 'Auto-Learning Loop', description: 'AI learns from successful conversations' },
      { key: 'ai_competitor_watch', label: 'Competitor Intelligence', description: 'Real-time competitor price monitoring', requiresConfig: 'SERP_API_KEY' },
      { key: 'ai_demand_forecast', label: 'Demand Forecasting', description: 'Predict inventory needs with ML' },
      { key: 'ai_personalization', label: 'Personalization', description: 'Personalized product recommendations' },
      { key: 'ai_ceo_agent', label: 'CEO Agent', description: 'Daily AI business intelligence brief' },
    ],
  },
  {
    key: 'commerce',
    label: '🛒 Commerce Features',
    description: 'E-commerce tools to grow revenue',
    features: [
      { key: 'commerce_dynamic_pricing', label: 'Dynamic Pricing', description: 'Auto-adjust prices based on demand' },
      { key: 'commerce_loyalty', label: 'Loyalty Points', description: 'Reward customers with points' },
      { key: 'commerce_coupons', label: 'Coupon Engine', description: 'Discount codes and promotions' },
      { key: 'commerce_csat', label: 'CSAT Surveys', description: 'Post-order satisfaction scoring' },
      { key: 'commerce_abandoned_cart', label: 'Cart Recovery', description: 'Auto-recover abandoned carts via messaging' },
      { key: 'commerce_referrals', label: 'Referral Program', description: 'Incentivize customer referrals' },
    ],
  },
  {
    key: 'payments',
    label: '💳 Payment Methods',
    description: 'Enable payment gateways',
    features: [
      { key: 'payment_stripe', label: 'Stripe (International)', description: 'Credit/debit cards worldwide', requiresConfig: 'STRIPE_SECRET_KEY' },
      { key: 'payment_bkash', label: 'bKash (Bangladesh)', description: 'Mobile banking', requiresConfig: 'BKASH_APP_KEY' },
      { key: 'payment_nagad', label: 'Nagad (Bangladesh)', description: 'Digital financial service', requiresConfig: 'NAGAD_MERCHANT_ID' },
      { key: 'payment_rocket', label: 'Rocket (Bangladesh)', description: 'DBBL mobile banking', requiresConfig: 'ROCKET_API_KEY' },
    ],
  },
  {
    key: 'security',
    label: '🔒 Security',
    description: 'Security and compliance features',
    features: [
      { key: 'security_2fa', label: 'Two-Factor Auth (2FA)', description: 'TOTP for all admin accounts' },
      { key: 'security_bot_detection', label: 'Bot Detection', description: 'Detect and block automated traffic' },
      { key: 'security_rate_limiting', label: 'Rate Limiting', description: 'Redis distributed rate limits' },
      { key: 'security_audit_log', label: 'Immutable Audit Log', description: 'Tamper-proof action log' },
    ],
  },
  {
    key: 'ops',
    label: '🚚 Operations',
    description: 'Delivery and logistics features',
    features: [
      { key: 'ops_realtime_tracking', label: 'Real-Time GPS Tracking', description: 'Live rider location updates' },
      { key: 'ops_route_optimization', label: 'Route Optimization', description: 'TSP algorithm for efficient routes' },
      { key: 'ops_smart_assignment', label: 'Smart Rider Assignment', description: 'ML-based delivery assignment' },
      { key: 'ops_fleet_monitoring', label: 'Fleet Monitoring', description: 'Admin map of all riders' },
    ],
  },
];

// ── Context ──────────────────────────────────────────────────────────────────

interface FeatureContextType {
  features: SystemFeatures;
  isLoading: boolean;
  isEnabled: (key: keyof SystemFeatures) => boolean;
  updateFeature: (key: keyof SystemFeatures, value: boolean) => Promise<void>;
  updateFeatures: (updates: Partial<SystemFeatures>) => Promise<void>;
  resetToDefaults: () => Promise<void>;
}

const FeatureContext = createContext<FeatureContextType>({
  features: DEFAULT_FEATURES,
  isLoading: true,
  isEnabled: (key: keyof SystemFeatures) => DEFAULT_FEATURES[key],
  updateFeature: async () => {},
  updateFeatures: async () => {},
  resetToDefaults: async () => {},
});

export const FeatureProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [features, setFeatures] = useState<SystemFeatures>(DEFAULT_FEATURES);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Try Firestore real-time subscription first
    try {
      const docRef = doc(db, 'settings', 'nexus_features');
      const unsub = onSnapshot(docRef, (snap) => {
        if (snap.exists()) {
          setFeatures({ ...DEFAULT_FEATURES, ...(snap.data().features as Partial<SystemFeatures>) });
        }
        setIsLoading(false);
      }, () => {
        // Firestore unavailable — try REST API fallback
        fetchFeaturesFromAPI();
      });
      return () => unsub();
    } catch {
      fetchFeaturesFromAPI();
    }
  }, []);

  const fetchFeaturesFromAPI = async () => {
    try {
      const res = await fetch('/api/features');
      if (res.ok) {
        const data = await res.json() as { features: Partial<SystemFeatures> };
        setFeatures({ ...DEFAULT_FEATURES, ...data.features });
      }
    } catch { /* use defaults */ }
    finally { setIsLoading(false); }
  };

  const updateFeatures = useCallback(async (updates: Partial<SystemFeatures>) => {
    const newFeatures = { ...features, ...updates };
    setFeatures(newFeatures); // Optimistic update

    // Sync AI orchestrator feature gate immediately (client-side components
    // that read the legacy FeatureGate store directly, e.g. CEODashboard)
    syncFeatureGate(newFeatures);

    // Always go through the server — this is what Orchestrator.ts actually
    // reads. NexusDB.set writes to the same settings/nexus_features
    // document the onSnapshot subscription above is watching, so Firestore
    // deployments still get instant live updates in every open tab too.
    const res = await fetch('/api/features', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: newFeatures }),
    });
    if (!res.ok) throw new Error('Failed to save feature settings');
  }, [features]);

  const updateFeature = useCallback(async (key: keyof SystemFeatures, value: boolean) => {
    await updateFeatures({ [key]: value });
  }, [updateFeatures]);

  const isEnabled = useCallback((key: keyof SystemFeatures): boolean => {
    return features[key] ?? DEFAULT_FEATURES[key] ?? false;
  }, [features]);

  const resetToDefaults = useCallback(async () => {
    await updateFeatures(DEFAULT_FEATURES);
  }, [updateFeatures]);

  return (
    <FeatureContext.Provider value={{ features, isLoading, isEnabled, updateFeature, updateFeatures, resetToDefaults }}>
      {children}
    </FeatureContext.Provider>
  );
};

export const useFeatures = () => useContext(FeatureContext);
export default FeatureContext;
