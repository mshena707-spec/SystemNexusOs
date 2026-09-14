/**
 * FeatureManager — Complete Feature Toggle Admin Panel
 *
 * BEFORE: Only 3 features shown (logistics, anomaly, offline)
 * AFTER:  All 40+ features in groups — channels, AI, commerce, payments, security, ops
 *
 * Features save instantly to NexusDB (Firestore or fallback).
 * Changes take effect system-wide in real-time.
 */
import React, { useState } from 'react';
import { useFeatures, FEATURE_GROUPS, SystemFeatures } from '../../contexts/FeatureContext';
import { Settings, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Wifi, WifiOff } from 'lucide-react';

export const FeatureManager: React.FC = () => {
  const { features, isLoading, isEnabled, updateFeature, resetToDefaults } = useFeatures();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['channels', 'ai']));
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-nexus-text-muted">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3" />
        Loading feature flags...
      </div>
    );
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleToggle = async (key: keyof SystemFeatures, current: boolean) => {
    setSaving(key);
    try {
      await updateFeature(key, !current);
    } finally {
      setSaving(null);
    }
  };

  const enabledCount = (Object.keys(features) as (keyof SystemFeatures)[])
    .filter(k => features[k]).length;
  const totalCount = Object.keys(features).length;

  return (
    <div className="p-6 h-full overflow-y-auto bg-nexus-surface text-nexus-text">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="text-blue-400" size={24} />
            Feature Control Panel
          </h2>
          <p className="text-nexus-text-muted text-sm mt-1">
            {enabledCount}/{totalCount} features active — changes apply instantly system-wide
          </p>
        </div>
        <button
          onClick={() => setConfirmReset(true)}
          className="px-3 py-1.5 text-xs text-red-400 border border-red-800 rounded-lg hover:bg-red-900/30 transition"
        >
          Reset to Defaults
        </button>
      </div>

      {/* Reset confirm dialog */}
      {confirmReset && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded-xl">
          <p className="text-red-300 text-sm mb-3">⚠️ Reset ALL features to default values?</p>
          <div className="flex gap-2">
            <button onClick={async () => { await resetToDefaults(); setConfirmReset(false); }}
              className="px-3 py-1 bg-red-700 text-nexus-text text-xs rounded-lg">Confirm Reset</button>
            <button onClick={() => setConfirmReset(false)}
              className="px-3 py-1 bg-nexus-surface-raised text-nexus-text text-xs rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* Feature Groups */}
      <div className="space-y-3">
        {FEATURE_GROUPS.map(group => {
          const isExpanded = expandedGroups.has(group.key);
          const groupEnabled = group.features.filter(f => isEnabled(f.key)).length;

          return (
            <div key={group.key} className="bg-nexus-surface-raised border border-nexus-border-strong rounded-xl overflow-hidden">
              {/* Group Header */}
              <button
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center justify-between p-4 hover:bg-nexus-surface-raised transition"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown size={16} className="text-nexus-text-muted" /> : <ChevronRight size={16} className="text-nexus-text-muted" />}
                  <div className="text-left">
                    <div className="font-semibold">{group.label}</div>
                    <div className="text-xs text-nexus-text-muted mt-0.5">{group.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    groupEnabled === group.features.length ? 'bg-green-900/40 text-green-400' :
                    groupEnabled > 0 ? 'bg-yellow-900/40 text-yellow-400' : 'bg-nexus-surface-raised text-nexus-text-muted'
                  }`}>
                    {groupEnabled}/{group.features.length}
                  </span>
                </div>
              </button>

              {/* Feature List */}
              {isExpanded && (
                <div className="border-t border-nexus-border-strong divide-y divide-[#2a2a2a]">
                  {group.features.map(feature => {
                    const enabled = isEnabled(feature.key);
                    const isSaving = saving === feature.key;
                    const needsConfig = feature.requiresConfig;

                    return (
                      <div key={feature.key}
                        className="flex items-center justify-between px-4 py-3 hover:bg-nexus-surface-raised transition">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-nexus-text">{feature.label}</span>
                            {needsConfig && !enabled && (
                              <span className="text-[10px] bg-orange-900/30 text-orange-400 px-1.5 py-0.5 rounded">
                                needs config
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-nexus-text-muted mt-0.5">{feature.description}</div>
                          {needsConfig && (
                            <div className="text-[10px] text-nexus-text-faint mt-0.5 font-mono">
                              ENV: {needsConfig}
                            </div>
                          )}
                        </div>

                        {/* Toggle Switch */}
                        <button
                          onClick={() => handleToggle(feature.key, enabled)}
                          disabled={isSaving}
                          className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ml-4 flex-shrink-0 ${
                            enabled ? 'bg-blue-600' : 'bg-nexus-surface-raised'
                          } ${isSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow ${
                            enabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status Summary */}
      <div className="mt-6 p-4 bg-nexus-surface-raised border border-nexus-border-strong rounded-xl">
        <h3 className="text-sm font-medium text-nexus-text mb-3">System Status</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2 text-nexus-text-muted">
            {isEnabled('ai_local_llm') ? <CheckCircle2 size={12} className="text-green-400" /> : <WifiOff size={12} className="text-nexus-text-faint" />}
            Local LLM: {isEnabled('ai_local_llm') ? 'Active' : 'Disabled'}
          </div>
          <div className="flex items-center gap-2 text-nexus-text-muted">
            {isEnabled('security_2fa') ? <CheckCircle2 size={12} className="text-green-400" /> : <AlertTriangle size={12} className="text-yellow-500" />}
            2FA: {isEnabled('security_2fa') ? 'Enforced' : 'Optional'}
          </div>
          <div className="flex items-center gap-2 text-nexus-text-muted">
            <Wifi size={12} className={isEnabled('channel_whatsapp') ? 'text-green-400' : 'text-nexus-text-faint'} />
            WhatsApp: {isEnabled('channel_whatsapp') ? 'Active' : 'Inactive'}
          </div>
          <div className="flex items-center gap-2 text-nexus-text-muted">
            <Wifi size={12} className={isEnabled('channel_telegram') ? 'text-green-400' : 'text-nexus-text-faint'} />
            Telegram: {isEnabled('channel_telegram') ? 'Active' : 'Inactive'}
          </div>
        </div>
      </div>
    </div>
  );
};
