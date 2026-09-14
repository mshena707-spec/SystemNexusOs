import { NexusUnifiedCore } from '../core/NexusUnifiedCore';

export interface SalesContext {
  userId: string;
  cartTotal: number;
  viewedProducts: string[];
  lastPurchaseDate?: string;
}

export class AISalesAgent {
  static async getCheckoutRecommendation(context: SalesContext): Promise<{ message: string, suggestedProductId?: string }> {
    const prompt = `User has $${context.cartTotal} in cart. Viewed: ${context.viewedProducts.join(', ')}. Act as a helpful smart sales agent. Give a very short 1-sentence upsell message. Do not be pushy. Suggest an accessory or complementary item based on the viewed items.`;
    
    try {
      const response = await NexusUnifiedCore.process(prompt, { agentRole: 'sales_agent', userId: context.userId });
      
      let suggestedProductId;
      // Heuristic string matching for simple local fallback logic if needed
      if (response.text.toLowerCase().includes('jacket')) suggestedProductId = 'product_1'; // Just an example ID
      
      return {
        message: response.text,
        suggestedProductId
      };
    } catch (e) {
      console.warn("AISalesAgent error", e);
      return { message: "Before you check out, have you seen our latest accessories?" };
    }
  }
}
