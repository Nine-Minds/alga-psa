import { publishEvent } from '@alga-psa/event-bus/publishers';

export async function publishRmmSyncEvent(args: {
  provider: string;
  eventType: 'RMM_SYNC_STARTED' | 'RMM_SYNC_COMPLETED' | 'RMM_SYNC_FAILED';
  tenantId: string;
  actorUserId?: string;
  integrationId: string;
  syncType: 'organizations' | 'devices' | 'alerts';
  itemsProcessed?: number;
  itemsCreated?: number;
  itemsUpdated?: number;
  itemsFailed?: number;
  errorMessage?: string;
}) {
  const payload: Record<string, unknown> = {
    tenantId: args.tenantId,
    occurredAt: new Date().toISOString(),
    actorType: args.actorUserId ? 'USER' : 'SYSTEM',
    actorUserId: args.actorUserId,
    integrationId: args.integrationId,
    provider: args.provider,
    syncType: args.syncType,
    itemsProcessed: args.itemsProcessed,
    itemsCreated: args.itemsCreated,
    itemsUpdated: args.itemsUpdated,
    itemsFailed: args.itemsFailed,
    ...(args.eventType === 'RMM_SYNC_FAILED'
      ? { error: { message: args.errorMessage || 'Sync failed' } }
      : {}),
  };

  try {
    await publishEvent({ eventType: args.eventType, payload });
  } catch {
    // Best-effort: never fail the sync on event-publish issues.
  }
}
