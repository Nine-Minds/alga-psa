'use server';

import type { Knex } from 'knex';
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

async function findOpenTicketStatusId(trx: Knex.Transaction, tenant: string): Promise<string | null> {
  const row = await trx('statuses')
    .select('status_id')
    .where({ tenant, is_closed: false })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first();
  return row?.status_id ?? null;
}

export async function maybeReopenBundleMasterFromChildReply(
  trx: Knex.Transaction,
  tenant: string,
  childTicketId: string,
  updatedByUserId: string | null
): Promise<{ reopened: boolean; masterTicketId: string | null }> {
  const child = await trx('tickets')
    .select('ticket_id', 'master_ticket_id')
    .where({ tenant, ticket_id: childTicketId })
    .first();

  const masterTicketId = child?.master_ticket_id ?? null;
  if (!masterTicketId) {
    return { reopened: false, masterTicketId: null };
  }

  const settings = await trx('ticket_bundle_settings')
    .select('reopen_on_child_reply')
    .where({ tenant, master_ticket_id: masterTicketId })
    .first();

  if (!settings?.reopen_on_child_reply) {
    return { reopened: false, masterTicketId };
  }

  const master = await trx('tickets as t')
    .select('t.ticket_id', 't.status_id', 's.is_closed')
    .leftJoin('statuses as s', function () {
      this.on('t.status_id', 's.status_id').andOn('t.tenant', 's.tenant');
    })
    .where({ 't.tenant': tenant, 't.ticket_id': masterTicketId })
    .first();

  if (!master || !master.is_closed) {
    return { reopened: false, masterTicketId };
  }

  const openStatusId = await findOpenTicketStatusId(trx, tenant);
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
  await trx('tickets')
    .where({ tenant, ticket_id: masterTicketId })
    .update({
      status_id: openStatusId,
      is_closed: false,
      closed_at: null,
      closed_by: null,
      updated_by: updatedByUserId,
      updated_at: reopenedAt,
    });

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
      closed_at: { old: null, new: null },
    },
    details: {
      reopen_trigger: 'child_reply',
      child_ticket_id: childTicketId,
    },
  });

  return { reopened: true, masterTicketId };
}

