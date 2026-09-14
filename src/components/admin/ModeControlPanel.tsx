import React, { useState } from 'react';
import { Network, Activity, Shield, Package, Loader2, Check } from 'lucide-react';
import { useFeatures, SystemFeatures } from '../../contexts/FeatureContext';

// Each mode is a real, meaningful preset of actual feature flags — not a
// decorative toggle. Applying a mode writes through to the same
// FeatureStore that Orchestrator.ts reads on every AI request, so this
// genuinely changes system behavior, not just what the dashboard shows.
const MODE_PRESETS: Record<'enterprise' | 'agi' | 'product', Partial<SystemFeatures>> = {
  enterprise: {
    security_2fa: true, security_bot_detection: true, security_rate_limiting: true,
    security_audit_log: true, ai_cloud_fallback: true,
    ai_competitor_watch: false, commerce_dynamic_pricing: false,
  },
  agi: {
    ai_auto_learning: true, ai_demand_forecast: true, ai_personalization: true,
    ai_ceo_agent: true, ai_competitor_watch: true, ai_auto_reply: true,
    commerce_dynamic_pricing: true,
  },
  product: {
    commerce_loyalty: true, commerce_coupons: true, commerce_abandoned_cart: true,
    commerce_referrals: true, commerce_csat: true, analytics_dashboard: true,
    analytics_financial_reports: true, channel_whatsapp: true, channel_email: true,
  },
};

const MODE_META = {
  enterprise: { label: 'Enterprise Mode', icon: Shield, color: 'text-nexus-danger', desc: 'Stability, cost control, and security boundaries: 2FA, bot detection, rate limiting, and audit logging on; experimental pricing/search off.' },
  agi:        { label: 'AGI Mode',        icon: Activity, color: 'text-nexus-info', desc: 'Reasoning, autonomy, and continuous learning: auto-learning, demand forecasting, personalization, and dynamic pricing on.' },
  product:    { label: 'Product Mode',    icon: Package, color: 'text-nexus-success', desc: 'Customer interaction and revenue: loyalty, coupons, cart recovery, referrals, and financial reporting on.' },
} as const;

// A mode reads as "active" when every flag in its preset currently matches —
// this is a real derived state, not a separate boolean nobody enforces.
function isModeActive(features: SystemFeatures, preset: Partial<SystemFeatures>): boolean {
  return Object.entries(preset).every(([k, v]) => features[k as keyof SystemFeatures] === v);
}

export const ModeControlPanel: React.FC = () => {
  const { features, updateFeatures, isLoading } = useFeatures();
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleToggle = async (mode: keyof typeof MODE_PRESETS, turnOn: boolean) => {
    setApplying(mode);
    setError('');
    try {
      if (turnOn) {
        await updateFeatures(MODE_PRESETS[mode]);
      } else {
        // Turning off a mode reverts just its flags to false, not to
        // whatever another active mode wants — an honest "undo this preset".
        const revert: Partial<SystemFeatures> = {};
        for (const k of Object.keys(MODE_PRESETS[mode])) revert[k as keyof SystemFeatures] = false as any;
        await updateFeatures(revert);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to apply — please try again.');
    } finally {
      setApplying(null);
    }
  };

  const activeModes = (Object.keys(MODE_PRESETS) as Array<keyof typeof MODE_PRESETS>)
    .filter((m) => isModeActive(features, MODE_PRESETS[m]));

  return (
    <div className="h-full flex flex-col bg-nexus-surface text-nexus-text w-full overflow-y-auto">
      <div className="p-6 border-b border-nexus-border bg-nexus-surface-raised/50">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Network className="text-nexus-primary" /> Tri-Mode Operating Core
        </h2>
        <p className="text-sm text-nexus-text-muted mt-1">
          Each mode applies a real, coordinated set of feature flags — the same ones Settings ▸ Feature
          Manager controls individually. Changes take effect immediately, system-wide.
        </p>
      </div>

      {isLoading ? (
        <div className="p-8 flex items-center gap-2 text-nexus-text-muted text-sm"><Loader2 size={16} className="animate-spin" /> Loading current configuration…</div>
      ) : (
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {(Object.keys(MODE_META) as Array<keyof typeof MODE_META>).map((mode) => {
            const meta = MODE_META[mode];
            const Icon = meta.icon;
            const active = activeModes.includes(mode);
            const isBusy = applying === mode;
            return (
              <div key={mode} className="bg-nexus-surface-raised p-5 rounded-2xl border border-nexus-border">
                <h3 className={`font-bold flex items-center justify-between ${meta.color} mb-2`}>
                  <span className="flex items-center gap-2"><Icon size={18} /> {meta.label}</span>
                  <button
                    role="switch" aria-checked={active} disabled={isBusy}
                    onClick={() => handleToggle(mode, !active)}
                    className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${active ? 'bg-nexus-primary' : 'bg-nexus-border-strong'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform flex items-center justify-center ${active ? 'translate-x-5' : ''}`}>
                      {isBusy && <Loader2 size={10} className="animate-spin text-nexus-primary" />}
                    </span>
                  </button>
                </h3>
                <p className="text-xs text-nexus-text-muted mb-3">{meta.desc}</p>
                <div className="flex items-center gap-1.5 text-[11px] text-nexus-text-faint">
                  {active ? <><Check size={12} className="text-nexus-success" /> Active — {Object.keys(MODE_PRESETS[mode]).length} flags applied</> : 'Not currently active'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="px-6 text-sm text-nexus-danger">{error}</p>}

      <div className="p-6 pt-0">
        <div className="bg-nexus-void p-4 rounded-xl border border-nexus-border font-mono text-xs overflow-hidden relative">
          <h4 className="text-nexus-text-faint uppercase mb-2 font-bold">Active Strategy</h4>
          <div className="text-nexus-text-muted">
            <div>[System] Active modes: {activeModes.map(m => MODE_META[m].label).join(' + ') || 'None — using individually-set flags in Feature Manager'}</div>
            <div>[FeatureStore] Reads live from the same store Orchestrator.ts checks on every AI request.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
