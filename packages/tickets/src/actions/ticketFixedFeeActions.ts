'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import {
  authorizeTicketRecordAccess,
  TicketRecordAccessDeniedError,
} from '@alga-psa/authorization/ticketRecordAuthorization';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { ITicketFixedFeeService } from '@alga-psa/types';
import { isMspPrincipalUserType } from '@alga-psa/types';
import { z } from 'zod';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';

function permissionErrorFrom(error: unknown) {
  if (error instanceof TicketRecordAccessDeniedError) {
    return permissionError(error.message);
  }
  throw error;
}

const mspAccessRequired = () => permissionError('Permission denied: MSP ticket access required');
const ticketUnavailable = () => actionError('The ticket no longer exists. Refresh and try again.', 'features/tickets:fixedFeeServices.errors.ticketMissing');
const entryNotDeletable = () => actionError('This service entry is already billed or was removed. Refresh and try again.', 'features/tickets:fixedFeeServices.errors.cannotDelete');
const entryNotEditable = () => actionError('Billed or removed entries cannot be edited. Refresh and try again.', 'features/tickets:chargeEdit.errors.notEditable');

/**
 * A record-level denial is reported exactly like a missing record so callers
 * cannot probe which ticket or entry ids exist.
 */
async function authorizeOrConceal(
  input: Parameters<typeof authorizeTicketRecordAccess>[0],
): Promise<boolean> {
  try {
    await authorizeTicketRecordAccess(input);
    return true;
  } catch (error) {
    if (error instanceof TicketRecordAccessDeniedError) return false;
    throw error;
  }
}

const entrySchema = z.object({
  ticket_id: z.string().uuid(),
  service_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(2147483647),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().trim().max(2000).optional(),
});

export const listTicketFixedFeeServices = withAuth(async (user, { tenant }, ticketId: string): Promise<ITicketFixedFeeService[] | ReturnType<typeof permissionError> | ReturnType<typeof actionError>> => {
  if (!isMspPrincipalUserType(user.user_type)) {
    return mspAccessRequired();
  }
  if (!await hasPermission(user, 'ticket', 'read')) {
    return permissionError('Permission denied: ticket read required');
  }
  if (!z.string().uuid().safeParse(ticketId).success) {
    return ticketUnavailable();
  }
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      await authorizeTicketRecordAccess({ trx, tenant, user, ticketId, action: 'read' });
      const db = tenantDb(trx, tenant);
      const query = db.table('ticket_fixed_fee_services as f');
      db.tenantJoin(query, 'service_catalog as s', 's.service_id', 'f.service_id');
      return query.where('f.ticket_id', ticketId)
        .orderBy('f.created_at', 'asc')
        .select('f.*', 's.service_name');
    });
  } catch (error) {
    return permissionErrorFrom(error);
  }
});

export const addTicketFixedFeeService = withAuth(async (user, { tenant }, input: z.input<typeof entrySchema>) => {
  if (!isMspPrincipalUserType(user.user_type)) {
    return mspAccessRequired();
  }
  if (!await hasPermission(user, 'ticket', 'update')) {
    return permissionError('Permission denied: ticket update required');
  }
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) {
    return actionError('Select a service, currency, and a positive whole-number quantity.', 'features/tickets:fixedFeeServices.errors.invalidInput');
  }
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const ticket = await db.table('tickets').where('ticket_id', parsed.data.ticket_id).forShare().first('client_id');
    if (!ticket || !await authorizeOrConceal({ trx, tenant, user, ticketId: parsed.data.ticket_id, action: 'update' })) {
      return ticketUnavailable();
    }
    const service = await db.table('service_catalog')
      .where({ service_id: parsed.data.service_id, item_kind: 'service', billing_method: 'fixed', is_active: true })
      .forShare().first('service_id');
    if (!service) {
      return actionError('Select an active fixed-fee service.', 'features/tickets:fixedFeeServices.errors.serviceInvalid');
    }
    // Resolve the price on the server; a ticket update permission does not grant price overrides.
    const price = await db.table('service_prices')
      .where({ service_id: service.service_id, currency_code: parsed.data.currency_code })
      .forShare().first('rate');
    const rate = Number(price?.rate);
    if (!price || !Number.isSafeInteger(rate) || rate < 0 || !Number.isSafeInteger(rate * parsed.data.quantity)) {
      return actionError('A valid catalog price is required for this currency and quantity.', 'features/tickets:fixedFeeServices.errors.priceInvalid');
    }
    const [entry] = await db.table('ticket_fixed_fee_services').insert({
      tenant,
      ...parsed.data,
      client_id: ticket.client_id,
      description: parsed.data.description || null,
      rate,
    }).returning<ITicketFixedFeeService[]>('*');
    return entry;
  }).catch(permissionErrorFrom);
});

export const deleteTicketFixedFeeService = withAuth(async (user, { tenant }, entryId: string) => {
  if (!isMspPrincipalUserType(user.user_type)) {
    return mspAccessRequired();
  }
  if (!await hasPermission(user, 'ticket', 'update')) {
    return permissionError('Permission denied: ticket update required');
  }
  if (!z.string().uuid().safeParse(entryId).success) {
    return entryNotDeletable();
  }
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const entry = await db.table('ticket_fixed_fee_services')
      .where({ entry_id: entryId }).forUpdate().first('ticket_id', 'is_billed');
    if (!entry || !await authorizeOrConceal({ trx, tenant, user, ticketId: entry.ticket_id, action: 'update' })) {
      return entryNotDeletable();
    }
    if (entry.is_billed) {
      return entryNotDeletable();
    }
    const count = await db.table('ticket_fixed_fee_services')
      .where({ entry_id: entryId, is_billed: false }).delete();
    if (count !== 1) {
      return entryNotDeletable();
    }
  });
});

export const updateTicketFixedFeeService = withAuth(async (user, { tenant }, entryId: string, input: { quantity: number; description: string }) => {
  if (!isMspPrincipalUserType(user.user_type)) {
    return mspAccessRequired();
  }
  if (!await hasPermission(user, 'ticket', 'update')) {
    return permissionError('Permission denied: ticket update required');
  }
  const parsed = entrySchema.pick({ quantity: true, description: true }).safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(entryId).success) {
    return actionError('Enter a positive whole-number quantity and a description of at most 2,000 characters.', 'features/tickets:chargeEdit.errors.invalidInput');
  }
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const entry = await db.table('ticket_fixed_fee_services').where({ entry_id: entryId }).forUpdate().first();
    if (!entry || !await authorizeOrConceal({ trx, tenant, user, ticketId: entry.ticket_id, action: 'update' })) {
      return entryNotEditable();
    }
    // Billed rows are immutable because their quantity and price back an invoice.
    if (entry.is_billed) {
      return entryNotEditable();
    }
    if (!Number.isSafeInteger(Number(entry.rate) * parsed.data.quantity)) {
      return actionError('This quantity would exceed the supported total amount.', 'features/tickets:chargeEdit.errors.amountTooLarge');
    }
    await db.table('ticket_fixed_fee_services').where({ entry_id: entryId, is_billed: false })
      .update({ quantity: parsed.data.quantity, description: parsed.data.description || null, updated_at: new Date().toISOString() });
  });
});