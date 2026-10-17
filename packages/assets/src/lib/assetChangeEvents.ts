import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildAssetUpdatedPayload } from '@alga-psa/workflow-streams';

/**
 * ASSET_UPDATED for the writes that do not go through `updateAssetRecord`.
 *
 * Assignment and group changes move the same record a workflow subscribes to
 * — an assignee, a location, a group — but published nothing, so an
 * automation watching ASSET_UPDATED saw an edit-form save and missed the
 * bundle that reassigned five machines.
 *
 * Failures are logged, never thrown: the write is already committed, and the
 * caller must not be told its save failed because a subscriber did.
 */
export async function publishAssetChanged(
  tenant: string,
  assetIds: readonly string[],
  change: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    updatedPaths: string[];
    actorUserId?: string | null;
  }
): Promise<void> {
  const occurredAt = new Date().toISOString();

  for (const assetId of new Set(assetIds.filter(Boolean))) {
    const payload = buildAssetUpdatedPayload({
      assetId,
      before: change.before,
      after: change.after,
      updatedPaths: change.updatedPaths,
      ...(change.actorUserId ? { updatedByUserId: change.actorUserId } : {}),
      updatedAt: occurredAt,
    });
    if (!payload.updatedFields && !payload.changes) continue;

    try {
      await publishWorkflowEvent({
        eventType: 'ASSET_UPDATED',
        payload,
        ctx: {
          tenantId: tenant,
          occurredAt,
          ...(change.actorUserId
            ? { actor: { actorType: 'USER' as const, actorUserId: change.actorUserId } }
            : {}),
        },
      });
    } catch (error) {
      console.error(
        `Post-commit ASSET_UPDATED failed (tenant=${tenant} asset_id=${assetId}); the write is committed:`,
        error
      );
    }
  }
}
