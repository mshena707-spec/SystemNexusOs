/**
 * PHASE 4: DYNAMIC THEME ENGINE
 * Calculates and provides scientific colors for UI rendering based on category, context, etc.
 */

export type ThemePalette = {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    success: string;
    warning: string;
    textMain: string;
    textMuted: string;
    mode: 'light' | 'dark';
};

const THEMES: Record<string, ThemePalette> = {
    fashion: {
        primary: '#E5E0D8',    // Soft luxury beige
        secondary: '#C8A97E',  // Gold accent
        background: '#FAF9F6', // Off-white
        surface: '#FFFFFF',
        success: '#2E5A44',
        warning: '#8C3B3B',
        textMain: '#1A1A1A',
        textMuted: '#666666',
        mode: 'light'
    },
    grocery: {
        primary: '#4CAF50',    // Organic green
        secondary: '#8BC34A',  // Light green
        background: '#F1F8E9', // Very light green bg
        surface: '#FFFFFF',
        success: '#388E3C',
        warning: '#F57C00',
        textMain: '#212121',
        textMuted: '#757575',
        mode: 'light'
    },
    tech: {
        primary: '#00D8FF',    // Neon cyan
        secondary: '#005AC6',  // Deep blue
        background: '#0B0F19', // Very dark blue/black
        surface: '#151C2C',    // Slightly lighter for cards
        success: '#00E676',
        warning: '#FF1744',
        textMain: '#FFFFFF',
        textMuted: '#A0AABF',
        mode: 'dark'
    },
    healthcare: {
        primary: '#1976D2',    // Clean blue
        secondary: '#64B5F6',  // Light blue
        background: '#F5F5F6', // Pure medical off-white
        surface: '#FFFFFF',
        success: '#43A047',
        warning: '#E53935',
        textMain: '#263238',
        textMuted: '#78909C',
        mode: 'light'
    },
    default: {
        primary: '#2563EB',
        secondary: '#3B82F6',
        background: '#F8FAFC',
        surface: '#FFFFFF',
        success: '#10B981',
        warning: '#EF4444',
        textMain: '#0F172A',
        textMuted: '#64748B',
        mode: 'light'
    }
};

export class ThemeEngine {
    private static currentTheme: ThemePalette = THEMES.default;
    private static listeners: ((theme: ThemePalette) => void)[] = [];

    // Phase 129: Emotional Adaptation
    static adaptToEmotion(sentimentScore: number) {
        if (sentimentScore < 0.3) {
            // User is frustrated, switch to calming colors (Healthcare/Blue)
            this.setThemeByCategory('healthcare');
        }
    }

    static setThemeByCategory(category: string) {
        const key = category.toLowerCase();
        if (THEMES[key]) {
            this.currentTheme = THEMES[key];
        } else {
            this.currentTheme = THEMES.default;
        }
        this.notify();
    }

    static setMode(mode: 'light' | 'dark') {
       if (this.currentTheme.mode !== mode) {
           this.currentTheme = {
               ...this.currentTheme,
               mode,
               background: mode === 'dark' ? '#0a0a0a' : '#ffffff',
               surface: mode === 'dark' ? '#111111' : '#f5f5f5',
               textMain: mode === 'dark' ? '#ffffff' : '#000000',
               textMuted: mode === 'dark' ? '#888888' : '#666666'
           };
           this.notify();
       }
    }

    static getTheme(): ThemePalette {
        return this.currentTheme;
    }

    static subscribe(callback: (theme: ThemePalette) => void) {
        this.listeners.push(callback);
        callback(this.currentTheme);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private static notify() {
        this.listeners.forEach(l => l(this.currentTheme));
        this.applyToDOM();
    }

    // Optionally apply CSS variables if needed
    static applyToDOM() {
        const root = document.documentElement;
        // Inject global transition for Phase 129
        root.style.transition = 'background-color 0.5s ease, color 0.5s ease';
        
        Object.entries(this.currentTheme).forEach(([key, value]) => {
            if (key !== 'mode') {
                root.style.setProperty(`--theme-${key}`, value as string);
            }
        });
        
        if (this.currentTheme.mode === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    }
}
