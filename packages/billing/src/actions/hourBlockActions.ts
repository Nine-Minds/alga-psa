'use server'

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { Temporal } from '@js-temporal/polyfill';
import type {
  IHourBlock,
  IHourBlockAllocation,
  IHourBlockAuditEntry,
  IHourBlockServiceScope,
  IHourBlockPurchaseInput,
  IHourBlockGrantInput,
} from '@alga-psa/types';
import { getAvailableHourBlockMinutes } from '@alga-psa/shared/billingClients/hourBlockService';
import { toCalendarDateString } from '@alga-psa/core';
import { generateInvoiceNumber } from './invoiceGeneration';
import { getDueDate } from './billingAndTax';
import { getInitialInvoiceTaxSource } from './taxSourceActions';
import * as invoiceService from '../services/invoiceService';
import { TaxService } from '../services/taxService';
import {
  actionError,
  getErrorMessage,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type HourBlockActionError = ActionMessageError | ActionPermissionError;

type DbRow = Record<string, any>;

function isActionError(value: unknown): value is HourBlockActionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (
      typeof (value as { actionError?: unknown }).actionError === 'string' ||
      typeof (value as { permissionError?: unknown }).permissionError === 'string'
    )
  );
}

function hourBlockActionErrorFrom(error: unknown): HourBlockActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }
    if (error.message === 'Client ID is required') {
      return actionError('Client ID is required.');
    }
    if (error.message === 'Client not found') {
      return actionError('Client not found. It may have been updated or deleted. Please refresh and try again.');
    }
    if (/^Hour block with ID .+ not found$/.test(error.message)) {
      return actionError('Hour block not found. It may have been updated or deleted. Please refresh and try again.');
    }
    if (/^Service .+ not found$/.test(error.message)) {
      return actionError('Service not found. It may have been updated or deleted. Please refresh and try again.');
    }
    if (error.message === 'Block hours must be greater than zero') {
      return actionError('Block hours must be greater than zero.');
    }
    if (error.message === 'Hourly rate must be zero or greater') {
      return actionError('Hourly rate must be zero or greater.');
    }
    if (error.message === 'Reason is required for this operation') {
      return actionError('A reason is required for this operation.');
    }
    if (error.message === 'Cannot adjust an expired or voided hour block') {
      return actionError('Cannot adjust an expired or voided hour block.');
    }
    if (error.message === 'Cannot void an hour block that has been used') {
      return actionError('This hour block has been used and cannot be voided. Expire it instead.');
    }
    if (error.message === 'Only pending or active hour blocks can be voided') {
      return actionError('Only pending or active hour blocks can be voided.');
    }
    if (error.message === 'Cannot expire a voided hour block') {
      return actionError('Cannot expire a voided hour block.');
    }
    if (error.message === 'Cannot update expiration of a voided hour block') {
      return actionError('Cannot update the expiration of a voided hour block.');
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected hour block values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError('A required hour block field is missing. Please review the form and try again.');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected client, service, or invoice no longer exists. Please refresh and try again.');
  }

  return null;
}

async function withHourBlockActionErrors<T>(work: () => Promise<T>): Promise<T | HourBlockActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = hourBlockActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

function tenantScopedTable<Row extends object = DbRow>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string,
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table(tableExpression);
}

async function resolveScopeServiceIds(
  trx: Knex.Transaction,
  tenant: string,
  blockId: string,
  scopeServiceIds: string[] | undefined,
): Promise<void> {
  if (!scopeServiceIds || scopeServiceIds.length === 0) return;
  const rows = scopeServiceIds.map((serviceId) => ({
    tenant,
    block_id: blockId,
    service_id: serviceId,
  }));
  await tenantScopedTable(trx, tenant, 'hour_block_service_scopes').insert(rows);
}

async function writeAudit(
  trx: Knex.Transaction,
  tenant: string,
  params: {
    blockId: string;
    type: IHourBlockAuditEntry['type'];
    minutesDelta?: number | null;
    reason?: string | null;
    createdBy?: string | null;
    metadata?: Record<string, any> | null;
  },
): Promise<void> {
  await tenantScopedTable(trx, tenant, 'hour_block_audit').insert({
    tenant,
    block_id: params.blockId,
    type: params.type,
    minutes_delta: params.minutesDelta ?? null,
    reason: params.reason ?? null,
    created_by: params.createdBy ?? null,
    metadata: params.metadata ?? null,
  });
}

function assertReason(reason: string | undefined, message: string): void {
  if (!reason || !reason.trim()) {
    throw new Error(message);
  }
}

export interface CreateHourBlockPurchaseInvoiceInternalInput {
  trx: Knex.Transaction;
  tenant: string;
  clientId: string;
  serviceId: string;
  hours: number;
  hourlyRate: number;
  expirationDate?: string | Date | null;
  scopeServiceIds?: string[];
  notes?: string | null;
  client: DbRow;
  service: DbRow;
  currencyCode: string;
  dueDate: string;
  taxSource: unknown;
  invoiceNumber: string;
  createdBy: string | null;
  replenishmentBucketUsageId?: string | null;
}

/**
 * Shared invoice-backed hour-block core. Authenticated purchase actions and
 * system replenishment both use this so the pending-block lifecycle, tax,
 * source-line linkage, and audit inputs cannot drift apart.
 */
export async function createHourBlockPurchaseInvoiceInternal(
  input: CreateHourBlockPurchaseInvoiceInternalInput,
): Promise<{ invoiceId: string; blockId: string; invoiceNumber: string }> {
  const {
    trx,
    tenant,
    clientId,
    serviceId,
    hours,
    hourlyRate,
    expirationDate,
    scopeServiceIds,
    notes,
    client,
    service,
    currencyCode,
    dueDate,
    taxSource,
    invoiceNumber,
    createdBy,
    replenishmentBucketUsageId,
  } = input;
  const sessionLike = { user: { id: createdBy } };
  const invoiceId = uuidv4();
  const blockId = uuidv4();
  const totalMinutes = Math.round(hours * 60);
  const purchaseAmount = Math.round(hours * hourlyRate);
  const invoice = {
    invoice_id: invoiceId,
    tenant,
    client_id: clientId,
    invoice_date: Temporal.Now.plainDateISO().toString(),
    due_date: dueDate,
    invoice_number: invoiceNumber,
    status: 'draft',
    currency_code: currencyCode,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    credit_applied: 0,
    is_manual: true,
    is_prepayment: false,
    credit_expiration_date: null,
    tax_source: taxSource,
  };
  await tenantScopedTable(trx, tenant, 'invoices').insert(invoice);

  await invoiceService.persistManualInvoiceCharges(
    trx,
    invoiceId,
    [{
      service_id: serviceId,
      quantity: hours,
      rate: hourlyRate,
      description: `Prepaid hour block — ${service.service_name}`,
      is_discount: false,
    }],
    client,
    sessionLike as any,
    tenant,
  );

  await invoiceService.calculateAndDistributeTax(trx, invoiceId, client, new TaxService(), tenant);
  await invoiceService.updateInvoiceTotalsAndRecordTransaction(trx, invoiceId, client, tenant, invoiceNumber);

  const purchaseLine = await tenantScopedTable(trx, tenant, 'invoice_charges')
    .where({ invoice_id: invoiceId, tenant, service_id: serviceId })
    .first();
  if (!purchaseLine) throw new Error('Purchase invoice line not found after creation');

  await tenantScopedTable(trx, tenant, 'hour_blocks').insert({
    block_id: blockId,
    tenant,
    client_id: clientId,
    service_id: serviceId,
    total_minutes: totalMinutes,
    remaining_minutes: totalMinutes,
    hourly_rate: Math.round(hourlyRate),
    purchase_amount: purchaseAmount,
    currency_code: currencyCode,
    status: 'pending',
    purchased_at: null,
    expiration_date: toCalendarDateString(expirationDate),
    source_invoice_id: invoiceId,
    source_invoice_charge_id: purchaseLine.item_id,
    replenishment_bucket_usage_id: replenishmentBucketUsageId ?? null,
    source_type: 'purchase',
    created_by: createdBy,
    notes: notes?.trim() || null,
  });
  await resolveScopeServiceIds(trx, tenant, blockId, scopeServiceIds);
  return { invoiceId, blockId, invoiceNumber };
}

/**
 * Creates a draft purchase invoice for an hour block plus the linked `pending`
 * hour_blocks row. Finalizing the invoice flips the block to `active` and mints
 * the purchase (see the finalize hook in invoiceModification). The invoice
 * carries one line (service, quantity = hours, rate = hourlyRate) so tax rides
 * the service's tax settings; the rate is editable per purchase.
 */
export const createHourBlockPurchaseInvoice = withAuth(async (
  user,
  { tenant },
  input: IHourBlockPurchaseInput,
): Promise<{ invoiceId: string; blockId: string; invoiceNumber: string } | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'create')) {
      throw new Error('Permission denied: Cannot create hour block purchase invoices');
    }
    const { clientId, serviceId, hours, hourlyRate, expirationDate, scopeServiceIds, notes } = input;
    if (!clientId) throw new Error('Client ID is required');
    if (!Number.isFinite(hours) || hours <= 0) throw new Error('Block hours must be greater than zero');
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) throw new Error('Hourly rate must be zero or greater');
    if (!serviceId) throw new Error('Service not found');

    const { knex } = await createTenantKnex();
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const client = await tenantScopedTable(trx, tenant, 'clients')
        .where({ client_id: clientId, tenant })
        .first();
      if (!client) throw new Error('Client not found');

      const service = await tenantScopedTable(trx, tenant, 'service_catalog')
        .where({ service_id: serviceId, tenant })
        .first();
      if (!service) throw new Error(`Service ${serviceId} not found`);

      const currencyCode = client.default_currency_code || 'USD';
      const currentDate = Temporal.Now.plainDateISO().toString();
      const dueDate = await getDueDate(clientId, currentDate);
      if (isActionError(dueDate)) throw new Error(getErrorMessage(dueDate));
      const taxSource = await getInitialInvoiceTaxSource(clientId);
      if (isActionError(taxSource)) throw new Error(getErrorMessage(taxSource));

      return createHourBlockPurchaseInvoiceInternal({
        trx,
        tenant,
        clientId,
        serviceId,
        hours,
        hourlyRate,
        expirationDate,
        scopeServiceIds,
        notes,
        client,
        service,
        currencyCode,
        dueDate,
        taxSource,
        invoiceNumber: await generateInvoiceNumber(),
        createdBy: user.user_id,
      });
    });

    return result;
  });
});

/**
 * Mints an hour block directly — no invoice (comped hours / PSA migrations).
 * The block is `active` immediately and carries an audit `grant` row.
 */
export const grantHourBlock = withAuth(async (
  user,
  { tenant },
  input: IHourBlockGrantInput,
): Promise<IHourBlock | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'create')) {
      throw new Error('Permission denied: Cannot grant hour blocks');
    }
    const { clientId, serviceId, hours, hourlyRate, expirationDate, scopeServiceIds, reason, notes } = input;
    if (!clientId) throw new Error('Client ID is required');
    if (!Number.isFinite(hours) || hours <= 0) throw new Error('Block hours must be greater than zero');
    if (hourlyRate != null && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) {
      throw new Error('Hourly rate must be zero or greater');
    }
    if (!serviceId) throw new Error('Service not found');
    assertReason(reason, 'Reason is required for this operation');

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const client = await tenantScopedTable(trx, tenant, 'clients')
        .where({ client_id: clientId, tenant })
        .first();
      if (!client) throw new Error('Client not found');

      const blockId = uuidv4();
      const now = new Date().toISOString();
      const totalMinutes = Math.round(hours * 60);
      const rate = hourlyRate != null ? Math.round(hourlyRate) : 0;

      await tenantScopedTable(trx, tenant, 'hour_blocks').insert({
        block_id: blockId,
        tenant,
        client_id: clientId,
        service_id: serviceId,
        total_minutes: totalMinutes,
        remaining_minutes: totalMinutes,
        hourly_rate: rate,
        purchase_amount: rate > 0 ? Math.round(hours * rate) : 0,
        currency_code: client.default_currency_code || 'USD',
        status: 'active',
        purchased_at: now,
        expiration_date: toCalendarDateString(expirationDate),
        source_invoice_id: null,
        source_type: 'grant',
        created_by: user.user_id,
        notes: notes?.trim() || null,
      });

      await resolveScopeServiceIds(trx, tenant, blockId, scopeServiceIds);
      await writeAudit(trx, tenant, {
        blockId,
        type: 'grant',
        createdBy: user.user_id,
        reason: reason.trim(),
      });

      const block = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .first();
      return block as IHourBlock;
    });
  });
});

/**
 * Adjusts a block's remaining minutes (reason required). Clamps at ≥ 0 and
 * writes an audit row carrying the delta.
 */
export const adjustHourBlockRemaining = withAuth(async (
  user,
  { tenant },
  blockId: string,
  minutesDelta: number,
  reason: string,
): Promise<IHourBlock | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'update')) {
      throw new Error('Permission denied: Cannot adjust hour blocks');
    }
    assertReason(reason, 'Reason is required for this operation');
    if (!Number.isFinite(minutesDelta)) throw new Error('Block hours must be greater than zero');

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Row-lock (canonical order — see selectEligibleBlocks) so the remaining
      // read that feeds BOTH the clamped write and the audit's
      // previous_remaining_minutes serializes against a concurrent
      // allocateTimeEntry decrement on the same block: an unlocked read plus
      // an absolute-value write silently erased the burn (lost update,
      // 29.8.18 mitigation round 3).
      const block = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .forUpdate()
        .first();
      if (!block) throw new Error(`Hour block with ID ${blockId} not found`);
      if (block.status === 'expired' || block.status === 'voided') {
        throw new Error('Cannot adjust an expired or voided hour block');
      }

      const newRemaining = Math.max(0, Number(block.remaining_minutes) + minutesDelta);
      await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .update({ remaining_minutes: newRemaining, updated_at: new Date().toISOString() });

      await writeAudit(trx, tenant, {
        blockId,
        type: 'adjustment',
        minutesDelta,
        createdBy: user.user_id,
        reason: reason.trim(),
        metadata: { previous_remaining_minutes: Number(block.remaining_minutes) },
      });

      const updated = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .first();
      return updated as IHourBlock;
    });
  });
});

/**
 * Edits a block's expiration date (or clears it with null). Writes an audit
 * row recording the previous date.
 */
export const updateHourBlockExpiration = withAuth(async (
  user,
  { tenant },
  blockId: string,
  newDate: string | null,
): Promise<IHourBlock | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'update')) {
      throw new Error('Permission denied: Cannot update hour block expiration');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Row-lock (canonical order — see selectEligibleBlocks) so the voided
      // check and the expiration write serialize against a concurrent
      // burn/expire/void transition on the same block (same shape as
      // manuallyExpireHourBlock / voidHourBlock).
      const block = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .forUpdate()
        .first();
      if (!block) throw new Error(`Hour block with ID ${blockId} not found`);
      if (block.status === 'voided') throw new Error('Cannot update expiration of a voided hour block');

      const normalized = toCalendarDateString(newDate);
      await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .update({ expiration_date: normalized, updated_at: new Date().toISOString() });

      await writeAudit(trx, tenant, {
        blockId,
        type: 'expiration_date_change',
        createdBy: user.user_id,
        reason: null,
        metadata: {
          previous_expiration_date: toCalendarDateString(block.expiration_date),
          new_expiration_date: normalized,
        },
      });

      const updated = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .first();
      return updated as IHourBlock;
    });
  });
});

/**
 * Manually expires an active block. `remaining_minutes` is kept as-is for
 * display ("expired with 3.5 hrs unused") — the audit row carries the amount.
 */
export const manuallyExpireHourBlock = withAuth(async (
  user,
  { tenant },
  blockId: string,
  reason: string,
): Promise<IHourBlock | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'update')) {
      throw new Error('Permission denied: Cannot expire hour blocks');
    }
    assertReason(reason, 'Reason is required for this operation');

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Row-lock (canonical order — see selectEligibleBlocks) so the
      // status check and the expired transition serialize against a
      // concurrent allocateTimeEntry on the same block.
      const block = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .forUpdate()
        .first();
      if (!block) throw new Error(`Hour block with ID ${blockId} not found`);
      if (block.status === 'voided') throw new Error('Cannot expire a voided hour block');
      if (block.status === 'pending') throw new Error('Cannot expire a pending hour block; void its draft invoice instead');

      await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .update({ status: 'expired', updated_at: new Date().toISOString() });

      await writeAudit(trx, tenant, {
        blockId,
        type: 'manual_expiration',
        createdBy: user.user_id,
        reason: reason.trim(),
        metadata: { remaining_minutes_at_expiration: Number(block.remaining_minutes) },
      });

      const updated = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .first();
      return updated as IHourBlock;
    });
  });
});

/**
 * Voids a block before any burn: only `pending`/`active` blocks that have
 * NEVER had an allocation recorded may be voided. The authoritative guard is
 * the immutable `first_allocated_at` marker (set at the first burn, never
 * cleared by reversal/reconcile/entry-edit churn), so a block whose burns were
 * fully reversed still refuses voiding. The live allocation-row count is kept
 * as a belt-and-suspenders second condition. Draft-invoice deletion routes
 * through here for the linked pending block.
 */
export const voidHourBlock = withAuth(async (
  user,
  { tenant },
  blockId: string,
  reason: string,
): Promise<IHourBlock | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'update')) {
      throw new Error('Permission denied: Cannot void hour blocks');
    }
    assertReason(reason, 'Reason is required for this operation');

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Row-lock (canonical order — see selectEligibleBlocks) so the void
      // guard's used-check serializes against a concurrent allocateTimeEntry:
      // the marker and allocation rows the guard reads are necessarily
      // committed state, not an in-flight burn.
      const block = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .forUpdate()
        .first();
      if (!block) throw new Error(`Hour block with ID ${blockId} not found`);
      if (block.status !== 'pending' && block.status !== 'active') {
        throw new Error('Only pending or active hour blocks can be voided');
      }

      // Authoritative: the immutable "ever used" marker survives reversal.
      if (block.first_allocated_at != null) {
        throw new Error('Cannot void an hour block that has been used');
      }

      const allocationCount = await tenantScopedTable(trx, tenant, 'hour_block_time_allocations')
        .where({ block_id: blockId, tenant })
        .count({ count: '*' })
        .first();
      if (Number(allocationCount?.count ?? 0) > 0) {
        throw new Error('Cannot void an hour block that has been used');
      }

      const now = new Date().toISOString();
      await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .update({
          status: 'voided',
          voided_at: now,
          voided_by: user.user_id,
          void_reason: reason.trim(),
          updated_at: now,
        });

      await writeAudit(trx, tenant, {
        blockId,
        type: 'void',
        createdBy: user.user_id,
        reason: reason.trim(),
      });

      const updated = await tenantScopedTable(trx, tenant, 'hour_blocks')
        .where({ block_id: blockId, tenant })
        .first();
      return updated as IHourBlock;
    });
  });
});

/**
 * Lists a client's hour blocks with display joins (service name, source
 * invoice number, scopes, and a used flag for the void guard). The used flag
 * derives from the immutable `first_allocated_at` marker so it agrees with the
 * server-side void guard even after a burn was reversed.
 */
export const listHourBlocks = withAuth(async (
  user,
  { tenant },
  clientId: string,
): Promise<IHourBlock[] | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read hour blocks');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const blocksQuery = scopedDb.table('hour_blocks as hb') as Knex.QueryBuilder;
      scopedDb.tenantJoin(blocksQuery, 'service_catalog as sc', 'hb.service_id', 'sc.service_id', { type: 'left' });
      scopedDb.tenantJoin(blocksQuery, 'invoices as inv', 'hb.source_invoice_id', 'inv.invoice_id', { type: 'left' });
      const rows = await blocksQuery
        .where({ 'hb.client_id': clientId })
        .select(
          'hb.*',
          'sc.service_name as service_name',
          'inv.invoice_number as invoice_number',
          'inv.status as invoice_status',
          trx.raw('(hb.first_allocated_at IS NOT NULL) as has_allocations'),
        )
        .orderBy('hb.purchased_at', 'asc')
        .orderBy('hb.created_at', 'asc');

      let scopesByBlock = new Map<string, Array<{ service_id: string; service_name?: string }>>();
      if (rows.length > 0) {
        const scopesQuery = scopedDb.table('hour_block_service_scopes') as Knex.QueryBuilder;
        scopedDb.tenantJoin(scopesQuery, 'service_catalog as sc', 'hour_block_service_scopes.service_id', 'sc.service_id', { type: 'left' });
        const scopes: DbRow[] = await scopesQuery
          .whereIn('hour_block_service_scopes.block_id', rows.map((row: DbRow) => row.block_id))
          .select('hour_block_service_scopes.block_id', 'hour_block_service_scopes.service_id', 'sc.service_name as service_name');
        scopesByBlock = new Map<string, Array<{ service_id: string; service_name?: string }>>();
        for (const scope of scopes) {
          const list = scopesByBlock.get(scope.block_id) ?? [];
          list.push({ service_id: scope.service_id, service_name: scope.service_name });
          scopesByBlock.set(scope.block_id, list);
        }
      }

      return rows.map((row: DbRow) => ({
        ...row,
        scope_service_ids: scopesByBlock.get(row.block_id)?.map((scope) => scope.service_id) ?? [],
        scope_services: scopesByBlock.get(row.block_id) ?? [],
        has_allocations: Boolean(row.has_allocations),
        expiration_date: toCalendarDateString(row.expiration_date),
        remaining_value: Math.round((Number(row.remaining_minutes) / 60) * Number(row.hourly_rate)),
      })) as IHourBlock[];
    });
  });
});

/**
 * Full detail for one block: scopes, allocation/burn history, and audit trail.
 */
export const getHourBlockDetail = withAuth(async (
  user,
  { tenant },
  blockId: string,
): Promise<{
  block: IHourBlock;
  scopes: IHourBlockServiceScope[];
  allocations: IHourBlockAllocation[];
  audit: IHourBlockAuditEntry[];
} | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read hour blocks');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const blockQuery = scopedDb.table('hour_blocks as hb') as Knex.QueryBuilder;
      scopedDb.tenantJoin(blockQuery, 'invoices as inv', 'hb.source_invoice_id', 'inv.invoice_id', { type: 'left' });
      scopedDb.tenantJoin(blockQuery, 'service_catalog as sc', 'hb.service_id', 'sc.service_id', { type: 'left' });
      const block = await blockQuery
        .where({ 'hb.block_id': blockId })
        .select(
          'hb.*',
          'inv.invoice_number as invoice_number',
          'inv.status as invoice_status',
          'sc.service_name as service_name',
        )
        .first();
      if (!block) throw new Error(`Hour block with ID ${blockId} not found`);

      const scopesQuery = scopedDb.table('hour_block_service_scopes') as Knex.QueryBuilder;
      scopedDb.tenantJoin(scopesQuery, 'service_catalog as sc', 'hour_block_service_scopes.service_id', 'sc.service_id', { type: 'left' });
      const scopes = await scopesQuery
        .where({ 'hour_block_service_scopes.block_id': blockId, 'hour_block_service_scopes.tenant': tenant })
        .select('hour_block_service_scopes.block_id', 'hour_block_service_scopes.service_id', 'hour_block_service_scopes.created_at', 'sc.service_name as service_name');

      const allocationsQuery = tenantScopedTable<any>(trx, tenant, 'hour_block_time_allocations as hba')
        .where({ 'hba.block_id': blockId, 'hba.tenant': tenant })
        .select(
          'hba.allocation_id',
          'hba.block_id',
          'hba.time_entry_id',
          'hba.minutes',
          'hba.created_at',
          'te.work_item_id',
          'te.work_item_type',
          { entry_date: 'te.work_date' },
          'te.start_time',
          'u.first_name as user_first_name',
          'u.last_name as user_last_name',
          'u.username as user_username',
        );
      scopedDb.tenantJoin(allocationsQuery, 'time_entries as te', 'hba.time_entry_id', 'te.entry_id', { type: 'left' });
      scopedDb.tenantJoin(allocationsQuery, 'users as u', 'te.user_id', 'u.user_id', { type: 'left' });
      const allocations = await allocationsQuery;

      const allocationsWithUser = (allocations as DbRow[]).map((a) => {
        const { user_first_name, user_last_name, user_username, ...rest } = a;
        return {
          ...rest,
          // pg DATE (work_date) is a local-midnight Date; normalize to a plain
          // YYYY-MM-DD so the drawer never reparses a date-only value.
          entry_date: toCalendarDateString(rest.entry_date as string | Date | null | undefined),
          user_name: [user_first_name, user_last_name].filter(Boolean).join(' ').trim() || user_username || null,
        };
      });

      const audit = await tenantScopedTable(trx, tenant, 'hour_block_audit')
        .where({ block_id: blockId, tenant })
        .orderBy('created_at', 'desc');

      return {
        block: {
          ...block,
          expiration_date: toCalendarDateString(block.expiration_date),
          remaining_value: Math.round((Number(block.remaining_minutes) / 60) * Number(block.hourly_rate)),
        } as IHourBlock,
        scopes: scopes as IHourBlockServiceScope[],
        allocations: allocationsWithUser as IHourBlockAllocation[],
        audit: audit as IHourBlockAuditEntry[],
      };
    });
  });
});

/**
 * Derived available block minutes for a client (active, non-expired, optional
 * service scope). Backs the UI balance chips.
 */
export const getAvailableHourBlockMinutesForClient = withAuth(async (
  user,
  { tenant },
  clientId: string,
  serviceId?: string,
): Promise<number | HourBlockActionError> => {
  return withHourBlockActionErrors(async () => {
    if (!await hasPermission(user, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read hour blocks');
    }
    const { knex } = await createTenantKnex();
    return getAvailableHourBlockMinutes(knex, tenant, clientId, serviceId);
  });
});
