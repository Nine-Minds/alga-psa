// @alga-psa/tickets/actions.ts
'use server'

import { ITicketResource } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import {
  addTicketResourceCore,
  getTicketResourcesCore,
  removeTicketResourceCore,
} from '../lib/ticketResourceCore';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export const addTicketResource = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  additionalUserId: string,
  role: string
): Promise<ITicketResource | TicketActionError | null> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot add ticket resource');
    }

    return await addTicketResourceCore(trx, tenant, user.user_id, ticketId, additionalUserId, role);
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to add ticket resource:', error);
    throw error;
  }
});

export const removeTicketResource = withAuth(async (
  user,
  { tenant },
  assignmentId: string
): Promise<void | TicketActionError> => {
  const { knex: db } = await createTenantKnex();
  try {
    await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot remove ticket resource');
    }

    await removeTicketResourceCore(trx, tenant, assignmentId);
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to remove ticket resource:', error);
    throw error;
  }
});

export const getTicketResources = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<ITicketResource[] | TicketActionError> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view ticket resources');
    }

    return await getTicketResourcesCore(trx, tenant, ticketId);
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to fetch ticket resources:', error);
    throw error;
  }
});

// Helper function to check if a user can be added as additional agent
export const canAddAsAdditionalAgent = withAuth(async (
  _user,
  { tenant },
  ticketId: string,
  userId: string
): Promise<boolean> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
    // First verify the ticket exists
    const ticket = await tenantScopedTable(trx, 'tickets', tenant)
      .where({
        ticket_id: ticketId,
      })
      .first();

    if (!ticket) {
      throw new Error(`Ticket not found in tenant ${tenant}`);
    }

    // Check if user is already an additional agent
    const existingResource = await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({
        ticket_id: ticketId,
        additional_user_id: userId,
      })
      .first();

    if (existingResource) {
      return false;
    }

    // Check if user is the primary assigned agent
    const isPrimaryAgent = await tenantScopedTable(trx, 'tickets', tenant)
      .where({
        ticket_id: ticketId,
        assigned_to: userId,
      })
      .first();

    return !isPrimaryAgent;
    });
  } catch (error) {
    console.error('Error checking user availability:', error);
    if (error instanceof Error) {
      // Log specific error but return false for this helper function
      console.error(`Tenant ${tenant} error: ${error.message}`);
    }
    return false;
  }
});
