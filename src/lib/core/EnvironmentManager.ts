/**
 * PHASE 5: SELF-ADAPTIVE INFRASTRUCTURE
 * Auto-detects runtime environment (Local, Cloud, Serverless).
 */
export type EnvType = 'local' | 'cloud' | 'docker' | 'serverless';

export class EnvironmentManager {
  static getEnvironmentType(): EnvType {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
      if (process.env.CLOUD_SERVICE) return 'cloud';
      if (process.env.KUBERNETES_SERVICE_HOST) return 'docker';
      return 'serverless';
    }
    return 'local';
  }

  static isProduction(): boolean {
    return this.getEnvironmentType() !== 'local';
  }

  static getRequiredConfigs(): string[] {
    return [
      'DATABASE_URL',
      'API_GATEWAY_URL',
      'PRIMARY_REDIS_URL'
    ];
  }
}
