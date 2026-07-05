'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { assertMspPermission, hasMspPermission } from '../lib/authHelpers';

export interface InboundTicketDestinationOption {
  id: string;
  short_name: string;
  display_name: string;
  is_active: boolean;
}

export interface EntityInboundDestinationUpdateResult {
  inbound_ticket_defaults_id: string | null;
}

function normalizeDefaultsId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function validateDestinationInTenant(
  trx: Knex.Transaction,
  tenant: string,
  inboundTicketDefaultsId: string
): Promise<void> {
  const destination = await tenantDb(trx, tenant).table('inbound_ticket_defaults')
    .select('id')
    .where({ id: inboundTicketDefaultsId })
    .first();

  if (!destination) {
    throw new Error('Inbound ticket destination was not found for this tenant');
  }
}

export const listInboundTicketDestinationOptions = withAuth(async (
  user,
  { tenant }
): Promise<InboundTicketDestinationOption[]> => {
  const [canReadClient, canReadContact] = await Promise.all([
    hasMspPermission(user, 'client', 'read'),
    hasMspPermission(user, 'contact', 'read'),
  ]);

  if (!canReadClient && !canReadContact) {
    throw new Error('Permission denied: Cannot read inbound ticket destinations');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const rows = await tenantDb(trx, tenant).table('inbound_ticket_defaults')
      .select('id', 'short_name', 'display_name', 'is_active')
      .orderBy([{ column: 'is_active', order: 'desc' }, { column: 'display_name', order: 'asc' }]);

    return rows as InboundTicketDestinationOption[];
  });
});

export const updateClientInboundTicketDestination = withAuth(async (
  user,
  { tenant },
  clientId: string,
  inboundTicketDefaultsId: string | null
): Promise<EntityInboundDestinationUpdateResult> => {
  await assertMspPermission(user, 'client', 'update', 'Permission denied: Cannot update clients');

  const normalizedDefaultsId = normalizeDefaultsId(inboundTicketDefaultsId);

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const client = await tenantDb(trx, tenant).table('clients')
      .select('client_id')
      .where({ client_id: clientId })
      .first();
    if (!client) {
      throw new Error('Client not found');
    }

    if (normalizedDefaultsId) {
      await validateDestinationInTenant(trx, tenant, normalizedDefaultsId);
    }

    const [updated] = await tenantDb(trx, tenant).table('clients')
      .where({ client_id: clientId })
      .update({
        inbound_ticket_defaults_id: normalizedDefaultsId,
        updated_at: new Date().toISOString(),
      })
      .returning('inbound_ticket_defaults_id');

    return {
      inbound_ticket_defaults_id: (updated as any)?.inbound_ticket_defaults_id ?? null,
    };
  });
});

export const updateContactInboundTicketDestination = withAuth(async (
  user,
  { tenant },
  contactId: string,
  inboundTicketDefaultsId: string | null
): Promise<EntityInboundDestinationUpdateResult> => {
  await assertMspPermission(user, 'contact', 'update', 'Permission denied: Cannot update contacts');

  const normalizedDefaultsId = normalizeDefaultsId(inboundTicketDefaultsId);

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const contact = await tenantDb(trx, tenant).table('contacts')
      .select('contact_name_id')
      .where({ contact_name_id: contactId })
      .first();
    if (!contact) {
      throw new Error('Contact not found');
    }

    if (normalizedDefaultsId) {
      await validateDestinationInTenant(trx, tenant, normalizedDefaultsId);
    }

    const [updated] = await tenantDb(trx, tenant).table('contacts')
      .where({ contact_name_id: contactId })
      .update({
        inbound_ticket_defaults_id: normalizedDefaultsId,
        updated_at: new Date().toISOString(),
      })
      .returning('inbound_ticket_defaults_id');

    return {
      inbound_ticket_defaults_id: (updated as any)?.inbound_ticket_defaults_id ?? null,
    };
  });
});
