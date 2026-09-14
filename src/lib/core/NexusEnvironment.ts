/**
 * Nexus Environment Manager
 * 
 * This module ensures the system is not locked into any specific vendor (like Firebase).
 * It provides a fallback mechanism (Standalone Mode) so the system can run independently
 * in any environment, even if external services are unavailable.
 */

export type EnvironmentMode = 'cloud' | 'standalone';

export interface StoreConfig {
  isConfigured: boolean;
  businessName: string;
  businessType: string;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    textColor: string;
    fontFamily: string;
    heroImage: string;
  };
  categories: string[];
  features: {
    requiresDelivery: boolean;
    requiresBooking: boolean;
    requires3DViewer: boolean;
    requiresBetaTesting: boolean;
  };
}

const DEFAULT_CONFIG: StoreConfig = {
  isConfigured: false,
  businessName: 'Luxe Fashion',
  businessType: 'Apparel & Fashion',
  theme: {
    primaryColor: '#111827', // Deep Charcoal (Trust, Premium, Authority)
    secondaryColor: '#D946EF', // Fuchsia/Rose (Action, Creativity, Excitement)
    backgroundColor: '#F9FAFB', // Off-white (Clean, Minimalist)
    textColor: '#1F2937',
    fontFamily: 'sans-serif',
    heroImage: 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&q=80',
  },
  categories: ['Men', 'Women', 'Shoes', 'Beauty', 'Winter', 'Summer', 'Sports', 'Accessories'],
  features: {
    requiresDelivery: true,
    requiresBooking: false,
    requires3DViewer: true,
    requiresBetaTesting: true,
  }
};

class NexusEnvironmentManager {
  private mode: EnvironmentMode = 'cloud';
  private isInitialized = false;
  private storeConfig: StoreConfig = DEFAULT_CONFIG;

  constructor() {
    this.checkEnvironment();
    this.loadStoreConfig();
  }

  private loadStoreConfig() {
    if (typeof window !== 'undefined') {
      const savedConfig = localStorage.getItem('NEXUS_STORE_CONFIG');
      if (savedConfig) {
        try {
          this.storeConfig = JSON.parse(savedConfig);
        } catch (e) {
          console.error("Failed to parse store config", e);
        }
      }
    }
  }

  public getStoreConfig(): StoreConfig {
    return this.storeConfig;
  }

  public setStoreConfig(config: Partial<StoreConfig>) {
    this.storeConfig = { ...this.storeConfig, ...config, isConfigured: true };
    if (typeof window !== 'undefined') {
      localStorage.setItem('NEXUS_STORE_CONFIG', JSON.stringify(this.storeConfig));
      window.dispatchEvent(new Event('nexus-config-updated'));
    }
  }

  public resetStoreConfig() {
    this.storeConfig = DEFAULT_CONFIG;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('NEXUS_STORE_CONFIG');
      window.dispatchEvent(new Event('nexus-config-updated'));
    }
  }

  /**
   * Checks the current environment and determines if we should run in Cloud or Standalone mode.
   */
  private checkEnvironment() {
    try {
      // Check if we have internet connection
      if (typeof window !== 'undefined' && !window.navigator.onLine) {
        this.mode = 'standalone';
        console.warn('[Nexus Env] No internet connection detected. Switching to Standalone Mode.');
        return;
      }

      // In a real scenario, we would also check if Firebase config is valid or if the server is reachable.
      // For now, we assume cloud unless explicitly forced or offline.
      let forceStandalone = false;
      if (typeof localStorage !== 'undefined') {
        forceStandalone = localStorage.getItem('NEXUS_FORCE_STANDALONE') === 'true';
      }
      if (forceStandalone) {
        this.mode = 'standalone';
        console.info('[Nexus Env] Forced Standalone Mode via local storage.');
      } else {
        this.mode = 'cloud';
      }
    } catch (e) {
      this.mode = 'standalone';
    } finally {
      this.isInitialized = true;
    }
  }

  public getMode(): EnvironmentMode {
    return this.mode;
  }

  public setMode(mode: EnvironmentMode) {
    this.mode = mode;
    if (typeof window !== 'undefined') {
      localStorage.setItem('NEXUS_FORCE_STANDALONE', mode === 'standalone' ? 'true' : 'false');
      // Reload to apply changes across the app
      window.location.reload();
    }
  }

  /**
   * Universal Storage Adapter
   * Falls back to localStorage if cloud DB is unavailable.
   */
  public async save(collection: string, id: string, data: any): Promise<void> {
    if (this.mode === 'standalone' && typeof localStorage !== 'undefined') {
      const key = `nexus_${collection}_${id}`;
      localStorage.setItem(key, JSON.stringify({ ...data, _updatedAt: Date.now() }));
      console.log(`[Nexus Env] Saved to local storage: ${key}`);
      return Promise.resolve();
    }
    // Cloud save logic would be handled by the caller (e.g., Firestore)
    return Promise.resolve();
  }

  public async get(collection: string, id: string): Promise<any | null> {
    if (this.mode === 'standalone' && typeof localStorage !== 'undefined') {
      const key = `nexus_${collection}_${id}`;
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    }
    return null;
  }
}

export const NexusEnv = new NexusEnvironmentManager();
