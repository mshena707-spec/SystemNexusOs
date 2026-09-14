import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { derivePalette, DerivedPalette, BrandInput } from '../lib/theme/colorEngine';

interface ThemeContextType {
  primary: string;
  secondary: string;
  isLoading: boolean;
  /** Applies colors to the live DOM immediately, without saving — for a settings-page color picker to preview against. */
  previewTheme: (primary: string, secondary?: string) => void;
  /** Persists to the backend (so every device/admin sees it) and applies it. */
  saveTheme: (primary: string, secondary?: string) => Promise<void>;
  /** Discards any unsaved preview and re-applies the last saved theme. */
  cancelPreview: () => void;
  resetToDefault: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType>({
  primary: '#E67E22',
  secondary: '#2F5233',
  isLoading: true,
  previewTheme: () => {},
  saveTheme: async () => {},
  cancelPreview: () => {},
  resetToDefault: async () => {},
});

export const useTheme = () => useContext(ThemeContext);

function applyDarkPalette(p: DerivedPalette) {
  const root = document.documentElement.style;
  root.setProperty('--color-nexus-primary', p.primary);
  root.setProperty('--color-nexus-primary-hover', p.primaryHover);
  root.setProperty('--color-nexus-primary-active', p.primaryActive);
  root.setProperty('--color-nexus-primary-muted', p.primaryMuted);
  root.setProperty('--color-nexus-primary-text', p.primaryText);
  root.setProperty('--color-nexus-secondary', p.secondary);
  root.setProperty('--color-nexus-secondary-hover', p.secondaryHover);
  root.setProperty('--color-nexus-secondary-text', p.secondaryText);
  root.setProperty('--color-nexus-void', p.surfaceVoid);
  root.setProperty('--color-nexus-surface', p.surfaceBase);
  root.setProperty('--color-nexus-surface-raised', p.surfaceRaised);
  root.setProperty('--color-nexus-border', p.borderDefault);
  root.setProperty('--color-nexus-border-strong', p.borderStrong);
  root.setProperty('--color-nexus-text', p.textPrimary);
  root.setProperty('--color-nexus-text-muted', p.textMuted);
  root.setProperty('--color-nexus-text-faint', p.textFaint);
  root.setProperty('--color-nexus-success', p.success);
  root.setProperty('--color-nexus-danger', p.danger);
  root.setProperty('--color-nexus-warning', p.warning);
  root.setProperty('--color-nexus-info', p.info);
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [saved, setSaved] = useState<BrandInput>({ primary: '#E67E22', secondary: '#2F5233' });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/theme');
        if (res.ok) {
          const data = await res.json();
          const theme: BrandInput = { primary: data.theme.primary, secondary: data.theme.secondary };
          setSaved(theme);
          applyDarkPalette(derivePalette({ ...theme, mode: 'dark' }));
        }
      } catch {
        // Network/backend not ready yet — the CSS defaults in index.css already
        // render a complete, good-looking theme, so there's nothing broken here.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const previewTheme = useCallback((primary: string, secondary?: string) => {
    applyDarkPalette(derivePalette({ primary, secondary, mode: 'dark' }));
  }, []);

  const cancelPreview = useCallback(() => {
    applyDarkPalette(derivePalette({ ...saved, mode: 'dark' }));
  }, [saved]);

  const saveTheme = useCallback(async (primary: string, secondary?: string) => {
    const res = await fetch('/api/admin/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary, secondary }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save theme');
    const newSaved = { primary, secondary };
    setSaved(newSaved);
    applyDarkPalette(derivePalette({ ...newSaved, mode: 'dark' }));
  }, []);

  const resetToDefault = useCallback(async () => {
    const res = await fetch('/api/admin/theme/reset', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reset theme');
    const data = await res.json();
    setSaved(data);
    applyDarkPalette(derivePalette({ ...data, mode: 'dark' }));
  }, []);

  return (
    <ThemeContext.Provider value={{
      primary: saved.primary, secondary: saved.secondary ?? '#2F5233', isLoading,
      previewTheme, saveTheme, cancelPreview, resetToDefault,
    }}>
      {children}
    </ThemeContext.Provider>
  );
};
