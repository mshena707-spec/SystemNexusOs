/**
 * BackupEngine — thin facade
 *
 * `admin.routes.ts` was written against a module of this name that never
 * existed. The real, working implementation is `BackupRecoveryEngine`
 * (src/lib/infrastructure/BackupRecoveryEngine.ts) — this file exposes it
 * under the name/shape the route expects.
 *
 * HONEST LIMITATION (inherited from BackupRecoveryEngine): restore only
 * works for backups that were also written to disk (BACKUP_FS_PATH set at
 * backup time, server-side only). A backup that only exists in the
 * `system_backups` NexusDB collection (no fsPath) cannot be restored from —
 * restore() and restoreDryRun() will say so explicitly rather than silently
 * doing nothing.
 */
import { BackupRecoveryEngine, BackupRecord } from '../infrastructure/BackupRecoveryEngine';

export type { BackupRecord };

export class BackupEngine {
  static async run(): Promise<BackupRecord> {
    return BackupRecoveryEngine.executeAutoBackup('manual');
  }

  static async list(limit = 20): Promise<BackupRecord[]> {
    return BackupRecoveryEngine.listBackups(limit);
  }

  private static async findRecord(backupId: string): Promise<BackupRecord> {
    const records = await BackupRecoveryEngine.listBackups(500);
    const record = records.find(r => r.backupId === backupId);
    if (!record) throw new Error(`Backup ${backupId} not found`);
    if (!record.fsPath) {
      throw new Error(
        `Backup ${backupId} has no file export (BACKUP_FS_PATH was not set when it ran) — cannot restore from it.`
      );
    }
    return record;
  }

  static async restoreDryRun(backupId: string) {
    const record = await this.findRecord(backupId);
    return BackupRecoveryEngine.restoreFromFile(record.fsPath!, true);
  }

  static async restore(backupId: string, _uid?: string) {
    const record = await this.findRecord(backupId);
    return BackupRecoveryEngine.restoreFromFile(record.fsPath!, false);
  }

  static async exportCollection(collection: string): Promise<string> {
    return BackupRecoveryEngine.exportCollection(collection);
  }
}
