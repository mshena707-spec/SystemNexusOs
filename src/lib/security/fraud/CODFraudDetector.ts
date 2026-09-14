/**
 * CODFraudDetector — Cash-on-Delivery Fraud Prevention
 * Documented in SYSTEM_ARCHITECTURE.md Phase 4 — now implemented.
 * Risk scoring based on IP velocity, cancellation history, blocklist, account age.
 */

import { NexusDB } from "../../database/NexusDB";
import { ImmutableAuditLog } from "../audit/ImmutableAuditLog";
import { EventBus } from "../../core/events/NexusEventBus";

export interface CODOrder {
  orderId: string; userId: string; ipAddress: string; phone: string;
  deliveryAddress: string; orderTotal: number; itemCount: number;
  isNewAccount: boolean; accountAgeDays: number; userAgent: string;
}

export interface FraudCheckResult {
  orderId: string; riskScore: number;
  action: "allow" | "review" | "block";
  signals: string[]; details: Record<string, unknown>; checkedAt: string;
}

export class CODFraudDetector {
  private static readonly FRAUD_COL = "cod_fraud_checks";
  private static readonly BLOCK_COL = "fraud_blocklist";
  private static readonly BLOCK_THRESHOLD = 70;
  private static readonly REVIEW_THRESHOLD = 40;

  static async assess(order: CODOrder): Promise<FraudCheckResult> {
    const signals: string[] = [];
    const details: Record<string, unknown> = {};
    let riskScore = 0;

    // IP velocity check
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const recent = await NexusDB.find(this.FRAUD_COL, {
      where: [{ field: "ipAddress", op: "==" as const, value: order.ipAddress }], limit: 20,
    });
    const todayCount = recent.filter(o => (o.checkedAt as string) >= since24h).length;
    details.ipOrdersToday = todayCount;
    if (todayCount >= 3) {
      signals.push(`IP placed ${todayCount} COD orders in 24h`);
      riskScore += Math.min(40, todayCount * 15);
    }

    // Cancellation history
    const cancelled = await NexusDB.find("orders", {
      where: [{ field: "userId", op: "==" as const, value: order.userId },
               { field: "status", op: "==" as const, value: "cancelled" }], limit: 20,
    });
    details.cancellations = cancelled.length;
    if (cancelled.length > 2) {
      signals.push(`${cancelled.length} cancelled orders`);
      riskScore += Math.min(35, cancelled.length * 12);
    }

    // Blocklist check
    const phoneBlock = await NexusDB.find(this.BLOCK_COL, {
      where: [{ field: "value", op: "==" as const, value: order.phone }], limit: 1,
    });
    if (phoneBlock.length > 0) {
      signals.push("Phone is on fraud blocklist");
      details.phoneBlocked = true;
      riskScore += 60;
    }

    // New account + high value
    if (order.isNewAccount && order.orderTotal > 2500) {
      signals.push(`New account (${order.accountAgeDays}d) placing high-value COD (৳${order.orderTotal})`);
      riskScore += 25;
    }

    // High value + young account
    if (order.orderTotal > 5000 && order.accountAgeDays < 30) {
      signals.push(`High-value COD (৳${order.orderTotal}) from account <30 days old`);
      riskScore += 20;
    }

    riskScore = Math.min(100, riskScore);
    const action: FraudCheckResult["action"] =
      riskScore >= this.BLOCK_THRESHOLD ? "block" :
      riskScore >= this.REVIEW_THRESHOLD ? "review" : "allow";

    const result: FraudCheckResult = {
      orderId: order.orderId, riskScore, action, signals, details,
      checkedAt: new Date().toISOString(),
    };

    await NexusDB.set(this.FRAUD_COL, order.orderId, {
      ...result, userId: order.userId, ipAddress: order.ipAddress,
      phone: order.phone, orderTotal: order.orderTotal,
    });

    if (action !== "allow") {
      EventBus.emit("fraud.cod_risk", { orderId: order.orderId, userId: order.userId, riskScore, action, signals });
      await ImmutableAuditLog.record(
        `cod_fraud_${action}`,
        { id: order.userId, type: 'user' },
        { orderId: order.orderId, riskScore, signals },
        { resource: 'orders', severity: action === 'block' ? 'critical' : 'warn' },
      );
    }

    return result;
  }

  static async addToBlocklist(type: "phone" | "ip" | "userId", value: string, reason: string, addedBy: string): Promise<void> {
    const id = `block_${type}_${Date.now()}`;
    await NexusDB.set(this.BLOCK_COL, id, { type, value, reason, addedBy, addedAt: new Date().toISOString(), active: true });
    await ImmutableAuditLog.record(
      'fraud_blocklist_add',
      { id: addedBy, type: 'user' },
      { type, value: value.slice(0, 6) + '***', reason },
      { resource: 'fraud_blocklist', severity: 'warn' },
    );
  }

  static async getStats(): Promise<{ total: number; blocked: number; reviewed: number; blockRate: number }> {
    const all = await NexusDB.find(this.FRAUD_COL, { orderBy: "checkedAt", orderDir: "desc", limit: 1000 }) as FraudCheckResult[];
    const blocked = all.filter(r => r.action === "block").length;
    const reviewed = all.filter(r => r.action === "review").length;
    return { total: all.length, blocked, reviewed, blockRate: all.length ? Math.round(blocked / all.length * 100) : 0 };
  }
}
