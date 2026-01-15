'use server';

import type { Knex } from 'knex';

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

  await trx('tickets')
    .where({ tenant, ticket_id: masterTicketId })
    .update({
      status_id: openStatusId,
      closed_at: null,
      closed_by: null,
      updated_by: updatedByUserId,
      updated_at: nowIso(),
    });

  return { reopened: true, masterTicketId };
}

