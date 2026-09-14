import { IStorageProvider } from './interfaces/IStorageProvider';

export class StorageRegistry {
  private activeProvider: IStorageProvider | null = null;
  private fallbacks: IStorageProvider[] = [];

  registerPrimary(provider: IStorageProvider) {
    this.activeProvider = provider;
    console.log(`[StorageRegistry] Primary storage configured: ${provider.name}`);
  }

  registerFallback(provider: IStorageProvider) {
    this.fallbacks.push(provider);
    console.log(`[StorageRegistry] Fallback storage added: ${provider.name}`);
  }

  async getEngine(): Promise<IStorageProvider> {
    if (!this.activeProvider) {
       throw new Error("No primary storage engine registered.");
    }

    const isHealthy = await this.activeProvider.ping().catch(() => false);
    if (isHealthy) {
      return this.activeProvider;
    }

    console.warn(`[StorageRegistry] Primary storage (${this.activeProvider.name}) is down. Checking fallbacks...`);
    
    for (const fallback of this.fallbacks) {
      const fallbackHealthy = await fallback.ping().catch(() => false);
      if (fallbackHealthy) {
        console.warn(`[StorageRegistry] Failing over to ${fallback.name}`);
        this.activeProvider = fallback; // Auto-failover
        return fallback;
      }
    }

    throw new Error("CATASTROPHIC FAILURE: All structured storage providers are down.");
  }
}

export const GlobalStorage = new StorageRegistry();
