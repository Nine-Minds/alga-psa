'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import {
  authorizeTicketRecordAccess,
  TicketRecordAccessDeniedError,
} from '@alga-psa/authorization/ticketRecordAuthorization';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { IService, IServicePrice, ITicketFixedFeeService } from '@alga-psa/types';
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

const catalogSearchSchema = z.object({
  search: z.string().max(200).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  category_id: z.string().uuid().optional(),
}).strict();

export type TicketFixedFeeCatalogSearchOptions = z.input<typeof catalogSearchSchema>;
export type TicketFixedFeeCatalogOption = Pick<IService, 'service_id' | 'service_name'>;
export type TicketFixedFeeServicePrice = Pick<IServicePrice, 'currency_code' | 'rate'>;

const ticketUpdateRequired = () => permissionError('Permission denied: ticket update required');

/**
 * The fixed-fee picker is gated by ticket update, the permission that adding a
 * fee requires, rather than the inventory permission the materials picker
 * needs. It only ever exposes active fixed-fee services and the fields the
 * picker shows.
 */
function fixedFeeCatalog(db: ReturnType<typeof tenantDb>) {
  return db.table('service_catalog as sc')
    .where({ 'sc.item_kind': 'service', 'sc.billing_method': 'fixed', 'sc.is_active': true });
}

export const searchTicketFixedFeeServiceCatalog = withAuth(async (
  user,
  { tenant },
  options: TicketFixedFeeCatalogSearchOptions = {},
): Promise<{ items: TicketFixedFeeCatalogOption[]; totalCount: number } | ReturnType<typeof permissionError>> => {
  if (!isMspPrincipalUserType(user.user_type)) {
    return mspAccessRequired();
  }
  if (!await hasPermission(user, 'ticket', 'update')) {
    return ticketUpdateRequired();
  }
  const parsed = catalogSearchSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(`Invalid fixed-fee service search: ${parsed.error.message}`);
  }
  const { search, page = 1, limit = 10, category_id: categoryId } = parsed.data;
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const query = fixedFeeCatalog(db);
  if (categoryId) query.andWhere('sc.category_id', categoryId);
  const term = search?.trim();
  if (term) {
    query.andWhere((qb) => qb.whereILike('sc.service_name', `%${term}%`).orWhereILike('sc.description', `%${term}%`));
  }
  const [countRow, items] = await Promise.all([
    query.clone().count<{ count: string }>('sc.service_id as count').first(),
    query.clone().select<TicketFixedFeeCatalogOption[]>('sc.service_id', 'sc.service_name')
      .orderBy('sc.service_name', 'asc').limit(limit).offset((page - 1) * limit),
  ]);
  return { items, totalCount: Number(countRow?.count ?? 0) };
});

export const getTicketFixedFeeCatalogCategories = withAuth(async (
  user,
  { tenant },
): Promise<Array<{ category_id: string; category_name: string }> | ReturnType<typeof permissionError>> => {
  if (!isMspPrincipalUserType(user.user_type)) {
    return mspAccessRequired();
  }
  if (!await hasPermission(user, 'ticket', 'update')) {
    return ticketUpdateRequired();
  }
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const query = db.table('service_categories as c')
    .distinct('c.category_id', 'c.category_name', 'c.display_order');
  db.tenantJoin(query, 'service_catalog as sc', 'sc.category_id', 'c.category_id');
  query.where({ 'sc.item_kind': 'service', 'sc.billing_method': 'fixed', 'sc.is_active': true });
  const rows: Array<{ category_id: string; category_name: string }> = await query
    .orderBy('c.display_order', 'asc')
    .orderBy('c.category_name', 'asc');
  return rows.map(({ category_id, category_name }) => ({ category_id, category_name }));
});

export const getTicketFixedFeeServicePrices = withAuth(async (
  user,
  { tenant },
  serviceId: string,
): Promise<TicketFixedFeeServicePrice[] | ReturnType<typeof permissionError> | ReturnType<typeof actionError>> => {
  if (!isMspPrincipalUserType(user.user_type)) {
    return mspAccessRequired();
  }
  if (!await hasPermission(user, 'ticket', 'update')) {
    return ticketUpdateRequired();
  }
  const serviceInvalid = () => actionError('Select an active fixed-fee service.', 'features/tickets:fixedFeeServices.errors.serviceInvalid');
  if (!z.string().uuid().safeParse(serviceId).success) {
    return serviceInvalid();
  }
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const service = await fixedFeeCatalog(db).where('sc.service_id', serviceId).first('sc.service_id');
  if (!service) {
    return serviceInvalid();
  }
  return db.table('service_prices')
    .where({ service_id: serviceId })
    .orderBy('currency_code', 'asc')
    .select<TicketFixedFeeServicePrice[]>('currency_code', 'rate');
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