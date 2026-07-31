/**
 * CE stub for the EE Hudu tenant-wide sync engine
 * (ee/server/src/lib/integrations/hudu/tenantSync.ts), resolved via the
 * edition-swapped `@enterprise` alias.
 *
 * Community Edition has no Hudu integration; the daily auto-sync handler is
 * EE-gated and returns before ever invoking these. They exist only so the CE
 * webpack build can statically resolve the handler's dynamic import.
 */

export interface HuduAutoSyncDesiredState {
  isActive: boolean;
  autoSyncEnabled: boolean;
}

export async function getHuduAutoSyncDesiredState(
  _tenant: string
): Promise<HuduAutoSyncDesiredState | null> {
  return null;
}

export interface HuduTenantSyncSummary {
  sync_type: 'import' | 'sync';
  started_at: string;
  completed_at: string;
  clients: number;
  items_created: number;
  items_updated: number;
  items_skipped: number;
  items_failed: number;
  stale: number;
  errors: string[];
}

export interface RunHuduTenantSyncOptions {
  importNew: boolean;
  actorUserId?: string;
}

export async function runHuduTenantSync(
  _tenant: string,
  options: RunHuduTenantSyncOptions
): Promise<HuduTenantSyncSummary> {
  const now = new Date().toISOString();
  return {
    sync_type: options.importNew ? 'import' : 'sync',
    started_at: now,
    completed_at: now,
    clients: 0,
    items_created: 0,
    items_updated: 0,
    items_skipped: 0,
    items_failed: 0,
    stale: 0,
    errors: [],
  };
}
