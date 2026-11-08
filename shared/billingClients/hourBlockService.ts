/*
 * CANONICAL shared hour-block service. This is the single source of truth for
 * burning ad-hoc prepaid hour blocks (minutes-denominated, purchase-minted,
 * FIFO by expiration-then-purchase). Do NOT fork or re-implement this logic
 * elsewhere — call these exports from
 * `@alga-psa/shared/billingClients/hourBlockService`
 * (`isEntryEligibleForBlockBurn`, `allocateTimeEntry`,
 * `reverseTimeEntryAllocations`, `reconcileClientAllocations`,
 * `getAvailableHourBlockMinutes`, `getContractLineCoverageForClient`,
 * `classifyContractLineCoverage`) instead. The last two read the SAME contract
 * coverage rule the burn uses (`coveringContractLinesQuery`). Both @alga-psa/scheduling
 * (time-entry save/update/delete) and @alga-psa/billing (billing engine,
 * reconcile job) import this module; a stale fork that drifted on contract
 * coverage or FIFO ordering would mis-burn blocks.
 *
 * Burn model (docs/plans/2026-08-13-ad-hoc-prepaid-hour-blocks-plan.md and
 * docs/plans/2026-10-13-prepaid-block-invoicing-plan.md D3):
 *  - Every entry resolves to a BURN TARGET (`resolveBlockBurnTarget`):
 *    `{ kind: 'contract', contractLineId }` when the entry's resolved contract
 *    line carries a `contract_line_prepaid_blocks` config (draws ONLY blocks
 *    issued for that line: active FIFO first, then the line's pending block as
 *    a gap draw), `{ kind: 'adhoc' }` for the rule below, or null. Contract
 *    blocks are never drawn by other lines' or non-contract time; ad-hoc blocks
 *    (contract_line_id IS NULL) are never drawn by contract time.
 *  - Ad-hoc blocks catch billable time NOT matched to any contract line — contracts
 *    always win. An entry is eligible when `contract_line_id` is null AND its
 *    service is not deterministically assignable to exactly one active
 *    contract line for the client at the entry's date.
 *  - FIFO across a client's blocks by expiration-then-purchase; one entry can
 *    span blocks. When blocks run dry, the remainder stays unallocated and is
 *    billed as ordinary non-contract time.
 *  - Burns are recorded in `hour_block_time_allocations` (one row per
 *    block/entry pair) and `remaining_minutes` is decremented in the same
 *    transaction. On update the entry is reversed then re-allocated (clean
 *    FIFO, no delta bookkeeping); on delete it is reversed. `first_allocated_at`
 *    on hour_blocks is set once at the first burn and NEVER cleared, so the
 *    void guard keeps working after reversal removes the allocation rows.
 */
import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, resolveEffectiveTimeZone } from '@alga-psa/db';
import { toCalendarDateString, toCalendarDateStringInTimeZone } from '@alga-psa/core';
import type { IHourBlock, ContractLineCoverageLine, ServiceContractLineCoverage } from '@alga-psa/types';

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
  status?: string;
  remaining_minutes: number;
  expiration_date: string | null;
  purchased_at: string | null;
  created_at?: string | null;
}

interface FifoAllocation {
  block_id: string;
  minutes: number;
}

/**
 * Value of a block's unused hours, in the block currency's minor units:
 * remaining_minutes / 60 x hourly_rate (hourly_rate is already minor units per
 * hour). Rounded once here so every surface (reports, MSP dashboard, portal)
 * shows the same figure; clients format it, they never recompute it.
 */
export function computeRemainingBlockValueMinor(block: {
  remaining_minutes: number | string | null | undefined;
  hourly_rate: number | string | null | undefined;
}): number {
  const minutes = Number(block.remaining_minutes ?? 0);
  const rate = Number(block.hourly_rate ?? 0);
  if (!Number.isFinite(minutes) || !Number.isFinite(rate) || minutes <= 0 || rate <= 0) {
    return 0;
  }
  return Math.round((minutes * rate) / 60);
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

/**
 * Normalizes a DATE/ISO value to YYYY-MM-DD for date comparisons. Routes every
 * value through {@link toCalendarDateString} so that pg DATE columns (which
 * node-postgres materializes as local-midnight `Date` objects) and DatePicker
 * values are read via their LOCAL calendar components — never through
 * `toISOString()`, which shifted a local-midnight date backward a day in
 * UTC+2 and broke expiration-boundary eligibility and FIFO ordering.
 * `YYYY-MM-DD` strings pass through byte-for-byte after validation. Unparseable
 * values resolve to `null` (the caller treats that as "no date") except a
 * well-formed date-prefixed fallback, preserving the old naive-timestamp
 * robustness without ever slicing garbage.
 */
function toDateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  try {
    return toCalendarDateString(value);
  } catch {
    const fallback = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(fallback) ? fallback : null;
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

function eligibleLinesQuery(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  serviceId: string,
  workDate: string,
) {
  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'c.contract_id');
  db.tenantJoin(query, 'contract_line_services as cls', 'cls.contract_line_id', 'cl.contract_line_id');
  return query
    .where({ 'cc.client_id': clientId, 'cc.is_active': true, 'cls.service_id': serviceId })
    .where('cc.start_date', '<=', workDate)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('cc.end_date').orWhere('cc.end_date', '>=', workDate);
    });
}

/**
 * Distinct active contract line ids that cover `serviceId` for the client at
 * `workDate`. Exactly one means the entry is deterministically contract-covered.
 */
export async function getEligibleContractLineIdsForServiceAtDate(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  serviceId: string,
  workDate: string,
): Promise<string[]> {
  const rows = await eligibleLinesQuery(trx, tenant, clientId, serviceId, workDate)
    .distinct('cl.contract_line_id as contract_line_id');
  return rows.map((row: any) => row.contract_line_id as string);
}

/**
 * The one definition of "a contract line covers a service": client_contracts
 * (client, is_active) → contracts → contract_lines → contract_line_services,
 * where the client_contracts date range overlaps [from, to]. With from = to =
 * a work date this is the point-in-time predicate the burn uses. Do not add
 * extra status filters here for one caller; that would fork the rule.
 * `serviceIds` null/omitted means no service filter.
 */
function coveringContractLinesQuery(
  db: ReturnType<typeof tenantDb>,
  clientId: string,
  { serviceIds, from, to }: { serviceIds?: string[] | null; from: string; to: string },
): Knex.QueryBuilder {
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'c.contract_id');
  db.tenantJoin(query, 'contract_line_services as cls', 'cls.contract_line_id', 'cl.contract_line_id');
  query.where({ 'cc.client_id': clientId, 'cc.is_active': true });
  if (serviceIds) {
    query.whereIn('cls.service_id', serviceIds);
  }
  return query
    .where('cc.start_date', '<=', to)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('cc.end_date').orWhere('cc.end_date', '>=', from);
    });
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
  return (await getEligibleContractLineIdsForServiceAtDate(trx, tenant, clientId, serviceId, workDate)).length;
}

/** Where an entry's minutes may be drawn from. */
export type BlockBurnTarget =
  | { kind: 'contract'; contractLineId: string }
  | { kind: 'adhoc' };

async function lineHasPrepaidBlockConfig(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<boolean> {
  const row = await tenantDb(trx, tenant)
    .table('contract_line_prepaid_blocks')
    .where({ contract_line_id: contractLineId })
    .first('contract_line_id');
  return Boolean(row);
}

/** A covering-line row as read from {@link coveringContractLinesQuery}. */
export interface ContractLineCoverageRow {
  service_id: string;
  service_name?: string | null;
  contract_id: string;
  contract_name: string;
  client_contract_id: string;
  contract_line_id: string;
  contract_line_name: string;
  start_date: string | Date;
  end_date?: string | Date | null;
}

/**
 * Pure classification of covering-line rows (no I/O). Per service, dedupes
 * lines and decides `assignment`: 'automatic' when no two distinct lines'
 * client_contracts ranges overlap inside `window` (so the burn rule sees
 * exactly one line on every covered date and rejects every entry), otherwise
 * 'when_assigned'. Lines that follow each other in time stay 'automatic'.
 * Output is sorted by service, contract and line name.
 *
 * `excludeContractLineId` hides one line from the returned `lines` only: a
 * block issued BY a Prepaid Block line must not warn that the line's own time
 * "will not draw this block" — that time draws it (the contract burn target).
 * The overlap check still sees the excluded line, because un-assigned time on
 * a service it shares with another line splits between the two, which keeps
 * the service 'when_assigned'. A service with no lines left after the
 * exclusion is dropped from the output.
 */
export function classifyContractLineCoverage(
  rows: ContractLineCoverageRow[],
  window: { from: string; to: string },
  excludeContractLineId?: string | null,
): ServiceContractLineCoverage[] {
  const byService = new Map<string, { name: string; lines: Map<string, ContractLineCoverageLine> }>();
  for (const row of rows) {
    const start = toDateOnly(row.start_date);
    if (!start) continue;
    const end = toDateOnly(row.end_date ?? null);
    let entry = byService.get(row.service_id);
    if (!entry) {
      entry = { name: row.service_name ?? '', lines: new Map() };
      byService.set(row.service_id, entry);
    }
    const key = `${row.client_contract_id}:${row.contract_line_id}`;
    if (!entry.lines.has(key)) {
      entry.lines.set(key, {
        contract_id: row.contract_id,
        contract_name: row.contract_name,
        client_contract_id: row.client_contract_id,
        contract_line_id: row.contract_line_id,
        contract_line_name: row.contract_line_name,
        start_date: start,
        end_date: end,
      });
    }
  }

  const clipStart = (l: ContractLineCoverageLine) => (l.start_date > window.from ? l.start_date : window.from);
  const clipEnd = (l: ContractLineCoverageLine) =>
    l.end_date && l.end_date < window.to ? l.end_date : window.to;

  const result: ServiceContractLineCoverage[] = [];
  for (const [serviceId, entry] of byService) {
    const lines = [...entry.lines.values()].sort(
      (a, b) =>
        a.contract_name.localeCompare(b.contract_name) ||
        a.contract_line_name.localeCompare(b.contract_line_name),
    );
    // Distinct lines (by contract_line_id) whose clipped ranges share a date.
    let overlap = false;
    for (let i = 0; i < lines.length && !overlap; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[i].contract_line_id === lines[j].contract_line_id) continue;
        const s = clipStart(lines[i]) > clipStart(lines[j]) ? clipStart(lines[i]) : clipStart(lines[j]);
        const e = clipEnd(lines[i]) < clipEnd(lines[j]) ? clipEnd(lines[i]) : clipEnd(lines[j]);
        if (s <= e) {
          overlap = true;
          break;
        }
      }
    }
    // The issuing line is never named as a covering line, but it has already
    // been weighed in `overlap` above.
    const displayed = excludeContractLineId
      ? lines.filter((l) => l.contract_line_id !== excludeContractLineId)
      : lines;
    if (displayed.length === 0) continue;
    result.push({
      service_id: serviceId,
      service_name: entry.name,
      assignment: overlap ? 'when_assigned' : 'automatic',
      lines: displayed,
    });
  }
  return result.sort(
    (a, b) => a.service_name.localeCompare(b.service_name) || a.service_id.localeCompare(b.service_id),
  );
}

/** YYYY-MM-DD + n months, clamping the day to the target month's length. */
function addMonthsToDateOnly(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, lastDay))}`;
}

/**
 * Raw covering-line rows for the client from the tenant's today until
 * `expirationDate` (or today + 12 months when there is none), plus the window
 * used. `serviceIds: null` means every service (unscoped). Shares
 * {@link coveringContractLinesQuery} with the burn rule. `today` is injectable
 * for tests. Callers that need several per-block windows (the list view) read
 * once over the widest window and re-classify per block with
 * {@link classifyContractLineCoverage}.
 */
export async function getContractLineCoverageRowsForClient(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  options: {
    serviceIds: string[] | null;
    expirationDate?: string | Date | null;
    /** Also cover the default no-expiry horizon (today + 12 months) when it is later than `expirationDate`. */
    includeDefaultHorizon?: boolean;
    today?: string;
  },
): Promise<{
  rows: ContractLineCoverageRow[];
  window: { from: string; to: string };
  /** today + 12 months: the window end used for blocks with no expiry. */
  defaultTo: string;
}> {
  let from = options.today ? toDateOnly(options.today) : null;
  if (!from) {
    // LEVERAGE: pattern tenant-today — tenant-calendar "today" via resolveEffectiveTimeZone, 3rd copy in this module
    const timeZone = await resolveEffectiveTimeZone(conn, tenant);
    from = toCalendarDateStringInTimeZone(new Date(), timeZone);
  }
  const expiry = toDateOnly(options.expirationDate ?? null);
  const defaultTo = addMonthsToDateOnly(from, 12);
  const to = expiry === null ? defaultTo : options.includeDefaultHorizon && defaultTo > expiry ? defaultTo : expiry;
  const window = { from, to };
  if ((options.serviceIds && options.serviceIds.length === 0) || window.to < window.from) {
    return { rows: [], window, defaultTo };
  }

  const db = tenantDb(conn, tenant);
  const query = coveringContractLinesQuery(db, clientId, { serviceIds: options.serviceIds, ...window });
  db.tenantJoin(query, 'service_catalog as sc', 'sc.service_id', 'cls.service_id', { type: 'left' });
  const rows = await query.distinct(
    'cls.service_id as service_id',
    'sc.service_name as service_name',
    'c.contract_id as contract_id',
    'c.contract_name as contract_name',
    'cc.client_contract_id as client_contract_id',
    'cl.contract_line_id as contract_line_id',
    'cl.contract_line_name as contract_line_name',
    'cc.start_date as start_date',
    'cc.end_date as end_date',
  );
  return { rows: rows as ContractLineCoverageRow[], window, defaultTo };
}

/**
 * Narrows rows read over a wide window to one block: keeps rows for
 * `serviceIds` (null = all) whose client_contracts range overlaps
 * [window.from, window.to] — the same overlap predicate as the shared builder —
 * then classifies them. Lets a list view issue one query for many blocks.
 */
export function classifyContractLineCoverageForWindow(
  rows: ContractLineCoverageRow[],
  options: {
    serviceIds: string[] | null;
    window: { from: string; to: string };
    /** The block's issuing line: never a coverage warning against its own block. */
    excludeContractLineId?: string | null;
  },
): ServiceContractLineCoverage[] {
  const allowed = options.serviceIds ? new Set(options.serviceIds) : null;
  const { from, to } = options.window;
  const narrowed = rows.filter((row) => {
    if (allowed && !allowed.has(row.service_id)) return false;
    const start = toDateOnly(row.start_date);
    const end = toDateOnly(row.end_date ?? null);
    return !!start && start <= to && (end === null || end >= from);
  });
  return classifyContractLineCoverage(narrowed, options.window, options.excludeContractLineId);
}

/**
 * Contract lines (per service) covering `serviceIds` for the client between
 * the tenant's today and the block's expiry, classified by how the burn rule
 * would treat time entries (see {@link classifyContractLineCoverage}).
 */
export async function getContractLineCoverageForClient(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  options: {
    serviceIds: string[] | null;
    expirationDate?: string | Date | null;
    today?: string;
    /** The block's issuing line: never a coverage warning against its own block. */
    excludeContractLineId?: string | null;
  },
): Promise<ServiceContractLineCoverage[]> {
  const { rows, window } = await getContractLineCoverageRowsForClient(conn, tenant, clientId, options);
  return classifyContractLineCoverage(rows, window, options.excludeContractLineId);
}

/**
 * Resolves the burn target for a billable time entry, or null when the entry
 * cannot draw any block: no service, no positive billable duration, no
 * client/date, or it is contract-covered by a line WITHOUT a prepaid-block
 * config (contracts always win over ad-hoc blocks).
 *
 *  - Contract target: the entry's `contract_line_id` (explicit or saved
 *    resolution), or the single deterministic line from
 *    getEligibleContractLineIdsForServiceAtDate, provided that line has a
 *    `contract_line_prepaid_blocks` row.
 *  - Ad-hoc target: no contract line and the service is not deterministically
 *    assigned to exactly one active line (today's rule, unchanged).
 */
export async function resolveBlockBurnTarget(
  trx: Knex.Transaction,
  tenant: string,
  entry: BlockBurnTimeEntry,
  clientId?: string | null,
): Promise<BlockBurnTarget | null> {
  if (!entry.service_id) return null;
  if (Math.floor(Number(entry.billable_duration) || 0) <= 0) return null;

  if (entry.contract_line_id) {
    return (await lineHasPrepaidBlockConfig(trx, tenant, entry.contract_line_id))
      ? { kind: 'contract', contractLineId: entry.contract_line_id }
      : null;
  }

  const resolvedClientId = clientId ?? (await resolveClientIdForWorkItem(trx, tenant, entry.work_item_id, entry.work_item_type));
  if (!resolvedClientId) return null;

  const workDate = toDateOnly(entry.work_date) ?? toDateOnly(entry.start_time);
  if (!workDate) return null;

  const lineIds = await getEligibleContractLineIdsForServiceAtDate(
    trx,
    tenant,
    resolvedClientId,
    entry.service_id,
    workDate,
  );
  if (lineIds.length !== 1) return { kind: 'adhoc' };
  return (await lineHasPrepaidBlockConfig(trx, tenant, lineIds[0]))
    ? { kind: 'contract', contractLineId: lineIds[0] }
    : null;
}

/**
 * True when a billable time entry may draw down any hour block (see
 * {@link resolveBlockBurnTarget}).
 */
export async function isEntryEligibleForBlockBurn(
  trx: Knex.Transaction,
  tenant: string,
  entry: BlockBurnTimeEntry,
  clientId?: string | null,
): Promise<boolean> {
  return (await resolveBlockBurnTarget(trx, tenant, entry, clientId)) !== null;
}

/**
 * Selects the FIFO-ordered blocks eligible to burn for one entry: paid contract
 * blocks (including those subsequently expired), or a pending contract block,
 * with
 * remaining minutes, inside the block's validity window at the entry's date
 * (`valid_from <= date <= expiration_date`, either bound may be null), and whose scope covers
 * the entry's service. Scope semantics: a block with zero scope rows covers all
 * labor; a block with scope rows covers exactly those services. Implemented
 * with NOT EXISTS/EXISTS so a block scoped to [A,B] is NOT eligible for an
 * entry on service C (a naive LEFT JOIN ON scopes.service_id = C would have
 * treated the no-match row as "unscoped").
 *
 * Locking discipline (29.8.18 Blocker 2): the rows are locked with
 * SELECT ... FOR UPDATE in canonical block_id order — the same order every
 * other hour_blocks check-then-act site (expire handlers, finalize
 * activation, unfinalize, adjust, expiration-edit, void, draft-deletion
 * void; 29.8.18 mitigation round 3 closed the activation/adjust/
 * expiration-edit gaps, round 4 the draft-deletion one) locks in — so
 * concurrent mutators of a block's burn-state serialize instead
 * of racing. A block can no longer be expired/unfinalized between this read
 * and the allocation writes, because those writers wait on this lock, and this
 * query re-evaluates the row's committed state when the wait ends. FIFO order
 * (expiration, purchase, creation) is applied AFTER locking, in JS, so the
 * math still sees the burn order while the locks stay canonically ordered
 * (deadlock-free against the other lock sites).
 */
async function selectEligibleBlocks(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  entry: BlockBurnTimeEntry,
  target: BlockBurnTarget,
): Promise<EligibleBlock[]> {
  const db = tenantDb(trx, tenant);
  const workDate = toDateOnly(entry.work_date) ?? toDateOnly(entry.start_time);
  if (!workDate) return [];
  const timeZone = await resolveEffectiveTimeZone(trx, tenant);

  // Lock the client's blocks on this line before reading invoice and termination state.
  // If an expiry or reversal owns a block lock, the following eligibility
  // statement then starts after it commits and sees its audit and invoice
  // changes as well as the new block status.
  if (target.kind === 'contract') {
    await db.table('hour_blocks').where({ client_id: clientId, contract_line_id: target.contractLineId })
      .select('block_id').orderBy('block_id', 'asc').forUpdate();
  }

  const rows: any[] = await db.table('hour_blocks as hb')
    .where({ 'hb.client_id': clientId })
    .where(function (this: Knex.QueryBuilder) {
      if (target.kind === 'contract') {
        // The work date, not the date the entry is approved, determines whether
        // a paid contract block can cover it. Pending blocks still hold gap draws.
        this.where('hb.contract_line_id', target.contractLineId).whereIn('hb.status', ['active', 'expired', 'pending']);
      } else {
        this.whereNull('hb.contract_line_id').where('hb.status', 'active');
      }
    })
    // Older reversals could leave an expired block behind. Such a block is
    // not paid capacity even before its lifecycle state is repaired. Pending
    // blocks retain their existing gap-draw hold behavior.
    .where(function (this: Knex.QueryBuilder) {
      this.where('hb.status', 'pending').orWhereNull('hb.source_invoice_id').orWhereExists(function (this: Knex.QueryBuilder) {
        this.select(trx.raw('1')).from('invoices as source_invoice')
          .where('source_invoice.tenant', tenant).whereRaw('source_invoice.tenant = hb.tenant')
          .whereRaw('source_invoice.invoice_id = hb.source_invoice_id')
          .whereNotIn('source_invoice.status', ['draft', 'cancelled']);
      });
    })
    .where('hb.remaining_minutes', '>', 0)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.expiration_date').orWhere('hb.expiration_date', '>=', workDate);
    })
    // Burn window lower bound (D5/R8): a cadence block never draws time worked
    // before its service period starts. NULL valid_from = no bound (existing blocks).
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.valid_from').orWhere('hb.valid_from', '<=', workDate);
    })
    // Renewing assignments keep purchased blocks through each block's own
    // expiry, even without a renewal draft. A termination audit still caps
    // that extension below, including historical work logged after termination.
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.client_contract_id').orWhereExists(function (this: Knex.QueryBuilder) {
        this.select(trx.raw('1')).from('client_contracts as cc')
          .where('cc.tenant', tenant).whereRaw('cc.tenant = hb.tenant')
          .whereRaw('cc.client_contract_id = hb.client_contract_id')
          .where(function (this: Knex.QueryBuilder) { this.whereNull('cc.start_date').orWhere('cc.start_date', '<=', workDate); })
          .where(function (this: Knex.QueryBuilder) {
            this.whereNull('cc.end_date').orWhere('cc.end_date', '>=', workDate)
              .orWhere(function (this: Knex.QueryBuilder) {
                this.where('cc.status', 'renewing')
                  .whereExists(function (this: Knex.QueryBuilder) {
                    this.select(trx.raw('1')).from('contracts as renewing_contract')
                      .where('renewing_contract.tenant', tenant).whereRaw('renewing_contract.tenant = cc.tenant')
                      .whereRaw('renewing_contract.contract_id = cc.contract_id')
                      .where('renewing_contract.status', '!=', 'draft')
                      .where(function (this: Knex.QueryBuilder) {
                        this.where(function (this: Knex.QueryBuilder) {
                          this.where('cc.is_active', true).where('renewing_contract.status', '!=', 'terminated');
                        }).orWhereExists(function (this: Knex.QueryBuilder) {
                          // Once terminated, retain the renewal interval for
                          // work before the recorded effective end date.
                          this.select(trx.raw('1')).from('hour_block_audit as renewal_end')
                            .where('renewal_end.tenant', tenant).whereRaw('renewal_end.tenant = hb.tenant')
                            .whereRaw('renewal_end.block_id = hb.block_id')
                            .where('renewal_end.type', 'contract_end_expiration');
                        });
                      });
                  });
              });
          });
      });
    })
    .whereNotExists(function (this: Knex.QueryBuilder) {
      this.select(trx.raw('1')).from('hour_block_audit as end_audit')
        .where('end_audit.tenant', tenant).whereRaw('end_audit.tenant = hb.tenant')
        .whereRaw('end_audit.block_id = hb.block_id').where('end_audit.type', 'contract_end_expiration')
        .whereRaw(`?::date > COALESCE(NULLIF(end_audit.metadata->>'effective_end_date', '')::date,
          CASE WHEN end_audit.metadata->>'assignment_status' = 'expired'
            THEN NULLIF(end_audit.metadata->>'assignment_end_date', '')::date END,
          (end_audit.created_at AT TIME ZONE ?)::date)`, [workDate, timeZone]);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNotExists(function (this: Knex.QueryBuilder) {
        this.select('*')
          .from('hour_block_service_scopes as s')
          // Keep every distributed relation independently pinned to the
          // tenant's shard. Citus does not infer single-shard routing for the
          // full NOT EXISTS/EXISTS OR expression from the correlation alone,
          // and consequently rejects the outer FOR UPDATE.
          .where('s.tenant', tenant)
          .whereRaw('s.tenant = hb.tenant')
          .whereRaw('s.block_id = hb.block_id');
      });
      this.orWhereExists(function (this: Knex.QueryBuilder) {
        this.select('*')
          .from('hour_block_service_scopes as s2')
          .where('s2.tenant', tenant)
          .whereRaw('s2.tenant = hb.tenant')
          .whereRaw('s2.block_id = hb.block_id')
          .where('s2.service_id', entry.service_id ?? '');
      });
    })
    .select('hb.block_id', 'hb.status', 'hb.remaining_minutes', 'hb.expiration_date', 'hb.purchased_at', 'hb.created_at')
    .orderBy('hb.block_id', 'asc')
    .forUpdate();

  const locked = rows.map((row) => ({
    block_id: row.block_id,
    status: row.status as string,
    remaining_minutes: Number(row.remaining_minutes),
    expiration_date: row.expiration_date ? toDateOnly(row.expiration_date) : null,
    purchased_at: row.purchased_at ? new Date(row.purchased_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));

  // FIFO burn order on the already-locked rows: expiration first (soonest
  // first, never-expiring last), then purchase, then creation.
  locked.sort((a, b) => {
    // Paid blocks retain FIFO order across status changes; pending comes last.
    if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? 1 : -1;
    if (a.expiration_date === null && b.expiration_date !== null) return 1;
    if (a.expiration_date !== null && b.expiration_date === null) return -1;
    if (a.expiration_date !== null && b.expiration_date !== null && a.expiration_date !== b.expiration_date) {
      return a.expiration_date < b.expiration_date ? -1 : 1;
    }
    const aPurchased = a.purchased_at ?? '';
    const bPurchased = b.purchased_at ?? '';
    if (aPurchased !== bPurchased) return aPurchased < bPurchased ? -1 : 1;
    const aCreated = a.created_at ?? '';
    const bCreated = b.created_at ?? '';
    if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
    return a.block_id < b.block_id ? -1 : 1;
  });

  return locked;
}

/**
 * Burns an entry's billable minutes across its eligible blocks FIFO. Writes
 * hour_block_time_allocations rows and decrements remaining_minutes in the
 * same transaction. The uncovered remainder is left unallocated (normal
 * billable time). Returns the allocation rows written.
 *
 * Participates in the hour_blocks row-lock discipline: the eligible-block
 * select takes FOR UPDATE (canonical block_id order) before any write, so a
 * concurrent expiration/unfinalization/void either waits (and this burn
 * lands first, while the block is still active) or has already committed
 * (and the locked re-read excludes the block). See selectEligibleBlocks.
 */
export async function allocateTimeEntry(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  entry: BlockBurnTimeEntry,
): Promise<FifoAllocation[]> {
  return (await allocateTimeEntryDetailed(trx, tenant, clientId, entry)).allocations;
}

/**
 * As {@link allocateTimeEntry}, but also reports the burn target so callers
 * (the time-entry save hook) can tell a contract draw from an ad-hoc one.
 */
export async function allocateTimeEntryDetailed(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  entry: BlockBurnTimeEntry,
): Promise<{ target: BlockBurnTarget | null; allocations: FifoAllocation[] }> {
  const target = await resolveBlockBurnTarget(trx, tenant, entry, clientId);
  if (!target) return { target: null, allocations: [] };

  const neededMinutes = Math.floor(Number(entry.billable_duration) || 0);
  if (neededMinutes <= 0) return { target, allocations: [] };

  const blocks = await selectEligibleBlocks(trx, tenant, clientId, entry, target);
  const allocations = computeFifoAllocation(neededMinutes, blocks);
  if (allocations.length === 0) return { target, allocations };

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
        // Immutable "ever used" marker: set once at the first burn and never
        // cleared (reversal/reconcile leave it alone), so the void guard can
        // reject a block whose allocation rows have since been deleted.
        // Bound as a parameter: Citus rejects now() inside COALESCE in UPDATEs on distributed tables.
        first_allocated_at: trx.raw('COALESCE(first_allocated_at, ?::timestamptz)', [now]),
        updated_at: now,
      });
  }

  return { target, allocations };
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
  const allocatedBlocks = await db.table('hour_block_time_allocations')
    .where({ tenant, time_entry_id: timeEntryId })
    .select('block_id');

  if (allocatedBlocks.length === 0) return;

  // A reversal is the first half of a redraw. Lock the whole affected lines,
  // not just the allocated blocks: a subsequent burn locks every line block,
  // including earlier voided/pending blocks. Taking that earlier lock only
  // after restoring a later block deadlocks against a line reconciliation.
  // The subquery expands all affected lines in one canonically ordered lock
  // statement; ad-hoc allocations retain their individual block locks.
  const blockIds = allocatedBlocks.map((allocation) => allocation.block_id);
  await db.table('hour_blocks')
    .where({ tenant })
    .where(function (this: Knex.QueryBuilder) {
      this.whereIn('block_id', blockIds).orWhereIn(
        'contract_line_id',
        db.table('hour_blocks as allocated_block')
          .whereIn('allocated_block.block_id', blockIds)
          .whereNotNull('allocated_block.contract_line_id')
          .select('allocated_block.contract_line_id'),
      );
    })
    .select('block_id')
    .orderBy('block_id', 'asc')
    .forUpdate();

  // A concurrent redraw may have changed the allocations while we waited.
  // Restore only the balances represented by the now-committed rows.
  const allocations = await db.table('hour_block_time_allocations')
    .where({ tenant, time_entry_id: timeEntryId })
    .select('block_id', 'minutes');

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
    // Entries not on a contract line, plus entries on a Prepaid Block line
    // (their blocks are drawn through the contract burn target).
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('te.contract_line_id').orWhereExists(function (this: Knex.QueryBuilder) {
        this.select('*')
          .from('contract_line_prepaid_blocks as clpb')
          .where('clpb.tenant', tenant)
          .whereRaw('clpb.tenant = te.tenant')
          .whereRaw('clpb.contract_line_id = te.contract_line_id');
      });
    })
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

  // Lock every block of the client up front in canonical block_id order so the
  // per-entry selects below (which lock subsets) can never acquire out of
  // order against another writer. Issuance/config locks are taken by callers
  // before this point.
  await lockBlocks(trx, tenant, { clientId });

  // Oldest work first, so a gap-draw on a pending block is deterministic.
  const candidateIds = sortEntryIdsByWorkDate(
    new Set<string>([...withAllocations, ...entryById.keys()]),
    entryById,
  );

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
 * Locks hour_blocks rows FOR UPDATE in canonical block_id order (the order
 * every other hour_blocks check-then-act site uses). Returns the locked rows.
 */
async function lockBlocks(
  trx: Knex.Transaction,
  tenant: string,
  scope: { clientId: string } | { contractLineId: string },
): Promise<Array<{ block_id: string; status: string }>> {
  const query = tenantDb(trx, tenant).table('hour_blocks as hb');
  if ('contractLineId' in scope) {
    query.where('hb.contract_line_id', scope.contractLineId);
  } else {
    query.where('hb.client_id', scope.clientId);
  }
  return await query.select('hb.block_id', 'hb.status').orderBy('hb.block_id', 'asc').forUpdate();
}

function sortEntryIdsByWorkDate(
  ids: Set<string>,
  entries: Map<string, BlockBurnTimeEntry>,
): string[] {
  const key = (id: string): string => {
    const entry = entries.get(id);
    const date = entry ? (toDateOnly(entry.work_date) ?? toDateOnly(entry.start_time) ?? '') : '';
    const start = entry?.start_time ? new Date(entry.start_time as string | Date).getTime() : 0;
    return `${date}|${String(Number.isFinite(start) ? start : 0).padStart(16, '0')}|${id}`;
  };
  return [...ids].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/**
 * Re-draw for one Prepaid Block line: reverses and re-allocates the line's
 * uninvoiced time entries (approved or not) against the line's blocks, oldest
 * work first. Call after a pending block is created (overflow already logged
 * lands on it), after a pending block is voided/deleted (released minutes
 * fall back to overage), and after a contract block expires.
 *
 * Idempotent: the result depends only on current entry state and block state.
 * Locks ALL of the line's blocks in canonical block_id order up front (callers
 * take issuance/config locks first). Invoiced entries are never touched.
 * Uninvoiced entries are rechecked against current work-date eligibility,
 * including historical blocks and any assignment-end boundary.
 */
export async function reconcileLineAllocations(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<number> {
  const db = tenantDb(trx, tenant);

  const lockedBlocks = await lockBlocks(trx, tenant, { contractLineId });
  if (lockedBlocks.length === 0) {
    // No block ever issued for the line: nothing could be drawn or released.
    return 0;
  }
  const entries: Array<BlockBurnTimeEntry & { entry_id: string }> = await db.table('time_entries as te')
    .where({ 'te.contract_line_id': contractLineId, 'te.invoiced': false })
    .whereNotNull('te.service_id')
    .where('te.billable_duration', '>', 0)
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

  // Entries with no stored contract_line_id whose burn target resolves to this
  // line (the single deterministic line path in resolveBlockBurnTarget) belong
  // to the line too: they were drawn from its blocks at save time, so a re-draw
  // that ignored them would strip their coverage until the nightly reconcile.
  {
    const lineServiceIds: string[] = (await db.table('contract_line_services')
      .where({ contract_line_id: contractLineId })
      .distinct('service_id')).map((r: any) => r.service_id);
    if (lineServiceIds.length > 0) {
      const unassigned: Array<BlockBurnTimeEntry & { entry_id: string }> = await db.table('time_entries as te')
        .whereNull('te.contract_line_id')
        .where('te.invoiced', false)
        .whereIn('te.service_id', lineServiceIds)
        .where('te.billable_duration', '>', 0)
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
      for (const candidate of unassigned) {
        const candidateClientId = await resolveClientIdForWorkItem(trx, tenant, candidate.work_item_id, candidate.work_item_type);
        if (!candidateClientId) continue;
        const candidateTarget = await resolveBlockBurnTarget(trx, tenant, candidate, candidateClientId);
        if (candidateTarget?.kind === 'contract' && candidateTarget.contractLineId === contractLineId) {
          entries.push(candidate);
        }
      }
    }
  }

  // Entries that carry an allocation against this line's blocks but no longer
  // qualify (e.g. duration zeroed) still need their draw reversed.
  const allocated: string[] = await db.table('hour_block_time_allocations as hba')
    .whereIn('hba.block_id', lockedBlocks.map((b) => b.block_id))
    .distinct('hba.time_entry_id')
    .then((rows: any[]) => rows.map((r) => r.time_entry_id));

  const entryById = new Map(entries.map((e) => [e.entry_id, e] as const));
  const staleIds = allocated.filter((id) => !entryById.has(id));
  if (staleIds.length > 0) {
    const stale = await db.table('time_entries')
      .whereIn('entry_id', staleIds)
      .where('invoiced', false)
      .select('entry_id', 'service_id', 'billable_duration', 'contract_line_id', 'work_item_id', 'work_item_type', 'work_date', 'start_time');
    for (const row of stale) entryById.set(row.entry_id, row);
  }

  let redrawn = 0;
  for (const entryId of sortEntryIdsByWorkDate(new Set(entryById.keys()), entryById)) {
    const entry = entryById.get(entryId)!;
    await reverseTimeEntryAllocations(trx, tenant, entryId);

    const clientId = await resolveClientIdForWorkItem(trx, tenant, entry.work_item_id, entry.work_item_type);
    if (!clientId) continue;
    // Re-allocate only when the entry's burn target is this line (explicit
    // contract_line_id or the single deterministic line for null-line entries).
    const target = await resolveBlockBurnTarget(trx, tenant, entry, clientId);
    if (target?.kind !== 'contract' || target.contractLineId !== contractLineId) continue;
    const { allocations } = await allocateTimeEntryDetailed(trx, tenant, clientId, entry);
    if (allocations.length > 0) redrawn += 1;
  }
  return redrawn;
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
  options: {
    /** Only blocks issued for this Prepaid Block line. */
    contractLineId?: string;
    /** Only ad-hoc blocks (contract_line_id IS NULL). Use for the ad-hoc balance. */
    adhocOnly?: boolean;
  } = {},
): Promise<number> {
  const db = tenantDb(conn, tenant);
  // "Today" for expiration eligibility is the TENANT's calendar date: expiration
  // dates are stored as tenant-local calendar dates, and a block expiring
  // 2026-08-31 in Berlin is expired the moment Berlin enters 2026-09-01 — even
  // while a UTC worker still reads 2026-08-31. resolveEffectiveTimeZone reads
  // the tenant's settings timezone and falls back to UTC when none is configured
  // (no "user-local" ground truth exists, and UTC is deterministic across
  // workers). Host-local/UTC-today counted such blocks as available for up to
  // 24h, and drifted the other way east of UTC.
  // LEVERAGE: pattern tenant-today — tenant-calendar "today" via resolveEffectiveTimeZone (see getContractLineCoverageForClient)
  const timeZone = await resolveEffectiveTimeZone(conn, tenant);
  const today = toCalendarDateStringInTimeZone(new Date(), timeZone);

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

  if (options.contractLineId) {
    query.where('hb.contract_line_id', options.contractLineId);
  } else if (options.adhocOnly) {
    query.whereNull('hb.contract_line_id');
  }

  const row = await query
    .where({ 'hb.client_id': clientId, 'hb.status': 'active' })
    .where('hb.remaining_minutes', '>', 0)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.expiration_date').orWhere('hb.expiration_date', '>=', today);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.valid_from').orWhere('hb.valid_from', '<=', today);
    })
    .sum({ total: 'hb.remaining_minutes' })
    .first<{ total: string | number }>();
  return Number(row?.total ?? 0);
}

/**
 * Apply the same active/expiration/scope eligibility as the burn engine while
 * assigning each block to at most one bucket subject. A client can have two
 * bucket_usage rows for the same service (for example, overlapping retainer
 * lines); returning the full client total for both observations would double
 * count one balance and make both detectors appear recovered.
 */
export async function getAvailableHourBlockMinutesForSubjects(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  subjects: Array<{ key: string; serviceId: string }>,
): Promise<Map<string, number>> {
  const result = new Map(subjects.map((subject) => [subject.key, 0]));
  if (subjects.length === 0) return result;

  const db = tenantDb(conn, tenant);
  // LEVERAGE: pattern tenant-today — tenant-calendar "today" via resolveEffectiveTimeZone (see getContractLineCoverageForClient)
  const timeZone = await resolveEffectiveTimeZone(conn, tenant);
  const today = toCalendarDateStringInTimeZone(new Date(), timeZone);
  // Contract-issued blocks belong to their Prepaid Block line, never to a
  // bucket subject.
  const blocks = await db.table('hour_blocks as hb')
    .where({ 'hb.client_id': clientId, 'hb.status': 'active' })
    .whereNull('hb.contract_line_id')
    .where('hb.remaining_minutes', '>', 0)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.expiration_date').orWhere('hb.expiration_date', '>=', today);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('hb.valid_from').orWhere('hb.valid_from', '<=', today);
    })
    .select('hb.block_id', 'hb.remaining_minutes', 'hb.replenishment_bucket_usage_id')
    .orderBy('hb.block_id', 'asc');
  if (blocks.length === 0) return result;

  const scopes = await db.table('hour_block_service_scopes')
    .where({ tenant })
    .whereIn('block_id', blocks.map((block) => block.block_id))
    .select('block_id', 'service_id');
  const scopeMap = new Map<string, string[]>();
  for (const scope of scopes) {
    const values = scopeMap.get(scope.block_id) ?? [];
    values.push(scope.service_id);
    scopeMap.set(scope.block_id, values);
  }

  const orderedSubjects = [...subjects].sort((a, b) => a.key.localeCompare(b.key));
  for (const block of blocks) {
    const scopedServices = scopeMap.get(block.block_id) ?? [];
    const attributedOwner = block.replenishment_bucket_usage_id
      ? orderedSubjects.find((subject) => subject.key === block.replenishment_bucket_usage_id)
      : undefined;
    const owner = attributedOwner ?? orderedSubjects.find((subject) =>
      scopedServices.length === 0 || scopedServices.includes(subject.serviceId),
    );
    if (!owner) continue;
    if (scopedServices.length > 0 && !scopedServices.includes(owner.serviceId)) continue;
    result.set(owner.key, (result.get(owner.key) ?? 0) + Number(block.remaining_minutes));
  }
  return result;
}
