import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildClientLocationCreatedPayload,
  buildClientLocationDeactivatedPayload,
  buildClientLocationDeletedPayload,
  buildClientLocationUpdatedPayload,
} from '@alga-psa/workflow-streams';
import type { IClientLocation } from '@alga-psa/types';
import type { Knex } from 'knex';

/**
 * Domain events for `client_locations` writes.
 *
 * Every function here defers publishing until the owning transaction commits
 * (`registerAfterCommit`), so a rolled-back write never emits and a subscriber that reads the
 * database never races the commit. They are called from `models/clientLocation.ts`, which is the
 * shared write layer for the UI actions, the REST service and the migration applier, and directly
 * from the write paths that bypass the model (imports, workflow business operations, client merge).
 */

export interface ClientLocationEventOptions {
  /** Acting user; omit for system-initiated writes (imports, sync, merge engines). */
  actorUserId?: string;
}

function ctxFor(tenant: string, occurredAt: string, actorUserId?: string) {
  return {
    tenantId: tenant,
    occurredAt,
    ...(actorUserId ? { actor: { actorType: 'USER' as const, actorUserId } } : {}),
  };
}

export function queueClientLocationCreated(
  trx: Knex.Transaction,
  tenant: string,
  location: Pick<IClientLocation, 'location_id' | 'client_id' | 'is_default' | 'is_active'>,
  options: ClientLocationEventOptions = {}
): void {
  const occurredAt = new Date().toISOString();
  registerAfterCommit(
    trx,
    () =>
      publishWorkflowEvent({
        eventType: 'CLIENT_LOCATION_CREATED',
        payload: buildClientLocationCreatedPayload({
          locationId: location.location_id,
          clientId: location.client_id,
          isDefault: Boolean(location.is_default),
          createdByUserId: options.actorUserId,
          createdAt: occurredAt,
        }),
        ctx: ctxFor(tenant, occurredAt, options.actorUserId),
        idempotencyKey: `client_location_created:${location.location_id}`,
      }),
    `CLIENT_LOCATION_CREATED location=${location.location_id}`
  );
  // A location can be created already inactive (imports, REST); the deactivation flag flips
  // true -> false only on update, so creation of an inactive row is reported as created only.
}

export function queueClientLocationUpdated(
  trx: Knex.Transaction,
  tenant: string,
  before: IClientLocation,
  after: IClientLocation,
  options: ClientLocationEventOptions = {}
): void {
  const occurredAt = new Date().toISOString();
  const payload = buildClientLocationUpdatedPayload({
    locationId: after.location_id,
    clientId: after.client_id,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    updatedByUserId: options.actorUserId,
    updatedAt: occurredAt,
  });

  if ((payload as { updatedFields?: string[] }).updatedFields?.length) {
    registerAfterCommit(
      trx,
      () =>
        publishWorkflowEvent({
          eventType: 'CLIENT_LOCATION_UPDATED',
          payload,
          ctx: ctxFor(tenant, occurredAt, options.actorUserId),
          idempotencyKey: `client_location_updated:${after.location_id}:${occurredAt}`,
        }),
      `CLIENT_LOCATION_UPDATED location=${after.location_id}`
    );
  }

  // Only the true -> false flip is a deactivation. Re-activation (false -> true) has no dedicated
  // domain event; it is reported by the UPDATED event above (changes.isActive).
  if (before.is_active !== false && after.is_active === false) {
    registerAfterCommit(
      trx,
      () =>
        publishWorkflowEvent({
          eventType: 'CLIENT_LOCATION_DEACTIVATED',
          payload: buildClientLocationDeactivatedPayload({
            locationId: after.location_id,
            clientId: after.client_id,
            deactivatedByUserId: options.actorUserId,
            deactivatedAt: occurredAt,
          }),
          ctx: ctxFor(tenant, occurredAt, options.actorUserId),
          idempotencyKey: `client_location_deactivated:${after.location_id}:${occurredAt}`,
        }),
      `CLIENT_LOCATION_DEACTIVATED location=${after.location_id}`
    );
  }
}

export function queueClientLocationDeleted(
  trx: Knex.Transaction,
  tenant: string,
  location: Pick<IClientLocation, 'location_id' | 'client_id'>,
  options: ClientLocationEventOptions = {}
): void {
  const occurredAt = new Date().toISOString();
  registerAfterCommit(
    trx,
    () =>
      publishWorkflowEvent({
        eventType: 'CLIENT_LOCATION_DELETED',
        payload: buildClientLocationDeletedPayload({
          locationId: location.location_id,
          clientId: location.client_id,
          deletedByUserId: options.actorUserId,
          deletedAt: occurredAt,
        }),
        ctx: ctxFor(tenant, occurredAt, options.actorUserId),
        idempotencyKey: `client_location_deleted:${location.location_id}`,
      }),
    `CLIENT_LOCATION_DELETED location=${location.location_id}`
  );
}
