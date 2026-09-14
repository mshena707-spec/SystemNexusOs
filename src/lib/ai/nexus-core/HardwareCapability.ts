/**
 * NEXUS HARDWARE CAPABILITY DETECTOR
 * Intelligently analyzes the client's local hardware (RAM, Cores, GPU) to 
 * prevent heavy AI models from crashing mobile or low-end devices.
 */
export class HardwareCapability {
  /**
   * Evaluates if the current device can handle a true Generative SLM (e.g., 2GB-4GB models)
   */
  public static canRunGenerativeSLM(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false; // Server-side rendering failsafe
    }

    let memoryGB = 4; // Assume 4GB fallback if API isn't supported
    if ('deviceMemory' in navigator) {
      memoryGB = (navigator as any).deviceMemory || 4;
    }

    const cores = navigator.hardwareConcurrency || 4;
    const hasWebGPU = 'gpu' in navigator;
    
    console.log(`[Nexus Hardware] Cores: ${cores}, RAM: >=${memoryGB}GB, WebGPU: ${hasWebGPU}`);

    // LOGIC: True Generative AI requires at least 8GB of RAM and ideally WebGPU.
    // We allow 4GB + WebGPU as an extreme minimum. Devices below this will be rejected.
    if (memoryGB >= 8 || (memoryGB >= 4 && hasWebGPU)) {
      return true;
    }

    return false;
  }

  public static isMobileDevice(): boolean {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }
}
