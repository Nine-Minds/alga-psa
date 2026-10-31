import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { serves } from '@alga-psa/core/capability';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import { registerTimeSource } from '@alga-psa/scheduling/lib/timeSource';
import type { TimeSource, TimeSourceContext, TimeSourceValue } from '@alga-psa/scheduling/lib/timeSource';
import { timeSheetActionErrorFrom } from '@alga-psa/scheduling/actions/timeSheetActionErrors';
import { startSession, StopwatchConflictError } from '@alga-psa/scheduling/lib/stopwatch/stopwatchCore';
import { publishPersistedTimeEntryEvents } from '@alga-psa/scheduling/lib/timeEntryWriteCore';
import {
  CoManagedSharedWorkError, isCoManagedUuid, loadCoManagedLocalWorkReference, lockTimeEntryBillingMode, readTimeEntryBillingMode,
  resolveCoManagedTimeWorkItem, retainCoManagedTimeParticipation, withCoManagedCustomerProject, withCoManagedCustomerTicket,
} from '@alga-psa/co-managed';
import { coManagedBrowserActor } from './browserActor';
import { writeCoManagedTimeEntry, type CoManagedTimeEntryInput } from './timeEntryWrite';

/**
 * The co-managed time source (L6a2). It answers only for time it owns and misses everything else, so native
 * time (and every tenant that does not participate) keeps today's body untouched.
 *
 * Ownership is decided from markers the caller already holds, never from a tenant-wide probe:
 *   - `work_item_type === 'co_managed'` (MSP billable time on shared work), or
 *   - a customer-local ticket/task saved WITHOUT a service by a participating tenant (operational time), or
 *   - an existing row whose own `billing_mode`/`work_item_type` says so (delete, mode reads).
 * A hit owns authorization (see the TimeSource contract), so each hit checks `time_entry` RBAC itself.
 */
export const COMMANDS_MISS = { handled: false } as const;
const miss = async (): Promise<{ handled: false }> => ({ handled: false });
const missSync = (): { handled: false } => ({ handled: false });

// LEVERAGE: pattern time-source-miss-surface — every provider enumerates the full interface just to miss; a registry-level default-miss would remove this.
const missing = <K extends string>(...names: K[]) => Object.fromEntries(names.map(name => [name, miss])) as Record<K, typeof miss>;

const participates = async (tenant: string) => (await serves('co-managed', tenant)).served;
const COMMERCIAL_WORK = 'co_managed';

async function allowed(user: any, action: 'create' | 'update' | 'delete' | 'read', db: Knex) {
  return hasPermission(user, 'time_entry', action, db);
}

/** The user the provider acts for. The ctx carries only ids, so the caller's user row is re-read once per hit. */
async function loadUser(db: Knex, tenant: string, userId?: string): Promise<any | null> {
  if (!userId) return null;
  return (await tenantDb(db, tenant).table('users').where({ user_id: userId }).first()) ?? null;
}

type SaveInput = CoManagedTimeEntryInput & { stopwatch_session_id?: string | null };

/** Customer-side operational admission: the customer's own native work, authorized by customer-local authority. */
async function admitOperational(db: Knex, user: any, tenant: string, entry: SaveInput): Promise<{ name: string | null } | null> {
  if (!['ticket', 'project_task'].includes(entry.work_item_type) || entry.service_id?.trim()) return null;
  let actor;
  try { actor = await coManagedBrowserActor(user, tenant); } catch { return null; }
  const kind = entry.work_item_type as 'ticket' | 'project_task';
  const boundary = kind === 'ticket' ? withCoManagedCustomerTicket : withCoManagedCustomerProject;
  // The customer boundary is keyed by the tenant's own relationship row. A workspace with no live relationship has no
  // co-managed time to own: native decides. Authority below stays the customer's local RBAC on its own ticket/task.
  const relationship = await tenantDb(db, tenant).table('co_management_relationships').where({ state: 'active' }).whereNull('ended_at').first('relationship_id');
  if (!relationship) return null;
  try {
    return await boundary(db, actor, { kind, id: entry.work_item_id, tenant, relationshipId: relationship.relationship_id } as any, 'update', async context => ({ name: null as string | null, redacted: context.redactedFields }));
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return null; // not shared customer work: native decides (and asks for a service)
    throw error;
  }
}

async function admitSave(ctx: TimeSourceContext, entry: SaveInput): Promise<TimeSourceValue<any>> {
  const { tenant } = ctx;
  const commercial = entry.work_item_type === COMMERCIAL_WORK;
  if (!(await participates(tenant))) return COMMANDS_MISS; // kill switch / non-participating: native, byte for byte
  const { knex: db } = await createTenantKnex();
  const user = await loadUser(db, tenant, ctx.userId);
  if (!user) return COMMANDS_MISS;
  const operational = commercial ? null : await admitOperational(db, user, tenant, entry);
  if (!commercial && !operational) return COMMANDS_MISS;
  if (!await allowed(user, entry.entry_id ? 'update' : 'create', db)) return { handled: true, value: permissionError(`Permission denied: Cannot ${entry.entry_id ? 'update' : 'create'} time entries`) };

  try {
    const persisted = await withTransaction(db, async (trx: Knex.Transaction) => {
      const mode = commercial ? 'commercial' as const : 'operational' as const;
      let reference; let evidence;
      if (commercial) {
        reference = await loadCoManagedLocalWorkReference(trx, tenant, entry.work_item_id);
        if (!reference) throw new CoManagedSharedWorkError();
        const resolved = await resolveCoManagedTimeWorkItem(trx as any, await coManagedBrowserActor(user, tenant), { kind: reference.sourceKind, id: reference.sourceId, tenant: reference.customerTenant, relationshipId: reference.relationshipId } as any);
        if (resolved.workItemId !== reference.localReferenceId) throw new CoManagedSharedWorkError();
        evidence = { title: resolved.workItemName, ticketNumber: resolved.workItemTicketNumber ?? null };
      } else if (entry.entry_id) await lockTimeEntryBillingMode(trx, tenant, entry.entry_id);
      const result = await writeCoManagedTimeEntry(trx, { tenant, actor: user, entry, mode, reference, evidence, participates: true });
      if (entry.stopwatch_session_id) await closeSessionWithEntry(trx, tenant, String(user.user_id), entry.stopwatch_session_id, String(result.entry.entry_id), entry.work_item_id);
      if (commercial) await retainCoManagedTimeParticipation(trx, tenant, String(result.entry.entry_id));
      return result;
    });
    await publishPersistedTimeEntryEvents(persisted);
    return { handled: true, value: { ...persisted.entry, work_item_name: null } as any };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { handled: true, value: permissionError('Permission denied: This shared work is not available for time entry') };
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return { handled: true, value: expected };
    throw error;
  }
}

/** Closes the user's own open stopwatch session onto the entry just written, in the same transaction. */
async function closeSessionWithEntry(trx: Knex.Transaction, tenant: string, userId: string, sessionId: string, entryId: string, workItemId: string) {
  const db = tenantDb(trx, tenant);
  const session = await db.table('time_tracking_sessions').where({ session_id: sessionId, user_id: userId }).forUpdate().first('status', 'work_item_type', 'work_item_id');
  if (!session || !['running', 'paused'].includes(session.status)) throw new Error('Validation failed: the stopwatch session is no longer open');
  // A native clock never logs shared time (and a shared clock never logs other work): the session must be this work's own.
  if (session.work_item_type !== COMMERCIAL_WORK || session.work_item_id !== workItemId) throw new Error('Validation failed: the stopwatch session is for different work');
  const now = new Date();
  await db.table('time_tracking_session_segments').where({ session_id: sessionId }).whereNull('ended_at').update({ ended_at: now });
  await db.table('time_tracking_sessions').where({ session_id: sessionId }).update({ status: 'logged', time_entry_id: entryId, closed_at: now, updated_at: now });
}

/** The name and ticket number retained on the MSP's own provenance rows (never a live read of the customer's ticket). */
async function describeCoManagedWork(db: Knex, tenant: string, localReferenceId: string) {
  if (!isCoManagedUuid(localReferenceId)) return null;
  const home = tenantDb(db, tenant);
  const reference = await loadCoManagedLocalWorkReference(db, tenant, localReferenceId);
  if (!reference) return null;
  const evidence = await home.table('co_managed_time_work_references').where('local_reference_id', localReferenceId)
    .orderBy('captured_at', 'desc').first('ticket_number', 'title');
  return { work_item_id: localReferenceId, name: evidence?.title ?? evidence?.ticket_number ?? 'Shared work', description: '', type: COMMERCIAL_WORK,
    ticket_number: evidence?.ticket_number ?? undefined, client_id: reference.clientId, is_billable: true };
}

export function createCoManagedTimeSource(): TimeSource {
  return {
    kind: 'co-managed',
    sheets: missing('read', 'list', 'listAll', 'listForApproval', 'listEntries', 'open', 'submit', 'approve', 'bulkApprove', 'requestChanges',
      'reverseApproval', 'remove', 'comment', 'comments', 'listWorkItems', 'addWorkItem', 'removeWorkItem') as any,
    periods: missing('read', 'readLatest', 'readCurrent', 'readForUser', 'readSettings', 'create', 'update', 'remove', 'removeMany', 'generate',
      'readActiveSettings', 'updateSettings', 'createSettings', 'removeSettings', 'materialize', 'ensureCovers') as any,
    entries: {
      ...missing('read', 'list', 'listChangeRequests', 'review', 'remove'),
      admit: (ctx: TimeSourceContext, entry: any) => admitSave(ctx, entry),
      persist: async (trx, ctx, input) => {
        // Reached from the stopwatch log path and the REST API. Only co_managed work is ours here; operational
        // customer time is admitted in `admit`, where the customer-local authority is checked.
        if (String(input.entry.work_item_type) !== COMMERCIAL_WORK || !(await participates(ctx.tenant))) return COMMANDS_MISS;
        const reference = await loadCoManagedLocalWorkReference(trx, ctx.tenant, String(input.entry.work_item_id));
        if (!reference) throw new CoManagedSharedWorkError();
        const value = await writeCoManagedTimeEntry(trx, { tenant: ctx.tenant, actor: input.actor, entry: input.entry as any, mode: 'commercial', reference, participates: true });
        await retainCoManagedTimeParticipation(trx, ctx.tenant, String(value.entry.entry_id));
        return { handled: true, value };
      },
      removeCore: async (trx, ctx, tenant, entryId, options) => {
        if (!isCoManagedUuid(entryId) || !(await participates(tenant))) return COMMANDS_MISS;
        const db = tenantDb(trx, tenant) as any;
        const row = await db.table('time_entries').where({ entry_id: entryId }).first();
        if (!row || (row.work_item_type !== COMMERCIAL_WORK && row.billing_mode !== 'operational')) return COMMANDS_MISS;
        if (options?.guard) await options.guard(row);
        if (row.invoiced) throw new Error('This time entry has already been invoiced and cannot be modified.');
        // Neither mode ever drew a bucket or an hour block (no client resolves for co_managed, no service for operational),
        // so there is nothing to reverse. The provenance row restricts the entry, so it goes first.
        // write-admission: exempt — provenance row of the entry being removed, deleted inside the admitted removeCore transaction
        await db.table('co_managed_time_work_references').where({ entry_id: entryId }).delete();
        const deleteCount = await db.table('time_entries').where({ entry_id: entryId }).delete();
        return { handled: true, value: { timeEntry: row, deleteCount } };
      },
      billingMode: async (ctx, entryId) => {
        if (!isCoManagedUuid(entryId) || !(await participates(ctx.tenant))) return COMMANDS_MISS;
        const { knex } = await createTenantKnex();
        return { handled: true, value: await readTimeEntryBillingMode(knex, ctx.tenant, entryId) };
      },
      lockBillingMode: async (trx, ctx, entryId) => {
        if (!isCoManagedUuid(entryId) || !(await participates(ctx.tenant))) return COMMANDS_MISS;
        return { handled: true, value: await lockTimeEntryBillingMode(trx, ctx.tenant, entryId) };
      },
    },
    timer: {
      ...missing('active', 'pause', 'resume', 'cancel', 'updateDraft'),
      start: async (ctx, input: any) => {
        if (input.work_item_type !== COMMERCIAL_WORK || !(await participates(ctx.tenant))) return COMMANDS_MISS;
        const { knex: db } = await createTenantKnex();
        const user = await loadUser(db, ctx.tenant, ctx.userId);
        if (!user || !await allowed(user, 'create', db)) return { handled: true, value: permissionError('Permission denied: Cannot create time entries') };
        const reference = await loadCoManagedLocalWorkReference(db, ctx.tenant, input.work_item_id);
        if (!reference) return { handled: true, value: permissionError('Permission denied: This shared work is not available for time entry') };
        try {
          // A running clock is a promise to log shared time, so starting needs the same current authority as logging it:
          // a revoked grant, ended relationship or lost staff assignment refuses the start (an open clock can still be paused/discarded).
          const resolved = await resolveCoManagedTimeWorkItem(db as any, await coManagedBrowserActor(user, ctx.tenant),
            { kind: reference.sourceKind, id: reference.sourceId, tenant: reference.customerTenant, relationshipId: reference.relationshipId } as any);
          if (resolved.workItemId !== reference.localReferenceId) throw new CoManagedSharedWorkError();
          // Extends main's single stopwatch table; the type has no CHECK there, hence the legacy-type allowance.
          const session = await withTransaction(db, (trx: Knex.Transaction) => startSession(trx, ctx.tenant, user.user_id,
            { workItemType: COMMERCIAL_WORK, workItemId: reference.localReferenceId, serviceId: input.service_id ?? null, notes: input.notes }, { allowLegacyWorkItemTypes: true }));
          return { handled: true, value: { session } as any };
        } catch (error) {
          if (error instanceof CoManagedSharedWorkError) return { handled: true, value: permissionError('Permission denied: This shared work is not available for time entry') };
          if (error instanceof StopwatchConflictError) return { handled: true, value: { conflict: error.openSession } as any };
          const expected = timeSheetActionErrorFrom(error);
          if (expected) return { handled: true, value: expected };
          throw error;
        }
      },
    } as any,
    work: {
      // Pure and unowned: the shared ticket id is a foreign tenant's, so the picker (`resolveTimeWorkItemAction`) resolves it.
      // Display of an already-booked item is `describeItem` (it reads the MSP's own retained evidence).
      resolveItem: missSync,
      describeItem: async (ctx, db, workItemType, workItemId) => {
        if (workItemType !== COMMERCIAL_WORK || !(await participates(ctx.tenant))) return COMMANDS_MISS;
        // The caller (time sheet / entry read) has already enforced its own time_entry RBAC on the MSP's own rows.
        const described = await describeCoManagedWork(db, ctx.tenant, workItemId);
        return described ? { handled: true, value: described } : COMMANDS_MISS;
      },
      listSheetItems: async (ctx, db, timeSheetId) => {
        if (!(await participates(ctx.tenant))) return COMMANDS_MISS;
        const rows = await tenantDb(db, ctx.tenant).table('time_entries').where({ time_sheet_id: timeSheetId, work_item_type: COMMERCIAL_WORK }).distinct('work_item_id');
        const items: NonNullable<Awaited<ReturnType<typeof describeCoManagedWork>>>[] = [];
        for (const row of rows) { const described = await describeCoManagedWork(db, ctx.tenant, row.work_item_id); if (described) items.push(described); }
        return items.length ? { handled: true, value: items } : COMMANDS_MISS;
      },
      serviceOptional: async (ctx, workItemType, workItemId) => {
        // Only a participating tenant's own shared customer work; the customer boundary decides (no relationship => native).
        if (!(await participates(ctx.tenant))) return COMMANDS_MISS;
        const { knex: db } = await createTenantKnex();
        const user = await loadUser(db, ctx.tenant, ctx.userId);
        if (!user) return COMMANDS_MISS;
        const admitted = await admitOperational(db, user, ctx.tenant, { work_item_type: workItemType, work_item_id: workItemId } as SaveInput);
        return admitted ? { handled: true, value: true } : COMMANDS_MISS;
      },
      billingContext: async (ctx, db: any, workItemType, workItemId) => {
        if (workItemType !== COMMERCIAL_WORK || !workItemId) return COMMANDS_MISS;
        const reference = await loadCoManagedLocalWorkReference(db, ctx.tenant, workItemId);
        if (!reference) return COMMANDS_MISS;
        return { handled: true, value: { clientId: reference.clientId, billingProfileId: reference.billingProfileId } };
      },
    },
    retain: {
      participation: async (ctx, entryId) => {
        const { knex } = await createTenantKnex();
        await withTransaction(knex, (trx: Knex.Transaction) => retainCoManagedTimeParticipation(trx, ctx.tenant, entryId));
        return { handled: true, value: { retained: true } };
      },
    },
  };
}

export function registerCoManagedTimeSource(): void {
  // Explicit marker first (no query); otherwise the cached `serves` verdict.
  registerTimeSource('co-managed', createCoManagedTimeSource, { workItemTypes: [COMMERCIAL_WORK], servesCapability: 'co-managed' });
}
