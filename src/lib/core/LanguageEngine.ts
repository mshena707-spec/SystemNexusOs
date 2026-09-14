export class LanguageEngine {
    static supportedLanguages = ['en', 'bn'];
    static userLanguage = 'en';

    static setLanguage(lang: 'en' | 'bn') {
        if (this.supportedLanguages.includes(lang)) {
            this.userLanguage = lang;
            // Optionally persist to local storage
            if (typeof localStorage !== 'undefined') localStorage.setItem('nexus_lang', lang);
        }
    }

    static loadPersistedLanguage() {
        if (typeof localStorage !== 'undefined') {
            const l = localStorage.getItem('nexus_lang');
            if (l && this.supportedLanguages.includes(l)) {
                this.userLanguage = l as 'en' | 'bn';
            }
        }
    }

    static t(key: string): string {
        // Translation Dictionary
        const dict: Record<string, Record<string, string>> = {
            'dashboard': { 'en': 'Dashboard', 'bn': 'ড্যাশবোর্ড' },
            'orders': { 'en': 'Orders', 'bn': 'অর্ডার' },
            'revenue': { 'en': 'Revenue', 'bn': 'রাজস্ব' },
            'buy_now': { 'en': 'Buy Now', 'bn': 'এখনই কিনুন' }
        };

        if (dict[key] && dict[key][this.userLanguage]) {
            return dict[key][this.userLanguage];
        }
        return key; // fallback
    }
}
