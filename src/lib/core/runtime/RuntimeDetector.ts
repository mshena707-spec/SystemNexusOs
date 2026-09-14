export type RuntimeOS = 'windows' | 'linux' | 'macos' | 'android' | 'ios' | 'unknown';
export type RuntimeEnvironment = 'browser' | 'node' | 'electron' | 'termux' | 'cloud_run' | 'docker';

export class RuntimeDetector {
  static getOS(): RuntimeOS {
    if (typeof window !== 'undefined' && window.navigator) {
      const userAgent = window.navigator.userAgent.toLowerCase();
      if (userAgent.includes('windows')) return 'windows';
      if (userAgent.includes('android')) return 'android';
      if (userAgent.includes('iphone') || userAgent.includes('ipad')) return 'ios';
      if (userAgent.includes('mac os')) return 'macos';
      if (userAgent.includes('linux')) return 'linux';
    }
    
    if (typeof process !== 'undefined') {
      if (process.platform === 'win32') return 'windows';
      if (process.platform === 'darwin') return 'macos';
      if (process.platform === 'linux') {
        if (process.env.PREFIX?.includes('com.termux')) return 'android'; // Termux detection
        return 'linux';
      }
    }
    
    return 'unknown';
  }

  static getEnvironment(): RuntimeEnvironment {
    if (typeof process !== 'undefined' && process.env) {
      // Check for strict node environments
      if (process.versions && process.versions.electron) return 'electron';
      if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB) return 'cloud_run';
      if (process.env.PREFIX?.includes('com.termux')) return 'termux';
      if (process.env.DOCKER_ENV) return 'docker'; // Custom docker flag
      if (!(process as any).browser) return 'node';
    }
    return 'browser';
  }

  static hasInternetConnection(): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine !== undefined) {
      return navigator.onLine; // Browser API
    }
    return true; // Assume true on servers unless ping fails later
  }

  static getCapabilities() {
    return {
      isTouchDevice: typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0),
      hasFileSystemAccess: typeof window !== 'undefined' && 'showOpenFilePicker' in window,
      isOfflineModePossible: typeof window !== 'undefined' && 'serviceWorker' in navigator,
      hardwareConcurrency: typeof window !== 'undefined' ? navigator.hardwareConcurrency : 4,
      deviceMemory: typeof window !== 'undefined' && (navigator as any).deviceMemory ? (navigator as any).deviceMemory : 4,
      hasWebGPU: typeof navigator !== 'undefined' && 'gpu' in navigator
    };
  }
}
