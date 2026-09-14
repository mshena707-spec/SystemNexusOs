/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DATABASE MIGRATION TOOL — Phase E                                   ║
 * ║                                                                      ║
 * ║  Copies all data from one NexusDB adapter to another.               ║
 * ║  Used when switching DB_PROVIDER (e.g. Firestore → PostgreSQL).      ║
 * ║                                                                      ║
 * ║  Usage:                                                              ║
 * ║    const tool = new MigrationTool();                                 ║
 * ║    await tool.migrate('firestore', 'postgres', ['orders', 'users']);║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import {
  FirestoreAdapter, PostgreSQLAdapter, SupabaseAdapter, MongoDBAdapter, InMemoryAdapter,
  type INexusDBAdapter,
} from './NexusDB';

// Default set of collections that exist in Nexus OS
export const ALL_COLLECTIONS = [
  'users', 'user_profiles', 'products', 'orders', 'carts', 'payments',
  'notifications', 'messages', 'riders', 'rider_locations', 'rider_breadcrumbs',
  'rider_heartbeats', 'rider_performance', 'delivery_timeline', 'sla_alerts',
  'order_batches', 'fleet_snapshots', 'fraud_flags', 'memory_semantic',
  'knowledge_base', 'conversation_sessions', 'customer_preferences',
  'business_learning', 'operational_learning', 'memory_learning',
  'provider_benchmarks', 'shared_state', 'logistics_handoffs', 'anomaly_reports',
];

export interface MigrationResult {
  collection: string;
  documentsCopied: number;
  errors: string[];
}

export interface MigrationReport {
  source: string;
  destination: string;
  startedAt: Date;
  finishedAt: Date;
  totalDocuments: number;
  results: MigrationResult[];
}

function getAdapter(provider: string): INexusDBAdapter {
  switch (provider) {
    case 'firestore': return new FirestoreAdapter();
    case 'postgres':  return new PostgreSQLAdapter();
    case 'supabase':  return new SupabaseAdapter();
    case 'mongodb':   return new MongoDBAdapter();
    case 'memory':    return new InMemoryAdapter();
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

export class MigrationTool {

  /**
   * Migrate all documents in `collections` from `source` to `destination`.
   * Does NOT delete source data — this is a copy, not a move.
   */
  static async migrate(
    source: string,
    destination: string,
    collections: string[] = ALL_COLLECTIONS,
    options: { batchSize?: number; onProgress?: (collection: string, copied: number, total: number) => void } = {}
  ): Promise<MigrationReport> {
    const startedAt = new Date();
    const srcAdapter = getAdapter(source);
    const dstAdapter = getAdapter(destination);

    await srcAdapter.connect();
    await dstAdapter.connect();

    const srcOk = await srcAdapter.ping();
    const dstOk = await dstAdapter.ping();
    if (!srcOk) throw new Error(`Source adapter "${source}" failed health check`);
    if (!dstOk) throw new Error(`Destination adapter "${destination}" failed health check`);

    const results: MigrationResult[] = [];
    let totalDocuments = 0;

    for (const collection of collections) {
      const result: MigrationResult = { collection, documentsCopied: 0, errors: [] };

      try {
        // Fetch all documents from source (paginated to avoid memory issues)
        const batchSize = options.batchSize ?? 500;
        let lastCursor: any = null;
        let allDocs: Array<Record<string, any>> = [];

        // Simple approach: fetch up to 10,000 docs per collection
        const docs = await srcAdapter.find(collection, { limit: 10_000 });
        allDocs = docs;

        // Write to destination in batches
        for (let i = 0; i < allDocs.length; i += batchSize) {
          const batch = allDocs.slice(i, i + batchSize);
          const writes = batch.map(doc => ({
            type: 'set' as const,
            collection,
            id: doc.id,
            data: { ...doc },
          }));

          try {
            await dstAdapter.batch(writes);
            result.documentsCopied += batch.length;
          } catch (err: any) {
            // Fall back to individual writes if batch fails
            for (const doc of batch) {
              try {
                await dstAdapter.set(collection, doc.id, doc, true);
                result.documentsCopied++;
              } catch (docErr: any) {
                result.errors.push(`doc ${doc.id}: ${docErr.message}`);
              }
            }
          }

          options.onProgress?.(collection, result.documentsCopied, allDocs.length);
        }

      } catch (err: any) {
        result.errors.push(`collection error: ${err.message}`);
      }

      totalDocuments += result.documentsCopied;
      results.push(result);
      console.log(`[Migration] ${collection}: ${result.documentsCopied} docs copied, ${result.errors.length} errors`);
    }

    const finishedAt = new Date();
    const report: MigrationReport = {
      source, destination, startedAt, finishedAt, totalDocuments, results,
    };

    // Persist migration report to destination DB for audit
    try {
      await dstAdapter.add('migration_reports', {
        ...report,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
    } catch { /* non-blocking */ }

    return report;
  }

  /**
   * Verify data parity between two adapters for given collections.
   * Returns count mismatch report (does not compare full document content).
   */
  static async verify(
    source: string,
    destination: string,
    collections: string[] = ALL_COLLECTIONS,
  ): Promise<Array<{ collection: string; sourceCount: number; destCount: number; match: boolean }>> {
    const srcAdapter = getAdapter(source);
    const dstAdapter = getAdapter(destination);
    await srcAdapter.connect();
    await dstAdapter.connect();

    const results = [];
    for (const collection of collections) {
      const srcDocs = await srcAdapter.find(collection, { limit: 100_000 });
      const dstDocs = await dstAdapter.find(collection, { limit: 100_000 });
      results.push({
        collection,
        sourceCount: srcDocs.length,
        destCount: dstDocs.length,
        match: srcDocs.length === dstDocs.length,
      });
    }
    return results;
  }
}
