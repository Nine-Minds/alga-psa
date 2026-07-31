'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { assertMspPermission, hasMspPermission } from '../lib/authHelpers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export interface InboundTicketDestinationOption {
  id: string;
  short_name: string;
  display_name: string;
  is_active: boolean;
}

export interface EntityInboundDestinationUpdateResult {
  inbound_ticket_defaults_id: string | null;
}

type InboundTicketDestinationActionError = ActionMessageError | ActionPermissionError;

function inboundTicketDestinationActionErrorFrom(error: unknown): InboundTicketDestinationActionError | null {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied:')) {
      return permissionError(message);
    }
    if (
      message === 'Inbound ticket destination was not found for this tenant' ||
      message === 'Client not found' ||
      message === 'Contact not found'
    ) {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '23502') {
    return actionError(`Missing required inbound ticket destination field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected inbound ticket destination is no longer valid. Please refresh and try again.');
  }

  return null;
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
): Promise<InboundTicketDestinationOption[] | InboundTicketDestinationActionError> => {
  try {
    const [canReadClient, canReadContact] = await Promise.all([
      hasMspPermission(user, 'client', 'read'),
      hasMspPermission(user, 'contact', 'read'),
    ]);

    if (!canReadClient && !canReadContact) {
      throw new Error('Permission denied: Cannot read inbound ticket destinations');
    }

    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const rows = await tenantDb(trx, tenant).table('inbound_ticket_defaults')
        .select('id', 'short_name', 'display_name', 'is_active')
        .orderBy([{ column: 'is_active', order: 'desc' }, { column: 'display_name', order: 'asc' }]);

      return rows as InboundTicketDestinationOption[];
    });
  } catch (error) {
    const expected = inboundTicketDestinationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateClientInboundTicketDestination = withAuth(async (
  user,
  { tenant },
  clientId: string,
  inboundTicketDefaultsId: string | null
): Promise<EntityInboundDestinationUpdateResult | InboundTicketDestinationActionError> => {
  try {
    await assertMspPermission(user, 'client', 'update', 'Permission denied: Cannot update clients');
  } catch (error) {
    const expected = inboundTicketDestinationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }

  const normalizedDefaultsId = normalizeDefaultsId(inboundTicketDefaultsId);

  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
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
  } catch (error) {
    const expected = inboundTicketDestinationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateContactInboundTicketDestination = withAuth(async (
  user,
  { tenant },
  contactId: string,
  inboundTicketDefaultsId: string | null
): Promise<EntityInboundDestinationUpdateResult | InboundTicketDestinationActionError> => {
  try {
    await assertMspPermission(user, 'contact', 'update', 'Permission denied: Cannot update contacts');
  } catch (error) {
    const expected = inboundTicketDestinationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }

  const normalizedDefaultsId = normalizeDefaultsId(inboundTicketDefaultsId);

  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
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
  } catch (error) {
    const expected = inboundTicketDestinationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
