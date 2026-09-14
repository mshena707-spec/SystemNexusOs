/**
 * DemandForecastEngine — thin facade
 *
 * `admin.routes.ts` was written against a module of this name that never
 * existed. The real, working implementation is `DemandForecastingEngine`
 * (src/lib/business-intelligence/forecasting/DemandForecastingEngine.ts) —
 * this file exposes it under the name/shape the route expects.
 */
import { DemandForecastingEngine, ProductDemandForecast } from './forecasting/DemandForecastingEngine';

export type { ProductDemandForecast };

export class DemandForecastEngine {
  /** GET /forecast/products?limit=10 */
  static async getTopForecasts(limit = 10): Promise<ProductDemandForecast[]> {
    const summary = await DemandForecastingEngine.forecastAll(14, limit);
    return summary.products
      .slice()
      .sort((a, b) => b.totalForecastUnits - a.totalForecastUnits)
      .slice(0, limit);
  }

  /** GET /forecast/products/:productId */
  static async getForecast(productId: string): Promise<ProductDemandForecast> {
    const { ProductRepository } = await import('../database/repositories/ProductRepository');
    const product = await ProductRepository.findById(productId);
    return DemandForecastingEngine.forecastProduct(productId, product?.name ?? productId, 14);
  }

  /** GET /forecast/restock-alerts */
  static async getRestockAlerts() {
    return DemandForecastingEngine.getRestockAlerts(14);
  }
}
