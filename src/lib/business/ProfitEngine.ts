export class ProfitEngine {
    static calculateOptimalMargin(baseCost: number, category: string): number {
        // Different categories hold different premium markup potential
        if (category.toLowerCase() === 'electronics') return baseCost * 1.25; // 25% margin
        if (category.toLowerCase() === 'fashion') return baseCost * 1.50; // 50% margin
        if (category.toLowerCase() === 'software') return baseCost * 3.00; // 200% margin
        return baseCost * 1.30;
    }

    static analyzeLossLeaks(refundCount: number, totalOrders: number): string {
        const refundRate = refundCount / totalOrders;
        if (refundRate > 0.10) return "WARNING: Refund rate exceeds 10%. Inspect product quality issues to reduce loss.";
        return "Leakage within acceptable parameters.";
    }
}
