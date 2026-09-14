export class MobileOptimizationEngine {
  static isMobileDevice(): boolean {
      if (typeof window === 'undefined') return false;
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
  }

  static get3DRenderQuality(): 'high' | 'low' | 'off' {
      if (typeof window === 'undefined') return 'high';
      
      // Phase 130 logic: disable heavy 3D on mobile or slow connections
      const conn = (navigator as any).connection;
      if (conn && (conn.saveData || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')) {
          return 'off';
      }

      if (this.isMobileDevice()) {
          return 'low';
      }

      return 'high';
  }

  static shouldReduceAnimations(): boolean {
      if (typeof window === 'undefined') return false;
      return window.matchMedia(`(prefers-reduced-motion: reduce)`).matches || this.isMobileDevice();
  }
}
