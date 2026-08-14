/*
 * CANONICAL shared hour-block service. This is the single source of truth for
 * burning ad-hoc prepaid hour blocks (minutes-denominated, purchase-minted,
 * FIFO by expiration-then-purchase). Do NOT fork or re-implement this logic
 * elsewhere — call these exports from
 * `@alga-psa/shared/billingClients/hourBlockService`
 * (`isEntryEligibleForBlockBurn`, `allocateTimeEntry`,
 * `reverseTimeEntryAllocations`, `reconcileClientAllocations`,
 * `getAvailableHourBlockMinutes`) instead. Both @alga-psa/scheduling
 * (time-entry save/update/delete) and @alga-psa/billing (billing engine,
 * reconcile job) import this module; a stale fork that drifted on contract
 * coverage or FIFO ordering would mis-burn blocks.
 *
 * Burn model (docs/plans/2026-08-13-ad-hoc-prepaid-hour-blocks-plan.md):
 *  - Blocks catch billable time NOT matched to any contract line — contracts
 *    always win. An entry is eligible when `contract_line_id` is null AND its
 *    service is not deterministically assignable to exactly one active
 *    contract line for the client at the entry's date.
 *  - FIFO across a client's blocks by expiration-then-purchase; one entry can
 *    span blocks. When blocks run dry, the remainder stays unallocated and is
 *    billed as ordinary non-contract time.
 *  - Burns are recorded in `hour_block_time_allocations` (one row per
 *    block/entry pair) and `remaining_minutes` is decremented in the same
 *    transaction. On update the entry is reversed then re-allocated (clean
 *    FIFO, no delta bookkeeping); on delete it is reversed.
 */
import type { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { toPlainDate, toISODate } from '@alga-psa/core';
import type { IHourBlock } from '@alga-psa/types';

/**
 * The subset of a time entry the burn engine reads. Entries are resolved to a
 * client through their work item (time_entries has no client_id column).
 */
export interface BlockBurnTimeEntry {
  entry_id: string;
  service_id?: string | null;
  billable_duration?: number | null;
  contract_line_id?: string | null;
  work_item_id?: string | null;
  work_item_type?: string | null;
  /** DATE value (YYYY-MM-DD or a Date/pg date). Falls back to start_time. */
  work_date?: string | Date | null;
  start_time?: string | Date | null;
}

interface EligibleBlock {
  block_id: string;
  remaining_minutes: number;
  expiration_date: string | null;
  purchased_at: string | null;
}

interface FifoAllocation {
  block_id: string;
  minutes: number;
}

/**
 * Pure FIFO allocation math (no I/O), exported for unit tests and for callers
 * that must preview a burn without writing. `blocks` must already be ordered
 * FIFO (expiration_date ASC NULLS LAST, purchased_at ASC). The entry is burned
 * as far as blocks allow; the uncovered remainder is simply not returned.
 */
export function computeFifoAllocation(
  neededMinutes: number,
  blocks: Array<Pick<EligibleBlock, 'block_id' | 'remaining_minutes'>>,
): FifoAllocation[] {
  const allocations: FifoAllocation[] = [];
  let remaining = Math.max(0, Math.floor(neededMinutes) || 0);
  if (remaining === 0) {
    return allocations;
  }

  for (const block of blocks) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(block.remaining_minutes) || 0);
    if (available <= 0) continue;
    const minutes = Math.min(available, remaining);
    allocations.push({ block_id: block.block_id, minutes });
    remaining -= minutes;
  }

  return allocations;
}

/** Normalizes a DATE/ISO value to YYYY-MM-DD for date comparisons. */
function toDateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  try {
    return toISODate(toPlainDate(value as string));
  } catch {
    return String(value).slice(0, 10);
  }
}

/**
 * Resolves the owning client for a time entry through its work item. Mirrors
 * the scheduling action helper but transaction-scoped and auth-free so both
 * the burn engine and the reconcile job share one resolution.
 */
export async function resolveClientIdForWorkItem(
  trx: Knex.Transaction,
  tenant: string,
  workItemId: string | null | undefined,
  workItemType: string | null | undefined,
): Promise<string | null> {
  if (!workItemId || !workItemType) return null;
  const db = tenantDb(trx, tenant);

  if (workItemType === 'project_task') {
    const query = db.table('project_tasks');
    db.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    db.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id');
    const row = await query
      .where({ 'project_tasks.task_id': workItemId })
      .first<{ client_id: string }>('projects.client_id as client_id');
    return row?.client_id || null;
  }
  if (workItemType === 'ticket') {
    const row = await db.table('tickets').where({ ticket_id: workItemId }).first<{ client_id: string }>('client_id');
    return row?.client_id || null;
  }
  if (workItemType === 'interaction') {
    const row = await db.table('interactions').where({ interaction_id: workItemId }).first<{ client_id: string }>('client_id');
    return row?.client_id || null;
  }
  return null;
}

/**
 * Number of distinct active contract lines that cover `serviceId` for the
 * client at `workDate`. Mirrors BillingEngine.getEligibleContractLineIdsFor-
 * ServiceAtDate: exactly one line means the entry is deterministically
 * contract-covered; zero or many means it is not deterministically assigned.
 */
export async function getEligibleContractLineCountForServiceAtDate(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  serviceId: string,
  workDate: string,
): Promise<number> {
  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'c.contract_id');
  db.tenantJoin(query, 'contract_line_services as cls', 'cls.contract_line_id', 'cl.contract_line_id');
  const row = await query
    .where({ 'cc.client_id': clientId, 'cc.is_active': true, 'cls.service_id': serviceId })
    .where('cc.start_date', '<=', workDate)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('cc.end_date').orWhere('cc.end_date', '>=', workDate);
    })
    .countDistinct('cl.contract_line_id as line_count')
    .first<{ line_count: string | number }>();
  return Number(row?.line_count ?? 0);
}

/**
 * True when a billable time entry may draw down hour blocks: it has a service,
 * a positive billable duration, resolves to a client, carries no contract
 * line, and its service is not deterministically assigned to the client's
 * single active contract line at the entry's date.
 */
export async function isEntryEligibleForBlockBurn(
  trx: Knex.Transaction,
  tenant: string,
  entry: BlockBurnTimeEntry,
  clientId?: string | null,
): Promise<boolean> {
  if (!entry.service_id) return false;
  if (Math.floor(Number(entry.billable_duration) || 0) <= 0) return false;
  if (entry.contract_line_id) return false;

  const resolvedClientId = clientId ?? (await resolveClientIdForWorkItem(trx, tenant, entry.work_item_id, entry.work_item_type));
  if (!resolvedClientId) return false;

  const workDate = toDateOnly(entry.work_date) ?? toDateOnly(entry.start_time);
  if (!workDate) return false;

  const lineCount = await getEligibleContractLineCountForServiceAtDate(
    trx,
    tenant,
    resolvedClientId,
    entry.service_id,
    workDate,
  );
  return lineCount !== 1;
}

/**
 * Selects the FIFO-ordered blocks eligible to burn for one entry: active, with
 * remaining minutes, not expired at the entry's date, and whose scope covers
 * the entry's service. Scope semantics: a block with zero scope rows covers all
 * labor; a block with scope rows covers exactly those services. Implemented
 * with NOT EXISTS/EXISTS so a block scoped to [A,B] is NOT eligible for an
 * entry on service C (a naive LEFT JOIN ON scopes.service_id = C would have
 * treated the no-match row as "unscoped").
 */
async function selectEligibleBlocks(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  entry: BlockBurnTimeEntry,
): Promise<EligibleBlock[]> {
  const db = tenantDb(trx, tenant);
  const workDate = toDateOnly(entry.work_date) ?? toDateOnly(entry.start_time);
  if (!workDate) return [];

  return await db.table('hour_blocks as hb')
    .where({ 'hb.client_id': clientId, 'hb.status': 'active' })
    .where('hb.remaining_minutes', '>', 0)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.expiration_date').orWhere('hb.expiration_date', '>=', workDate);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNotExists(function (this: Knex.QueryBuilder) {
        this.select('*')
          .from('hour_block_service_scopes as s')
          .whereRaw('s.tenant = hb.tenant')
          .whereRaw('s.block_id = hb.block_id');
      });
      this.orWhereExists(function (this: Knex.QueryBuilder) {
        this.select('*')
          .from('hour_block_service_scopes as s2')
          .whereRaw('s2.tenant = hb.tenant')
          .whereRaw('s2.block_id = hb.block_id')
          .where('s2.service_id', entry.service_id ?? '');
      });
    })
    .select('hb.block_id', 'hb.remaining_minutes', 'hb.expiration_date', 'hb.purchased_at')
    .orderByRaw('hb.expiration_date ASC NULLS LAST')
    .orderBy('hb.purchased_at', 'asc')
    .orderBy('hb.created_at', 'asc')
    .then((rows: any[]) =>
      rows.map((row) => ({
        block_id: row.block_id,
        remaining_minutes: Number(row.remaining_minutes),
        expiration_date: row.expiration_date ? toDateOnly(row.expiration_date) : null,
        purchased_at: row.purchased_at ? new Date(row.purchased_at).toISOString() : null,
      })),
    );
}

/**
 * Burns an entry's billable minutes across its eligible blocks FIFO. Writes
 * hour_block_time_allocations rows and decrements remaining_minutes in the
 * same transaction. The uncovered remainder is left unallocated (normal
 * billable time). Returns the allocation rows written.
 */
export async function allocateTimeEntry(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  entry: BlockBurnTimeEntry,
): Promise<FifoAllocation[]> {
  if (!(await isEntryEligibleForBlockBurn(trx, tenant, entry, clientId))) {
    return [];
  }

  const neededMinutes = Math.floor(Number(entry.billable_duration) || 0);
  if (neededMinutes <= 0) return [];

  const blocks = await selectEligibleBlocks(trx, tenant, clientId, entry);
  const allocations = computeFifoAllocation(neededMinutes, blocks);
  if (allocations.length === 0) return allocations;

  const db = tenantDb(trx, tenant);
  const now = new Date().toISOString();
  for (const allocation of allocations) {
    await db.table('hour_block_time_allocations').insert({
      tenant,
      block_id: allocation.block_id,
      time_entry_id: entry.entry_id,
      minutes: allocation.minutes,
    });
    await db.table('hour_blocks')
      .where({ tenant, block_id: allocation.block_id })
      .update({
        remaining_minutes: trx.raw('remaining_minutes - ?', [allocation.minutes]),
        updated_at: now,
      });
  }

  return allocations;
}

/**
 * Reverses an entry's burn: deletes its allocation rows and restores the
 * minutes to each block's remaining balance. Used on entry delete and as the
 * first half of update (reverse + re-allocate = clean FIFO).
 */
export async function reverseTimeEntryAllocations(
  trx: Knex.Transaction,
  tenant: string,
  timeEntryId: string,
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const allocations = await db.table('hour_block_time_allocations')
    .where({ tenant, time_entry_id: timeEntryId })
    .select('block_id', 'minutes');

  if (allocations.length === 0) return;

  const now = new Date().toISOString();
  for (const allocation of allocations) {
    await db.table('hour_blocks')
      .where({ tenant, block_id: allocation.block_id })
      .update({
        remaining_minutes: trx.raw('remaining_minutes + ?', [Number(allocation.minutes)]),
        updated_at: now,
      });
  }

  await db.table('hour_block_time_allocations')
    .where({ tenant, time_entry_id: timeEntryId })
    .delete();
}

/**
 * Reverses an entry's burn, but only against blocks owned by `clientId`.
 * Used by the nightly reconcile so one client's pass can never touch another
 * client's block balances.
 */
async function reverseClientTimeEntryAllocations(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  timeEntryId: string,
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const allocationQuery = db.table('hour_block_time_allocations as hba');
  db.tenantJoin(allocationQuery, 'hour_blocks as hb', 'hba.block_id', 'hb.block_id');
  const allocations = await allocationQuery
    .where({ 'hba.time_entry_id': timeEntryId, 'hb.client_id': clientId })
    .select('hba.block_id', 'hba.minutes');

  if (allocations.length === 0) return;

  const now = new Date().toISOString();
  for (const allocation of allocations) {
    await db.table('hour_blocks')
      .where({ tenant, block_id: allocation.block_id })
      .update({
        remaining_minutes: trx.raw('remaining_minutes + ?', [Number(allocation.minutes)]),
        updated_at: now,
      });
  }

  const blockIds = allocations.map((allocation) => allocation.block_id);
  await db.table('hour_block_time_allocations')
    .where({ tenant, time_entry_id: timeEntryId })
    .whereIn('block_id', blockIds)
    .delete();
}

/**
 * Eligible entries belonging to one client, resolved through their work items
 * in SQL (time_entries has no client_id column). Restricts the reconcile
 * candidate set to this client, so a full nightly pass costs
 * O(entries-of-this-client) instead of O(clients × tenant-entries), and a
 * client's pass can never touch another client's entries.
 */
async function selectClientEligibleEntries(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<Array<BlockBurnTimeEntry & { entry_id: string }>> {
  const db = tenantDb(trx, tenant);
  const query = db.table('time_entries as te');
  db.tenantJoin(query, 'tickets as tk', 'te.work_item_id', 'tk.ticket_id', {
    type: 'left',
    on(join) {
      join.andOnVal('te.work_item_type', '=', 'ticket');
    },
  });
  db.tenantJoin(query, 'project_tasks as pta', 'te.work_item_id', 'pta.task_id', {
    type: 'left',
    on(join) {
      join.andOnVal('te.work_item_type', '=', 'project_task');
    },
  });
  db.tenantJoin(query, 'project_phases as pp', 'pta.phase_id', 'pp.phase_id', { type: 'left' });
  db.tenantJoin(query, 'projects as p', 'pp.project_id', 'p.project_id', { type: 'left' });
  db.tenantJoin(query, 'interactions as i', 'te.work_item_id', 'i.interaction_id', {
    type: 'left',
    on(join) {
      join.andOnVal('te.work_item_type', '=', 'interaction');
    },
  });

  return await query
    .where('te.tenant', tenant)
    .whereNull('te.contract_line_id')
    .whereNotNull('te.service_id')
    .where('te.invoiced', false)
    .where('te.billable_duration', '>', 0)
    .where(function (this: Knex.QueryBuilder) {
      this.where('tk.client_id', clientId)
        .orWhere('p.client_id', clientId)
        .orWhere('i.client_id', clientId);
    })
    .select(
      'te.entry_id',
      'te.service_id',
      'te.billable_duration',
      'te.contract_line_id',
      'te.work_item_id',
      'te.work_item_type',
      'te.work_date',
      'te.start_time',
    );
}

/**
 * Nightly reconcile: recomputes allocations for a client's time entries from
 * scratch (reverse + re-allocate), so drift introduced by contract-signing
 * after a burn, approval changes, edited durations, or missed save-time burns
 * converges to the canonical FIFO state. Idempotent by construction — the
 * result depends only on current entry state and block balances.
 *
 * Scope is strictly this client: candidates are (a) entries with allocations
 * against this client's blocks, and (b) eligible entries that resolve to this
 * client (joined in SQL). Entries of other clients are never touched, and
 * INVOICED entries are skipped entirely — their allocations are locked by the
 * finalized invoice and reversing them would inflate balances nightly.
 */
export async function reconcileClientAllocations(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<number> {
  const db = tenantDb(trx, tenant);

  // Entries that already carry allocations against one of this client's blocks,
  // joined to time_entries so INVOICED entries are excluded (locked by invoice).
  const allocationQuery = db.table('hour_block_time_allocations as hba');
  db.tenantJoin(allocationQuery, 'hour_blocks as hb', 'hba.block_id', 'hb.block_id');
  db.tenantJoin(allocationQuery, 'time_entries as te', 'hba.time_entry_id', 'te.entry_id');
  const withAllocations = await allocationQuery
    .where({ 'hb.client_id': clientId, 'te.invoiced': false })
    .distinct('hba.time_entry_id')
    .then((rows: any[]) => rows.map((row) => row.time_entry_id));

  const clientEligible = await selectClientEligibleEntries(trx, tenant, clientId);

  const entryById = new Map<string, BlockBurnTimeEntry>();
  for (const entry of clientEligible) {
    entryById.set(entry.entry_id, entry);
  }
  // Entries with allocations but no longer eligible need their full row state
  // for the eligibility re-check; fetch those not already loaded.
  const missingIds = withAllocations.filter((id) => !entryById.has(id));
  if (missingIds.length > 0) {
    const staleRows = await db.table('time_entries')
      .whereIn('entry_id', missingIds)
      .where('invoiced', false)
      .select('entry_id', 'service_id', 'billable_duration', 'contract_line_id', 'work_item_id', 'work_item_type', 'work_date', 'start_time');
    for (const row of staleRows) {
      entryById.set(row.entry_id, row);
    }
  }

  const candidateIds = new Set<string>([...withAllocations, ...entryById.keys()]);

  let reconciled = 0;
  for (const entryId of candidateIds) {
    const entry = entryById.get(entryId) ?? { entry_id: entryId };

    // An entry with allocations against this client's blocks must resolve to
    // this client. If it does not (work item deleted/moved), reverse only the
    // allocations owned by this client — never another client's blocks.
    const entryClientId = await resolveClientIdForWorkItem(trx, tenant, entry.work_item_id, entry.work_item_type);
    if (entryClientId !== clientId) {
      await reverseClientTimeEntryAllocations(trx, tenant, clientId, entryId);
      continue;
    }

    await reverseClientTimeEntryAllocations(trx, tenant, clientId, entryId);
    if (await isEntryEligibleForBlockBurn(trx, tenant, entry, clientId)) {
      await allocateTimeEntry(trx, tenant, clientId, entry);
      reconciled += 1;
    }
  }

  return reconciled;
}

/**
 * Derived available block minutes for a client: the sum of `remaining_minutes`
 * over active, non-expired blocks, optionally filtered to blocks whose scope
 * includes `serviceId` (empty scope = all labor). Analog of creditBalance.
 */
export async function getAvailableHourBlockMinutes(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  serviceId?: string,
): Promise<number> {
  const db = tenantDb(conn, tenant);
  const today = toISODate(toPlainDate(new Date().toISOString()));

  const query = db.table('hour_blocks as hb');
  if (serviceId) {
    query.where(function (this: Knex.QueryBuilder) {
      this.whereNotExists(function (this: Knex.QueryBuilder) {
        this.select('*')
          .from('hour_block_service_scopes as s')
          .whereRaw('s.tenant = hb.tenant')
          .whereRaw('s.block_id = hb.block_id');
      });
      this.orWhereExists(function (this: Knex.QueryBuilder) {
        this.select('*')
          .from('hour_block_service_scopes as s2')
          .whereRaw('s2.tenant = hb.tenant')
          .whereRaw('s2.block_id = hb.block_id')
          .where('s2.service_id', serviceId);
      });
    });
  }

  const row = await query
    .where({ 'hb.client_id': clientId, 'hb.status': 'active' })
    .where('hb.remaining_minutes', '>', 0)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.expiration_date').orWhere('hb.expiration_date', '>=', today);
    })
    .sum({ total: 'hb.remaining_minutes' })
    .first<{ total: string | number }>();
  return Number(row?.total ?? 0);
}
