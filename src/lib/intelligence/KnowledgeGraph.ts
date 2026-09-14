/**
 * PHASE 57: KNOWLEDGE GRAPH ENGINE
 *
 * Extended during CTO Audit Part 6 response (2026-07-22) — CTO Audit Part 5
 * (Memory & Knowledge System) found this file already existed but was
 * in-memory only (a Map — doesn't persist, doesn't survive a restart, doesn't
 * share state across horizontally-scaled instances) and unused (zero
 * importers anywhere). CTO Audit Part 6, section 19 ("Business Knowledge
 * Graph... Customer → Order → Product → Supplier... AI will understand all
 * relationships") asks for exactly what this file's shape already was — the
 * fix is persistence and real multi-hop traversal, not a rewrite. Extending
 * this file rather than creating a second, competing graph implementation —
 * this codebase has a well-documented history (docs/governance/
 * TECHNICAL_DEBT_REGISTER.md) of exactly that duplication pattern.
 *
 * STILL NOT WIRED into any real event handler as of this change — the audit's
 * own Customer→Order→Product→Complaint example requires something (e.g.
 * AutomationEngine's order.created/order.paid handlers) to actually call
 * addNode/linkNodes as those events fire. That integration is a real,
 * separate follow-up — see docs/architecture/MARKETPLACE_BUSINESS_LOGIC.md.
 */
import { NexusDB } from '../database/NexusDB';
import { logger } from '../core/logging/NexusLogger';

const log = logger.child('KnowledgeGraph');
const NODES_COLLECTION = 'knowledge_graph_nodes';
const EDGES_COLLECTION = 'knowledge_graph_edges';

export type GraphNodeType = 'Customer' | 'Order' | 'Product' | 'Supplier' | 'Complaint' | 'Support' | 'Payment' | 'Delivery' | 'Rider' | 'Memory' | 'Decision';

export interface GraphTraversalResult {
  nodeId: string;
  relationship: string;
  depth: number;
  data?: unknown;
}

export class KnowledgeGraph {
  static async addNode(id: string, type: GraphNodeType, data: unknown): Promise<void> {
    await NexusDB.update(NODES_COLLECTION, id, { id, type, data, updatedAt: Date.now() });
  }

  static async linkNodes(sourceId: string, targetId: string, relationship: string): Promise<void> {
    const edgeId = `${sourceId}__${relationship}__${targetId}`;
    await NexusDB.update(EDGES_COLLECTION, edgeId, { sourceId, targetId, relationship, createdAt: Date.now() });
    log.debug(`Linked ${sourceId} to ${targetId} (${relationship})`);
  }

  /**
   * Multi-hop traversal — the real gap Part 5 flagged (the previous version
   * only returned an id's direct edges, so the audit's own worked example,
   * Customer → Order → Product → Complaint, a 3-hop chain, was never actually
   * retrievable from it). Breadth-first, depth-bounded (default 3, matching
   * the audit's own example chain length) to keep a single call bounded on a
   * graph with cycles or high fan-out, rather than an unbounded traversal.
   */
  static async inferContext(nodeId: string, maxDepth = 3): Promise<GraphTraversalResult[]> {
    const results: GraphTraversalResult[] = [];
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      for (const currentId of frontier) {
        const outgoing = await NexusDB.find(EDGES_COLLECTION, { where: [{ field: 'sourceId', op: '==', value: currentId }] });
        for (const edge of outgoing as unknown as Array<{ targetId: string; relationship: string }>) {
          if (visited.has(edge.targetId)) continue; // cycle guard
          visited.add(edge.targetId);
          const node = await NexusDB.get(NODES_COLLECTION, edge.targetId);
          results.push({ nodeId: edge.targetId, relationship: edge.relationship, depth, data: node?.data });
          nextFrontier.push(edge.targetId);
        }
      }
      frontier = nextFrontier;
    }
    return results;
  }
}
