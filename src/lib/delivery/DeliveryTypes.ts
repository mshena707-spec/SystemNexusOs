/**
 * DELIVERY OS — Shared Types
 * Single source of truth for all delivery-related interfaces.
 */

export type RiderStatus = 'offline' | 'available' | 'on_delivery' | 'break';
export type OrderDeliveryStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Assigned'
  | 'PickedUp'
  | 'InTransit'
  | 'NearDestination'
  | 'Delivered'
  | 'Failed'
  | 'Cancelled';

export interface GpsPoint {
  lat: number;
  lng: number;
  accuracy?: number;   // metres
  heading?: number;    // 0–360 degrees
  speed?: number;      // m/s
  timestamp: number;   // Unix ms
}

export interface LiveRider {
  riderId: string;
  name: string;
  phone?: string;
  status: RiderStatus;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  lastSeen: Date;
  orderId?: string;
  batteryLevel?: number;
  totalDeliveries: number;
  successRate: number;       // 0–100
  avgDeliveryMinutes: number;
  performanceScore: number;  // 0–100
  isOnline: boolean;         // lastSeen < 2 min ago
}

export interface DeliveryOrder {
  id: string;
  riderId?: string;
  status: OrderDeliveryStatus;
  pickupLat: number;
  pickupLng: number;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryAddress: string;
  createdAt: Date;
  assignedAt?: Date;
  pickedUpAt?: Date;
  deliveredAt?: Date;
  estimatedDeliveryAt?: Date;
  slaMinutes: number;       // default 45
  items: any[];
  customerId: string;
}

export interface DeliveryTimeline {
  orderId: string;
  events: DeliveryTimelineEvent[];
}

export interface DeliveryTimelineEvent {
  status: OrderDeliveryStatus;
  timestamp: Date;
  note?: string;
  lat?: number;
  lng?: number;
  riderId?: string;
}

export interface RiderPerformance {
  riderId: string;
  period: 'today' | '7d' | '30d';
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  successRate: number;
  avgDeliveryMinutes: number;
  onTimeRate: number;        // % delivered within SLA
  totalKm: number;
  fraudFlags: number;
  performanceScore: number;  // composite 0–100
  grade: 'S' | 'A' | 'B' | 'C' | 'F';
}

export interface OrderBatch {
  batchId: string;
  riderId: string;
  orders: string[];          // order IDs
  createdAt: Date;
  totalStops: number;
  estimatedMinutes: number;
  routePoints: GpsPoint[];
}

export interface SLAAlert {
  orderId: string;
  riderId?: string;
  ageMinutes: number;
  slaMinutes: number;
  breachMinutes: number;
  severity: 'warning' | 'breach' | 'critical';
}
