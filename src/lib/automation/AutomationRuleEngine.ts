/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  AUTOMATION RULE ENGINE — Phase Q                                    ║
 * ║                                                                       ║
 * ║  Owner-defined IF→THEN rules ("Visual Automation Builder"). This is  ║
 * ║  DISTINCT from the existing src/lib/automation/AutomationEngine.ts,  ║
 * ║  which handles fixed, hardcoded, event-triggered reactions (order    ║
 * ║  created, payment failed, etc.) that ship with the system. This      ║
 * ║  engine handles rules the OWNER creates at runtime through the admin ║
 * ║  UI or a natural-language command — no code changes required.       ║
 * ║                                                                       ║
 * ║  HONESTY NOTE on conditions: every condition type here queries real  ║
 * ║  existing engines (ChurnPredictor, StockAlertEngine,                 ║
 * ║  RiderPerformanceEngine) — nothing here invents new fabricated       ║
 * ║  scoring. If those engines have known limitations (e.g.              ║
 * ║  ChurnPredictor's in-series customer scan), this inherits them; it   ║
 * ║  does not paper over them.                                           ║
 * ║                                                                       ║
 * ║  HONESTY NOTE on scheduling: unlike TaskSchedulerApp (Phase P,       ║
 * ║  documented gap — "Run Now" only, no auto-run), this engine IS       ║
 * ║  wired into a real node-cron job in server.ts (every 30 min) in      ║
 * ║  addition to manual "Run Now". Active rules genuinely run on their   ║
 * ║  own.                                                                 ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { NexusDB } from '../database/NexusDB';
import { AuditLog } from '../security/audit/ImmutableAuditLog';
import { CouponEngine } from '../promotions/CouponEngine';
import { ChurnPredictor } from '../marketing/ChurnPredictor';
import { StockAlertEngine } from '../procurement/StockAlertEngine';
import { RiderPerformanceEngine } from '../delivery/RiderPerformanceEngine';

export type ConditionType = 'customer_inactive' | 'low_stock' | 'rider_performance_low';
export type ActionType = 'issue_coupon' | 'alert_admin' | 'notify_supplier';

export const CONDITION_TYPES: ConditionType[] = ['customer_inactive', 'low_stock', 'rider_performance_low'];
export const ACTION_TYPES: ActionType[] = ['issue_coupon', 'alert_admin', 'notify_supplier'];

export interface MatchedTarget {
  id: string;
  label: string;
  meta: Record<string, any>;
}

export interface RunResult {
  matched: number;
  actioned: boolean;
  summary: string;
  error?: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  conditionType: ConditionType;
  conditionParams: Record<string, any>;
  actionType: ActionType;
  actionParams: Record<string, any>;
  active: boolean;
  source: 'manual' | 'nl_command';
  originalCommand?: string;
  createdBy: string;
  createdAt: string;
  lastRunAt?: string;
  lastRunResult?: RunResult;
}

function validateTypes(conditionType: string, actionType: string) {
  if (!CONDITION_TYPES.includes(conditionType as ConditionType)) {
    throw new Error(`Unknown condition type "${conditionType}". Allowed: ${CONDITION_TYPES.join(', ')}`);
  }
  if (!ACTION_TYPES.includes(actionType as ActionType)) {
    throw new Error(`Unknown action type "${actionType}". Allowed: ${ACTION_TYPES.join(', ')}`);
  }
  // Guardrail: coupons can only be issued to customer-shaped targets.
  if (actionType === 'issue_coupon' && conditionType !== 'customer_inactive') {
    throw new Error('issue_coupon action currently only supports the customer_inactive condition');
  }
}

export class AutomationRuleEngine {
  static async createRule(input: {
    name: string;
    description?: string;
    conditionType: ConditionType;
    conditionParams: Record<string, any>;
    actionType: ActionType;
    actionParams: Record<string, any>;
    active?: boolean;
    source?: 'manual' | 'nl_command';
    originalCommand?: string;
    createdBy: string;
  }): Promise<string> {
    validateTypes(input.conditionType, input.actionType);

    const rule: Omit<AutomationRule, 'id'> = {
      name: input.name,
      description: input.description,
      conditionType: input.conditionType,
      conditionParams: input.conditionParams ?? {},
      actionType: input.actionType,
      actionParams: input.actionParams ?? {},
      active: input.active ?? true,
      source: input.source ?? 'manual',
      originalCommand: input.originalCommand,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };

    const id = await NexusDB.add('automation_rules', rule);

    await AuditLog.record(
      'admin.action',
      { id: input.createdBy, type: 'user' },
      { ruleId: id, name: input.name, conditionType: input.conditionType, actionType: input.actionType, source: rule.source },
      { action: 'automation_rule.created', resource: `automation_rules/${id}`, outcome: 'success' },
    );

    return id;
  }

  static async listRules(): Promise<AutomationRule[]> {
    const rows = await NexusDB.find('automation_rules', { orderBy: 'createdAt', orderDir: 'desc', limit: 200 });
    return rows as unknown as AutomationRule[];
  }

  static async setActive(id: string, active: boolean, actorId: string): Promise<void> {
    await NexusDB.update('automation_rules', id, { active });
    await AuditLog.record(
      'admin.action', { id: actorId, type: 'user' }, { ruleId: id, active },
      { action: 'automation_rule.toggled', resource: `automation_rules/${id}`, outcome: 'success' },
    );
  }

  static async deleteRule(id: string, actorId: string): Promise<void> {
    await NexusDB.delete('automation_rules', id);
    await AuditLog.record(
      'admin.action', { id: actorId, type: 'user' }, { ruleId: id },
      { action: 'automation_rule.deleted', resource: `automation_rules/${id}`, outcome: 'success' },
    );
  }

  /** Dry-run: shows what WOULD match, without taking any action. Used for the builder UI preview. */
  static async evaluateCondition(conditionType: ConditionType, conditionParams: Record<string, any>): Promise<MatchedTarget[]> {
    switch (conditionType) {
      case 'customer_inactive': {
        const minDays = Number(conditionParams.minDaysInactive ?? 30);
        // Over-scan via ChurnPredictor's real candidate scan (low threshold to get a broad set),
        // then filter to the actual inactivity window the owner asked for.
        const candidates = await ChurnPredictor.getAtRiskCustomers(1, 500);
        return candidates
          .filter(c => c.daysSinceLastOrder >= minDays)
          .map(c => ({ id: c.userId, label: c.userId, meta: { daysSinceLastOrder: c.daysSinceLastOrder } }));
      }
      case 'low_stock': {
        const maxDaysRemaining = Number(conditionParams.maxDaysOfStockRemaining ?? 3);
        const alerts = await StockAlertEngine.runAlerts(500);
        return alerts
          .filter(a => a.daysOfStockRemaining <= maxDaysRemaining)
          .map(a => ({
            id: a.productId, label: a.productName,
            meta: { currentStock: a.currentStock, daysOfStockRemaining: a.daysOfStockRemaining, supplierId: a.supplierId, supplierName: a.supplierName, severity: a.severity },
          }));
      }
      case 'rider_performance_low': {
        const maxScore = Number(conditionParams.maxPerformanceScore ?? 50);
        const all = await RiderPerformanceEngine.computeAllRiders('7d');
        return all
          .filter(r => r.performanceScore <= maxScore)
          .map(r => ({ id: r.riderId, label: r.riderId, meta: { performanceScore: r.performanceScore, grade: r.grade } }));
      }
      default:
        return [];
    }
  }

  private static async executeAction(rule: AutomationRule, targets: MatchedTarget[], actorId: string): Promise<RunResult> {
    if (targets.length === 0) {
      return { matched: 0, actioned: false, summary: 'No matching targets — no action taken.' };
    }

    switch (rule.actionType) {
      case 'issue_coupon': {
        const type = rule.actionParams.discountType === 'fixed' ? 'fixed' : 'percent';
        const value = Number(rule.actionParams.discountValue ?? 10);
        const expiresInDays = rule.actionParams.expiresInDays ? Number(rule.actionParams.expiresInDays) : 14;
        const customerIds = targets.map(t => t.id);

        const coupon = await CouponEngine.create({
          type, value,
          reason: `Automation rule: ${rule.name}`,
          targetCustomerIds: customerIds,
          maxRedemptions: customerIds.length,
          expiresInDays,
          source: 'automation_rule',
          sourceRuleId: rule.id,
          createdBy: actorId,
          codePrefix: 'AUTO',
        });

        return {
          matched: targets.length, actioned: true,
          summary: `Issued coupon ${coupon.code} (${type === 'percent' ? value + '%' : value}) to ${targets.length} customer(s), expires in ${expiresInDays} days.`,
        };
      }

      case 'alert_admin': {
        const preview = targets.slice(0, 20).map(t => `${t.label} (${JSON.stringify(t.meta)})`).join('; ');
        const more = targets.length > 20 ? ` and ${targets.length - 20} more` : '';
        const message = `Rule "${rule.name}" matched ${targets.length} item(s): ${preview}${more}`;

        await NexusDB.add('admin_alerts', {
          ruleId: rule.id, ruleName: rule.name, message, targetCount: targets.length,
          targets: targets.slice(0, 50) as unknown as Record<string, any>[], createdAt: new Date().toISOString(), read: false,
        });

        return { matched: targets.length, actioned: true, summary: message };
      }

      case 'notify_supplier': {
        // Group low-stock targets by supplier — bundled, not one notification per product.
        const bySupplier = new Map<string, { supplierName: string; items: MatchedTarget[] }>();
        for (const t of targets) {
          const supplierId = t.meta.supplierId || 'unassigned';
          const entry = bySupplier.get(supplierId) ?? { supplierName: t.meta.supplierName || 'Unassigned', items: [] as MatchedTarget[] };
          entry.items.push(t);
          bySupplier.set(supplierId, entry);
        }

        const notes: string[] = [];
        for (const [supplierId, entry] of bySupplier) {
          const itemList = entry.items.map(i => `${i.label} (${i.meta.currentStock} left, ~${i.meta.daysOfStockRemaining}d remaining)`).join(', ');
          const note = `Restock needed from ${entry.supplierName}: ${itemList}`;
          notes.push(note);
          await NexusDB.add('admin_alerts', {
            ruleId: rule.id, ruleName: rule.name, message: note, supplierId,
            targetCount: entry.items.length, createdAt: new Date().toISOString(), read: false,
          });
        }

        return { matched: targets.length, actioned: true, summary: notes.join(' | ') };
      }

      default:
        return { matched: targets.length, actioned: false, summary: 'Unknown action type', error: 'unknown_action' };
    }
  }

  /** Evaluate condition + execute action for one rule, recording the result. Used by both manual "Run Now" and the cron job. */
  static async runRule(ruleId: string, actorId = 'system_cron'): Promise<RunResult> {
    const ruleRaw = await NexusDB.get('automation_rules', ruleId);
    if (!ruleRaw) throw new Error('Rule not found');
    const rule = ruleRaw as unknown as AutomationRule;
    rule.id = ruleId;

    let result: RunResult;
    try {
      const targets = await this.evaluateCondition(rule.conditionType, rule.conditionParams);
      result = await this.executeAction(rule, targets, actorId);
    } catch (err: any) {
      result = { matched: 0, actioned: false, summary: 'Rule execution failed', error: err.message };
    }

    await NexusDB.update('automation_rules', ruleId, {
      lastRunAt: new Date().toISOString(),
      lastRunResult: result,
    });

    await AuditLog.record(
      'admin.action',
      { id: actorId, type: actorId === 'system_cron' ? 'system' : 'user' },
      { ruleId, ruleName: rule.name, ...result },
      { action: 'automation_rule.executed', resource: `automation_rules/${ruleId}`, outcome: result.error ? 'failure' : 'success' },
    );

    return result;
  }

  /** Called by the real node-cron job in server.ts. One rule's failure does not block the others. */
  static async runAllActiveRules(): Promise<{ ranCount: number; errors: number }> {
    const rules = await this.listRules();
    const active = rules.filter(r => r.active);
    let errors = 0;
    for (const rule of active) {
      try {
        const result = await this.runRule(rule.id, 'system_cron');
        if (result.error) errors++;
      } catch {
        errors++;
      }
    }
    return { ranCount: active.length, errors };
  }
}
