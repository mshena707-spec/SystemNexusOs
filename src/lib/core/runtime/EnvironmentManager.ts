import { RuntimeDetector, RuntimeOS, RuntimeEnvironment } from './RuntimeDetector';

export interface SystemProfile {
  os: RuntimeOS;
  environment: RuntimeEnvironment;
  capabilities: {
    isTouchDevice: boolean;
    hasFileSystemAccess: boolean;
    isOfflineModePossible: boolean;
    hardwareConcurrency: number;
    deviceMemory: number;
  };
  performanceMode: 'eco' | 'balanced' | 'performance';
}

export class EnvironmentManager {
  private static profile: SystemProfile;

  static initProfile() {
    if (this.profile) return;
    
    const capabilities = RuntimeDetector.getCapabilities();
    
    // Auto-adjust performance mode
    let performanceMode: 'eco' | 'balanced' | 'performance' = 'balanced';
    if (capabilities.deviceMemory <= 4 || capabilities.hardwareConcurrency <= 4) {
      performanceMode = 'eco'; // e.g., low-end Android or small VPS
    } else if (capabilities.deviceMemory >= 16 && capabilities.hardwareConcurrency >= 8) {
      performanceMode = 'performance'; // e.g., Desktop or strong server
    }

    this.profile = {
      os: RuntimeDetector.getOS(),
      environment: RuntimeDetector.getEnvironment(),
      capabilities,
      performanceMode
    };

    console.log("[EnvironmentManager] Auto-configured profile:", this.profile);
  }

  static getProfile(): SystemProfile {
    if (!this.profile) this.initProfile();
    return this.profile;
  }

  static isLowEndDevice(): boolean {
    return this.getProfile().performanceMode === 'eco';
  }
}
