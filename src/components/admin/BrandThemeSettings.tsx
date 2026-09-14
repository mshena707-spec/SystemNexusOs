import React, { useState, useEffect } from 'react';
import { Check, RotateCcw, Palette, Loader2 } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { PALETTE_PRESETS } from '../../lib/theme/colorEngine';

export const BrandThemeSettings: React.FC = () => {
  const { primary: savedPrimary, secondary: savedSecondary, previewTheme, saveTheme, cancelPreview, resetToDefault } = useTheme();
  const [primary, setPrimary] = useState(savedPrimary);
  const [secondary, setSecondary] = useState(savedSecondary);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setPrimary(savedPrimary); setSecondary(savedSecondary); }, [savedPrimary, savedSecondary]);

  const isDirty = primary !== savedPrimary || secondary !== savedSecondary;

  const handleChange = (nextPrimary: string, nextSecondary: string) => {
    setPrimary(nextPrimary);
    setSecondary(nextSecondary);
    setSaved(false);
    previewTheme(nextPrimary, nextSecondary);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await saveTheme(primary, secondary);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.message || 'Could not save — please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setPrimary(savedPrimary);
    setSecondary(savedSecondary);
    cancelPreview();
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await resetToDefault();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8">
      <div>
        <h2 className="text-xl font-serif font-semibold text-nexus-text flex items-center gap-2">
          <Palette size={20} className="text-nexus-primary" /> Brand &amp; Appearance
        </h2>
        <p className="text-sm text-nexus-text-muted mt-1 max-w-2xl">
          Pick your own brand colors — this isn't locked to any preset identity. Choose a primary color
          (and optionally a secondary), and the whole system — this dashboard and the public storefront —
          adapts instantly. Everything else (buttons, hover states, readable text on top of your colors) is
          generated automatically so it always looks polished, at any color you pick.
        </p>
      </div>

      {/* Color pickers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-nexus-text mb-2">Primary color</label>
          <div className="flex items-center gap-3">
            <input
              type="color" value={primary}
              onChange={(e) => handleChange(e.target.value, secondary)}
              className="w-12 h-12 rounded-lg border border-nexus-border cursor-pointer bg-nexus-surface-raised"
            />
            <input
              type="text" value={primary}
              onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && handleChange(e.target.value, secondary)}
              className="flex-1 bg-nexus-surface-raised border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text font-mono"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-nexus-text mb-2">Secondary color</label>
          <div className="flex items-center gap-3">
            <input
              type="color" value={secondary}
              onChange={(e) => handleChange(primary, e.target.value)}
              className="w-12 h-12 rounded-lg border border-nexus-border cursor-pointer bg-nexus-surface-raised"
            />
            <input
              type="text" value={secondary}
              onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && handleChange(primary, e.target.value)}
              className="flex-1 bg-nexus-surface-raised border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text font-mono"
            />
          </div>
        </div>
      </div>

      {/* Presets */}
      <div>
        <label className="block text-sm font-medium text-nexus-text mb-3">Or start from a preset</label>
        <div className="flex flex-wrap gap-3">
          {PALETTE_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => handleChange(preset.primary, preset.secondary ?? preset.primary)}
              className="group flex items-center gap-2 pl-2 pr-3 py-2 rounded-full border border-nexus-border hover:border-nexus-border-strong bg-nexus-surface-raised transition-colors"
              title={preset.name}
            >
              <span className="flex -space-x-1.5">
                <span className="w-5 h-5 rounded-full border-2 border-nexus-surface-raised" style={{ background: preset.primary }} />
                <span className="w-5 h-5 rounded-full border-2 border-nexus-surface-raised" style={{ background: preset.secondary ?? preset.primary }} />
              </span>
              <span className="text-xs text-nexus-text-muted group-hover:text-nexus-text">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Live preview */}
      <div>
        <label className="block text-sm font-medium text-nexus-text mb-3">Live preview</label>
        <div className="bg-nexus-void border border-nexus-border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button className="px-4 py-2 rounded-lg font-medium text-sm" style={{ background: 'var(--color-nexus-primary)', color: 'var(--color-nexus-primary-text)' }}>
              Primary Button
            </button>
            <button className="px-4 py-2 rounded-lg font-medium text-sm border" style={{ borderColor: 'var(--color-nexus-secondary)', color: 'var(--color-nexus-secondary)' }}>
              Secondary Button
            </button>
            <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: 'var(--color-nexus-primary-muted)', color: 'var(--color-nexus-primary)' }}>
              Badge / Tag
            </span>
          </div>
          <div className="bg-nexus-surface border border-nexus-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-nexus-text font-medium text-sm">Sample card title</span>
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--color-nexus-success)', color: '#0A0A0A' }}>Active</span>
            </div>
            <p className="text-nexus-text-muted text-sm">This is how body text and cards will look throughout the dashboard with your chosen colors applied.</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-nexus-success)' }} /> Success</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-nexus-warning)' }} /> Warning</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-nexus-danger)' }} /> Danger</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-nexus-info)' }} /> Info</span>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-nexus-danger">{error}</p>}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          style={{ background: 'var(--color-nexus-primary)', color: 'var(--color-nexus-primary-text)' }}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
          {saved ? 'Saved' : 'Save Theme'}
        </button>
        {isDirty && (
          <button onClick={handleCancel} className="px-5 py-2.5 rounded-lg font-medium text-sm text-nexus-text-muted hover:text-nexus-text">
            Cancel
          </button>
        )}
        <button onClick={handleReset} disabled={saving} className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg font-medium text-sm text-nexus-text-muted hover:text-nexus-text ml-auto">
          <RotateCcw size={14} /> Reset to default
        </button>
      </div>
    </div>
  );
};
