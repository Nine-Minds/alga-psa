'use server';

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { recordCoManagedTicketReopened } from '@alga-psa/co-managed';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';

function nowIso() {
  return new Date().toISOString();
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function findOpenTicketStatusId(trx: Knex.Transaction, tenant: string, boardId: string): Promise<string | null> {
  const row = await tenantScopedTable(trx, 'statuses', tenant)
    .select('status_id')
    .where({ is_closed: false, board_id: boardId })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .orderBy('status_id')
    .forShare().first();
  return row?.status_id ?? null;
}

export async function maybeReopenBundleMasterFromChildReply(
  trx: Knex.Transaction,
  tenant: string,
  childTicketId: string,
  updatedByUserId: string | null
): Promise<{ reopened: boolean; masterTicketId: string | null }> {
  await assertCoManagedOperationalWrite(trx, tenant);
  const child = await tenantScopedTable(trx, 'tickets', tenant)
    .select('ticket_id', 'master_ticket_id')
    .where({ ticket_id: childTicketId })
    .forShare().first();

  const masterTicketId = child?.master_ticket_id ?? null;
  if (!masterTicketId) {
    return { reopened: false, masterTicketId: null };
  }

  // Lock the master before its settings, matching bundle mutation ordering.
  // Read its status only after retaining the row: concurrent child replies must
  // not both infer a closed-to-open transition from an earlier join snapshot.
  const master = await tenantScopedTable(trx, 'tickets', tenant)
    .select('ticket_id', 'board_id', 'status_id', 'closed_at')
    .where({ ticket_id: masterTicketId }).forUpdate().first();
  if (!master?.board_id) return { reopened: false, masterTicketId };
  const status = await tenantScopedTable(trx, 'statuses', tenant)
    .where({ status_id: master.status_id }).forShare().first('is_closed');
  if (!status?.is_closed) return { reopened: false, masterTicketId };

  const settings = await tenantScopedTable(trx, 'ticket_bundle_settings', tenant)
    .select('reopen_on_child_reply')
    .where({ master_ticket_id: masterTicketId })
    .forShare().first();
  if (!settings?.reopen_on_child_reply) return { reopened: false, masterTicketId };

  const openStatusId = await findOpenTicketStatusId(trx, tenant, master.board_id);
  if (!openStatusId) {
    return { reopened: false, masterTicketId };
  }

  const previousStatusId = master.status_id;
  const reopenedAt = nowIso();

  // Keep the denormalized `is_closed` column on tickets in sync with the
  // open status we're moving to — mirrors how updateTicketWithCache flips
  // is_closed when the status transitions across the closed boundary.
  // Without this, the master row reads "closed" in list/detail surfaces
  // even though its status_id points to an open status.
  await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: masterTicketId })
    .update({
      status_id: openStatusId,
      is_closed: false,
      closed_at: null,
      closed_by: null,
      updated_by: updatedByUserId,
      updated_at: reopenedAt,
    });

  await recordCoManagedTicketReopened(trx, tenant, masterTicketId);

  // Activity row for the master ticket so the dispatcher can see that the
  // bundle reopen was system-triggered by a child reply (not a user click).
  // We classify the actor as SYSTEM because no human directly performed the
  // master-ticket action, even though we record the triggering user for
  // traceability.
  await writeTicketActivity(trx, {
    tenant,
    ticketId: masterTicketId,
    eventType: TICKET_ACTIVITY_EVENT.BUNDLE_REOPENED,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: masterTicketId,
    actor: {
      actorType: TICKET_ACTIVITY_ACTOR.SYSTEM,
      userId: updatedByUserId ?? null,
    },
    source: TICKET_ACTIVITY_SOURCE.SYSTEM,
    occurredAt: reopenedAt,
    changes: {
      status_id: { old: previousStatusId, new: openStatusId },
      closed_at: { old: master.closed_at, new: null },
    },
    details: {
      reopen_trigger: 'child_reply',
      child_ticket_id: childTicketId,
    },
  });

  await assertCoManagedOperationalWrite(trx, tenant);
  return { reopened: true, masterTicketId };
}
