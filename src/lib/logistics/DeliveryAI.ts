import { NexusUnifiedCore } from '../core/NexusUnifiedCore';

export interface AssignRiderRequest {
  orderId: string;
  vendorLocation: { lat: number, lng: number };
  customerLocation: { lat: number, lng: number };
  availableRiders: { id: string, name: string, location: { lat: number, lng: number }, rating: number, activeOrders: number }[];
}

export class DeliveryAI {
  static async suggestRider(request: AssignRiderRequest): Promise<{ riderId: string, estimatedTimeMinutes: number, reason: string }> {
    const prompt = `Analyze these riders and select the best one for order ${request.orderId}.
Vendor Location: ${JSON.stringify(request.vendorLocation)}
Customer Location: ${JSON.stringify(request.customerLocation)}
Available Riders:
${request.availableRiders.map(r => `- ${r.name} (ID: ${r.id}), Location: ${JSON.stringify(r.location)}, Rating: ${r.rating}, Active Orders: ${r.activeOrders}`).join('\n')}

Output JSON ONLY with keys: riderId, estimatedTimeMinutes, reason. Optimize for lowest active orders and proximity to vendor.`;

    try {
      const response = await NexusUnifiedCore.process(prompt, { agentRole: 'system' });
      // We assume response.text contains the JSON. Sanitize and parse.
      const sanitized = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(sanitized);
    } catch (e) {
      console.warn("[DeliveryAI] Failed to assign rider smartly. Falling back.", e);
      // Fallback logic
      const fallbackRider = request.availableRiders.sort((a,b) => a.activeOrders - b.activeOrders)[0] || { id: 'unknown_rider', name: 'Unknown' };
      return { riderId: fallbackRider.id, estimatedTimeMinutes: 45, reason: 'Fallback to least busy rider' };
    }
  }
}
