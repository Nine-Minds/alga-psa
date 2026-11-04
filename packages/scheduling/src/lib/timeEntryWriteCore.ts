import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { formatISO } from 'date-fns';
import {
  computeWorkDateFields,
  recalculateProjectTaskActualHoursForEntryChange,
  resolveUserTimeZone,
  tenantDb,
  truncateToMinute,
} from '@alga-psa/db';
import { toPlainDate } from '@alga-psa/core';
import {
  type ContractLineSource,
  type ITimeEntry,
  type IUser,
} from '@alga-psa/types';
// Bucket usage MUST go through the shared canonical service. See the note in
// actions/timeEntryCrudActions.ts history: a local fork once queried the dropped
// `client_contract_lines` table and caused a prod outage on time-entry save.
import { assertHumanWorkAssignee, assertHumanWorkOwner } from '@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee';
import { adjustTimeSpanDraw } from '@alga-psa/shared/billingClients/drawAdjustments';
import { isBucketUsageError } from '@alga-psa/shared/billingClients/bucketUsageErrors';
// Hour-block burn MUST go through the shared canonical service too.
import {
  reverseTimeEntryAllocations,
} from '@alga-psa/shared/billingClients/hourBlockService';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { delegateToTimeSource } from './timeSource';
import { resolveTimeEntryContract } from './timeEntryContract';
import { reconcileTimeEntryBillingAllocations } from './timeEntryBillingAllocations';
import { getClientIdForWorkItem } from '../actions/timeEntryHelpers';
import { assertCanActOnBehalf } from '../actions/timeEntryDelegationAuth';
import { markTimeEntryChangeRequestsHandled } from '../actions/timeEntryChangeRequestActions';
import type { SaveTimeEntryParams } from '../actions/timeEntrySchemas';

/**
 * Shared time-entry write core (plan D6).
 *
 * `persistTimeEntry` is the body of `saveTimeEntry` from validation onward:
 * subject/ownership resolution, invoiced guard, sheet owner + period check,
 * contract line resolution, sheet row locking, insert/update, change-request
 * handling, project-hours recalculation, ticket/task resource adding, bucket
 * draw adjustment and the best-effort hour-block burn.
 *
 * Callers (saveTimeEntry, stopwatch log, API stopwatch log endpoint) MUST:
 *  1. Check the role permission BEFORE calling, with the connection they own:
 *     hasPermission(actor, 'time_entry', entry.entry_id ? 'update' : 'create').
 *     That check is deliberately NOT here because API callers authenticate
 *     differently from `withAuth` actions.
 *  2. Validate the input with saveTimeEntryParamsSchema (and require service_id).
 *  3. Run the call inside a transaction they own, and commit it themselves, so
 *     that session/other writes can share the transaction.
 *  4. Call `publishPersistedTimeEntryEvents(result)` only AFTER that
 *     transaction has committed.
 *
 * The core itself enforces assertCanActOnBehalf for the entry's subject user
 * (the existing entry's owner on update, otherwise entry.user_id or the actor),
 * because that depends on the resolved subject.
 *
 * Expected user-facing failures are thrown as plain Errors whose messages are
 * mapped by timeSheetActionErrorFrom (actions/timeSheetActionErrors.ts).
 */

export type TimeEntrySearchEventType = 'TIME_ENTRY_CREATED' | 'TIME_ENTRY_UPDATED';

export interface PersistTimeEntryInput {
  tenant: string;
  /** The acting user (who is doing the write; may differ from the entry's subject). */
  actor: IUser;
  /** Already validated with saveTimeEntryParamsSchema. */
  entry: SaveTimeEntryParams;
  /**
   * Contract-line linkage the caller already decided (the REST time-entry API
   * validates an explicit line, preserves a still-eligible one on update and
   * rejects ambiguity with a 400 before writing). When present the core stores
   * it verbatim — `id: null` clears the linkage — and does NOT run the
   * resolver. Omitted (UI save, stopwatch log) keeps the original behaviour:
   * a supplied `contract_line_id` is 'explicit', otherwise the resolver picks
   * or records why it could not.
   */
  contractLine?: { id: string | null; source: ContractLineSource | null };
  /**
   * Which of the entry's dates must fall inside the sheet's time period.
   *
   *  - 'span' (default — UI save, stopwatch log): both the start and the end
   *    work date. The user picked the sheet themselves, so an entry reaching
   *    past the period is a mis-picked sheet they can correct.
   *  - 'work_date' (REST time-entry API): the work date only. There the server
   *    picks the sheet FROM work_date, which is start-based by design, so an
   *    entry running past local midnight into the next period has no sheet the
   *    caller could have picked instead and 'span' would make it a permanent
   *    400 rather than a correctable one.
   */
  sheetPeriodCheck?: 'span' | 'work_date';
}

export interface WorkItemBillingContext {
  clientId: string | null;
  /** The work item's billing profile; narrows contract-line selection (F134). */
  billingProfileId: string | null;
}

/**
 * The client (and billing profile) a work item bills to. Shared by the write
 * core's resolution and the REST time-entry API's pre-write validation so both
 * derive the resolver inputs identically.
 */
export async function getWorkItemBillingContext(
  tenantScopedDb: any,
  workItemType: string | null | undefined,
  workItemId: string | null | undefined,
): Promise<WorkItemBillingContext> {
  // Time-source seam: a registered non-native source may own this work item; native falls through (0 statements).
  const delegated = await delegateToTimeSource(
    { tenant: tenantScopedDb?.tenant, workItemType, workItemId },
    (source, ctx) => source.work.billingContext(ctx, tenantScopedDb, workItemType, workItemId),
  );
  if (delegated.handled) return delegated.value;
  let clientId: string | null = null;
  // The work item's billing profile narrows contract-line selection when
  // more than one line is eligible — the case parallel per-profile
  // contracts create (F134). Selected alongside the client so the
  // narrowing costs no extra round trip.
  let billingProfileId: string | null = null;

  if (workItemType === 'project_task') {
    const projectTaskClientQuery = tenantScopedDb.table('project_tasks');
    tenantScopedDb.tenantJoin(
      projectTaskClientQuery,
      'project_phases',
      'project_tasks.phase_id',
      'project_phases.phase_id',
    );
    tenantScopedDb.tenantJoin(
      projectTaskClientQuery,
      'projects',
      'project_phases.project_id',
      'projects.project_id',
    );
    const projectRow = await projectTaskClientQuery
      .where({ 'project_tasks.task_id': workItemId })
      .first('projects.client_id', 'projects.billing_profile_id');
    clientId = projectRow?.client_id ?? null;
    billingProfileId = projectRow?.billing_profile_id ?? null;
  } else if (workItemType === 'ticket') {
    const ticketRow = await tenantScopedDb.table('tickets')
      .where({ ticket_id: workItemId })
      .first('client_id', 'billing_profile_id');
    clientId = ticketRow?.client_id ?? null;
    billingProfileId = ticketRow?.billing_profile_id ?? null;
  } else if (workItemType === 'interaction') {
    clientId = (await tenantScopedDb.table('interactions')
      .where({ interaction_id: workItemId })
      .first('client_id'))?.client_id ?? null;
  }

  return { clientId, billingProfileId };
}

export interface PersistedTimeEntry {
  /** The saved row. */
  entry: ITimeEntry;
  isUpdate: boolean;
  /** Billable minutes actually stored (after the explicit-zero / actual-duration rule). */
  finalBillableDuration: number;
  /**
   * Set when the save drew minutes from a contract-issued Prepaid Block. The
   * caller publishes PREPAID_BLOCK_USAGE_CHANGED after commit via
   * publishPersistedTimeEntryEvents.
   */
  prepaidBlockUsage?: { clientId: string; contractLineId: string };
  /** Post-commit event for the caller to publish via publishPersistedTimeEntryEvents. */
  searchEvent: {
    eventType: TimeEntrySearchEventType;
    payload: {
      tenantId: string;
      timeEntryId: string;
      userId?: string;
      workItemId?: string | null;
      workItemType?: string | null;
      changes?: Record<string, unknown>;
    };
  };
}

/**
 * The PREPAID_BLOCK_USAGE_CHANGED payload. `occurredAt` is required by
 * BaseDomainEventPayloadSchema; without it EventBus.publish throws and the
 * best-effort catch below swallows it, so the follow-on block invoice is never drafted.
 */
export function buildPrepaidBlockUsageChangedPayload(
  tenantId: string,
  usage: { clientId: string; contractLineId: string },
) {
  const now = new Date().toISOString();
  return {
    tenantId,
    clientId: usage.clientId,
    contractLineId: usage.contractLineId,
    occurredAt: now,
    timestamp: now,
  };
}

/**
 * Publish the events a persisted entry owes AFTER its transaction committed.
 * Best-effort, exactly like saveTimeEntry always was: a publish failure is
 * logged and never fails the save.
 */
export async function publishPersistedTimeEntryEvents(persisted: PersistedTimeEntry): Promise<void> {
  const { eventType, payload } = persisted.searchEvent;
  try {
    await publishEvent({
      eventType,
      payload: {
        ...payload,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (eventError) {
    console.error(`[TimeEntryActions] Failed to publish ${eventType} event`, eventError);
  }

  const usage = persisted.prepaidBlockUsage;
  if (usage) {
    try {
      await publishEvent({
        eventType: 'PREPAID_BLOCK_USAGE_CHANGED',
        payload: buildPrepaidBlockUsageChangedPayload(persisted.searchEvent.payload.tenantId, usage),
      });
    } catch (eventError) {
      console.error('[TimeEntryActions] Failed to publish PREPAID_BLOCK_USAGE_CHANGED event', eventError);
    }
  }
}

export async function persistTimeEntry(
  trx: Knex.Transaction,
  input: PersistTimeEntryInput,
): Promise<PersistedTimeEntry> {
  const { tenant, actor } = input;
  // Time-source seam: a registered non-native source may own this write; native falls through (0 statements).
  const delegated = await delegateToTimeSource(
    {
      tenant,
      userId: actor.user_id,
      workItemType: input.entry.work_item_type,
      workItemId: input.entry.work_item_id,
    },
    (source, ctx) => source.entries.persist(trx, ctx, input),
  );
  if (delegated.handled) return delegated.value;
  const tenantScopedDb = tenantDb(trx, tenant) as any;

  const validatedTimeEntry = input.entry;
  const actorUserId = actor.user_id;
  let timeEntryUserId = validatedTimeEntry.user_id || actorUserId;

  if (validatedTimeEntry.entry_id) {
    const existing = await tenantScopedDb.table('time_entries')
      .where({ entry_id: validatedTimeEntry.entry_id })
      .select('user_id', 'invoiced', 'time_sheet_id')
      .first();

    if (!existing) {
      throw new Error(`Original time entry with ID ${validatedTimeEntry.entry_id} not found for update.`);
    }

    if (existing.invoiced) {
      throw new Error('This time entry has already been invoiced and cannot be modified.');
    }

    timeEntryUserId = existing.user_id;
  }

  await assertCanActOnBehalf(actor, tenant, timeEntryUserId, trx);

  // Human-work guard (new entries only; an existing entry's owner never changes here).
  // An explicit owner must be a licensed user; a defaulted owner (the actor) must be one too.
  if (!validatedTimeEntry.entry_id) {
    if (validatedTimeEntry.user_id) {
      await assertHumanWorkAssignee(trx, tenant, [validatedTimeEntry.user_id]);
    } else {
      await assertHumanWorkOwner(trx, tenant, actorUserId, 'user_id');
    }
  }

  // Extract only the fields that exist in the database schema
  const {
    entry_id,
    work_item_id,
    work_item_type,
    start_time,
    end_time,
    billable_duration,
    notes,
    time_sheet_id,
    approval_status,
    service_id,
    tax_region,
    contract_line_id,
    tax_rate_id, // Extract tax_rate_id from input
  } = validatedTimeEntry;

  const subjectTimeZone = await resolveUserTimeZone(trx, tenant, timeEntryUserId);
  const { work_date, work_timezone } = computeWorkDateFields(start_time, subjectTimeZone);
  const { work_date: end_work_date } = computeWorkDateFields(end_time, subjectTimeZone);

  if (time_sheet_id) {
    const timeSheetWithPeriodQuery = tenantScopedDb.table('time_sheets');
    tenantScopedDb.tenantJoin(
      timeSheetWithPeriodQuery,
      'time_periods',
      'time_sheets.period_id',
      'time_periods.period_id',
    );
    const timeSheetWithPeriod = await timeSheetWithPeriodQuery
      .where({
        'time_sheets.id': time_sheet_id
      })
      .select('time_sheets.user_id', 'time_periods.start_date', 'time_periods.end_date')
      .first();

    if (!timeSheetWithPeriod) {
      throw new Error('Time sheet not found');
    }

    if (timeSheetWithPeriod.user_id !== timeEntryUserId) {
      throw new Error('Time entry user does not match time sheet owner');
    }

    const periodStart = toPlainDate(timeSheetWithPeriod.start_date).toString();
    const periodEnd = toPlainDate(timeSheetWithPeriod.end_date).toString();

    // See PersistTimeEntryInput.sheetPeriodCheck for why the REST API checks
    // the bucketing date only.
    const datesInPeriod = input.sheetPeriodCheck === 'work_date'
      ? [work_date]
      : [work_date, end_work_date];

    if (datesInPeriod.some((date) => date < periodStart || date >= periodEnd)) {
      throw new Error('Time entry must fall within the time period for the time sheet');
    }
  }

  // LEVERAGE: pattern time-entry-duration-persist — same normalize-to-minute + round shape
  // lives in TimeEntryService (create/update/stop); a shared persist layer would own it once.
  const startDate = truncateToMinute(start_time);
  const endDate = truncateToMinute(end_time);
  const actualDurationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  
  // Always store actual duration, only set billable_duration to 0 if explicitly non-billable
  const finalBillableDuration = billable_duration === 0 ? 0 :
                             (typeof billable_duration === 'number' && billable_duration > 0 ? billable_duration : actualDurationMinutes);

  console.log('Calculating billable duration:', {
    providedBillableDuration: billable_duration,
    actualDurationMinutes,
    finalBillableDuration,
    isExplicitlyZero: billable_duration === 0,
    isValidNumber: typeof billable_duration === 'number' && billable_duration > 0,
    billableDurationType: typeof billable_duration
  });

  const cleanedEntry = {
    work_item_id,
    work_item_type,
    start_time: formatISO(startDate), // minute-truncated; keep stored instant in sync with duration
    end_time: formatISO(endDate),
    work_date,
    work_timezone,
    billable_duration: finalBillableDuration,
    notes,
    time_sheet_id,
    approval_status,
    service_id,
    tax_region,
    contract_line_id,
    // Provenance for the contract line (F062). A caller-supplied line is
    // 'explicit' by definition; the resolver below overwrites this when it
    // picks (or fails to pick) one itself.
    contract_line_source: (contract_line_id ? 'explicit' : null) as ContractLineSource | null,
    tax_rate_id, // Add tax_rate_id to the object being saved
    user_id: timeEntryUserId,
    updated_by: actorUserId,
    tenant: tenant as string,
    updated_at: new Date().toISOString()
  };

  // Log the cleaned entry for debugging
  console.log('Cleaned entry data:', cleanedEntry);

  let resultingEntry: ITimeEntry | null = null;

  if (input.contractLine) {
    // The caller already decided the linkage (see PersistTimeEntryInput.contractLine).
    cleanedEntry.contract_line_id = input.contractLine.id ?? (null as any);
    cleanedEntry.contract_line_source = input.contractLine.source;
  } else if (!contract_line_id && service_id) {
    // If no contract line ID is provided, try to determine the default one
    const resolved = await resolveTimeEntryContract({
      serviceId: service_id,
      effectiveDate: work_date || start_time,
      getBillingContext: () => getWorkItemBillingContext(tenantScopedDb, work_item_type, work_item_id),
    });
    cleanedEntry.contract_line_id = resolved.contractLineId as any;
    cleanedEntry.contract_line_source = resolved.source;
  }


  console.log('Starting transaction for time entry');

  // Status is the editability gate: only DRAFT and CHANGES_REQUESTED sheets
  // accept writes. Lock the target sheet (and, on an update, the sheet the
  // entry is currently attached to) before any entry or billing write so a
  // concurrent submission cannot slip through and a caller cannot bypass a
  // locked original by pointing the entry at another sheet. Locking in
  // sorted id order keeps the lock order stable against other writers.
  const editableStatuses = new Set(['DRAFT', 'CHANGES_REQUESTED']);
  const sheetIdsToLock = new Set<string>();
  if (cleanedEntry.time_sheet_id) {
    sheetIdsToLock.add(cleanedEntry.time_sheet_id);
  }
  if (entry_id) {
    const originalSheet = await tenantScopedDb.table('time_entries')
      .where({ entry_id })
      .first('time_sheet_id');
    if (originalSheet?.time_sheet_id) {
      sheetIdsToLock.add(originalSheet.time_sheet_id);
    }
  }
  for (const sheetId of Array.from(sheetIdsToLock).sort()) {
    const lockedSheet = await tenantScopedDb.table('time_sheets')
      .where({ id: sheetId })
      .forUpdate()
      .first('approval_status');
    if (!lockedSheet) {
      throw new Error('Time sheet not found');
    }
    if (!editableStatuses.has(lockedSheet.approval_status)) {
      throw new Error(
        sheetId === cleanedEntry.time_sheet_id
          ? 'Time sheet is not editable'
          : 'Original time sheet is not editable',
      );
    }
  }

  let oldDuration = 0; // Initialize oldDuration
  let oldEntrySpan: {
    service_id?: string | null;
    start_time?: string | Date;
    end_time?: string | Date;
    contract_line_id?: string | null;
    work_item_id?: string | null;
    work_item_type?: string | null;
  } | null = null;
  if (entry_id) {
    // Fetch original entry before update to calculate delta
    const originalEntryForUpdate = await tenantScopedDb.table('time_entries')
      .where({ entry_id })
      .select('billable_duration', 'work_item_id', 'work_item_type', 'service_id', 'start_time', 'end_time', 'contract_line_id')
      .first();
    // If original entry not found, maybe throw error or handle gracefully?
    // Throwing error for now as update shouldn't happen if original is gone.
    if (!originalEntryForUpdate) {
         throw new Error(`Original time entry with ID ${entry_id} not found for update.`);
    }
    oldDuration = originalEntryForUpdate.billable_duration || 0;
    oldEntrySpan = originalEntryForUpdate;

    // Update existing entry - exclude tenant from SET clause (partition key cannot be modified)
    const { tenant: _tenant, user_id: _user_id, ...updateData } = cleanedEntry;
    const [updated] = await tenantScopedDb.table('time_entries')
      .where({ entry_id })
      .update(updateData)
      .returning('*');

    if (!updated) {
      throw new Error('Time entry not found');
    }

    resultingEntry = updated;
    console.log('Updated entry:', resultingEntry);

    if (updated.time_sheet_id) {
      const timeSheetStatus = await tenantScopedDb.table('time_sheets')
        .where({
          id: updated.time_sheet_id,
        })
        .first('approval_status');

      if (timeSheetStatus?.approval_status === 'CHANGES_REQUESTED') {
        await markTimeEntryChangeRequestsHandled(trx, {
          tenant,
          timeEntryId: entry_id,
          handledBy: actorUserId,
        });
      }
    }

    await recalculateProjectTaskActualHoursForEntryChange(
      trx,
      tenant,
      originalEntryForUpdate,
      updated,
    );
  } else {
    // Insert new entry
    const [inserted] = await tenantScopedDb.table('time_entries')
      .insert({
        ...cleanedEntry,
        entry_id: uuidv4(),
        created_at: new Date().toISOString(),
        created_by: actorUserId
      })
      .returning('*');

    if (!inserted) {
      throw new Error('Time entry insert completed without returning a saved row.');
    }

    resultingEntry = inserted;
    console.log('Inserted entry:', resultingEntry);

    // Add user to ticket_resources or task_resources when a new time entry is created.
    if (work_item_type === 'project_task') {
      await recalculateProjectTaskActualHoursForEntryChange(trx, tenant, null, inserted);

      // Get current task to check if it already has an assignee
      const task = await tenantScopedDb.table('project_tasks')
        .where({
          task_id: work_item_id,
        })
        .first();

      if (task) {
        // Check if user is already in task_resources for this task
        const existingResource = await tenantScopedDb.table('task_resources')
          .where({
            task_id: work_item_id,
          })
          .where(function(this: any) {
            this.where('assigned_to', timeEntryUserId)
              .orWhere('additional_user_id', timeEntryUserId);
          })
          .first();

        // If task already has an assignee and it's not the current user
        if (task.assigned_to && task.assigned_to !== timeEntryUserId) {
          // Only add as additional user if not already in resources
          if (!existingResource) {
            await tenantScopedDb.table('task_resources').insert({
              task_id: work_item_id,
              assigned_to: task.assigned_to,
              additional_user_id: timeEntryUserId,
              assigned_at: new Date(),
              tenant,
            });
          }
        } else if (!task.assigned_to) {
          // If task has no assignee, only update the task's assigned_to field
          await tenantScopedDb.table('project_tasks')
            .where({
              task_id: work_item_id,
            })
            .update({
              assigned_to: timeEntryUserId,
              updated_at: new Date(),
            });
          // No task_resources record is created when there's no additional user
        }
      }
    } else if (work_item_type === 'ticket') {
      // Check if user is already in ticket_resources for this ticket
      const existingResource = await tenantScopedDb.table('ticket_resources')
        .where({
          ticket_id: work_item_id,
        })
        .where(function(this: any) {
          this.where('assigned_to', timeEntryUserId)
            .orWhere('additional_user_id', timeEntryUserId);
        })
        .first();

      if (!existingResource) {
        // Get current ticket to check if it already has an assignee
        const ticket = await tenantScopedDb.table('tickets')
          .where({
            ticket_id: work_item_id,
          })
          .first();

        if (ticket) {
          // If ticket already has an assignee, add user as additional_user_id
          if (ticket.assigned_to && ticket.assigned_to !== timeEntryUserId) {
            await tenantScopedDb.table('ticket_resources').insert({
              ticket_id: work_item_id,
              assigned_to: ticket.assigned_to,
              additional_user_id: timeEntryUserId,
              assigned_at: new Date(),
              tenant,
            });
          } else if (!ticket.assigned_to) {
            // If ticket has no assignee, update the ticket to set user as assigned_to
            // Note: We do NOT create a ticket_resources record here because that table
            // is only for additional agents, not the primary assignee
            await tenantScopedDb.table('tickets')
              .where({
                ticket_id: work_item_id,
              })
              .update({
                assigned_to: timeEntryUserId,
                updated_at: new Date().toISOString(),
                updated_by: actorUserId,
              });
          }
        }
      }
    }
  }
  // Bucket draw + hour-block reconciliation (extracted verbatim; see timeEntryBillingAllocations.ts).
  const { prepaidBlockUsage } = await reconcileTimeEntryBillingAllocations(trx, tenant, {
    entry_id,
    resultingEntry,
    oldEntrySpan,
    oldDuration,
  });

  if (!resultingEntry) {
    throw new Error('Time entry save completed without creating or updating a row.');
  }

  // Ensure resultingEntry is treated as ITimeEntry
  const entry = resultingEntry as ITimeEntry;
  if (!entry.entry_id) {
    throw new Error('Time entry save returned a row without an entry ID.');
  }

  return {
    entry,
    isUpdate: !!entry_id,
    finalBillableDuration,
    prepaidBlockUsage,
    searchEvent: {
      eventType: entry_id ? 'TIME_ENTRY_UPDATED' : 'TIME_ENTRY_CREATED',
      payload: {
        tenantId: tenant,
        timeEntryId: entry.entry_id,
        userId: entry.user_id,
        workItemId: entry.work_item_id,
        workItemType: entry.work_item_type,
        changes: entry_id ? (validatedTimeEntry as Record<string, unknown>) : undefined,
      },
    },
  };
}


/**
 * Shared time-entry delete core. Used by the UI `deleteTimeEntry` action and
 * the REST `TimeEntryService.delete` (single and bulk) so the billing
 * reversals cannot drift apart.
 *
 * Runs inside the caller's transaction (the caller commits):
 *  1. load the row (throws 'Time entry not found'),
 *  2. optional caller `guard(entry)` (delegation/invoiced/approval checks),
 *  3. reverse the bucket draw (adjustTimeSpanDraw, -1, under the entry's own
 *     client and contract_line_id; only when it has a service and billable
 *     minutes and its work item resolves to a client),
 *  4. reverse the hour-block burn (best-effort, unconditional),
 *  5. delete the row and recalculate project-task actual hours.
 *
 * Permission checks and event publishing stay with the caller (publish only
 * after commit).
 */
export async function deleteTimeEntryCore(
  trx: Knex.Transaction,
  tenant: string,
  entryId: string,
  options: { guard?: (entry: any) => Promise<void> | void } = {},
): Promise<{ timeEntry: any; deleteCount: number }> {
  // Time-source seam: a registered non-native source may own this delete; native falls through (0 statements).
  const delegated = await delegateToTimeSource({ tenant }, (source, ctx) =>
    source.entries.removeCore(trx, ctx, tenant, entryId, options));
  if (delegated.handled) return delegated.value;
  const trxTenantDb = tenantDb(trx, tenant) as any;
  const timeEntry = await trxTenantDb.table('time_entries')
    .where({ entry_id: entryId })
    .first();

  if (!timeEntry) {
    throw new Error('Time entry not found');
  }

  if (options.guard) {
    await options.guard(timeEntry);
  }

  // --- Bucket Usage Update Logic (Before Delete) ---
  if (timeEntry.service_id && (timeEntry.billable_duration || 0) > 0) {
    let clientId: string | null = null;
    if (timeEntry.work_item_id && timeEntry.work_item_type) {
      clientId = await getClientIdForWorkItem(trx, tenant, timeEntry.work_item_id as string, timeEntry.work_item_type as string);
    }

    if (clientId && timeEntry.service_id) {
      // Scope-resolution gate + weighted burn, resolved under the deleted
      // entry's OWN client and line (negative on delete).
      try {
        const reversedDelta = await adjustTimeSpanDraw(
          trx,
          tenant,
          clientId,
          {
            service_id: timeEntry.service_id,
            start_time: timeEntry.start_time,
            end_time: timeEntry.end_time,
            billable_duration: timeEntry.billable_duration,
            contract_line_id: timeEntry.contract_line_id ?? null,
          },
          -1,
        );
        if (reversedDelta !== 0) {
          console.log(`Successfully decremented bucket usage for deleted entry ${entryId} (weighted delta ${reversedDelta})`);
        }
      } catch (bucketError) {
        console.error(`Error updating bucket usage for deleted time entry ${entryId}:`, bucketError);
        // Re-throwing ensures data consistency; preserve the typed code.
        if (isBucketUsageError(bucketError)) {
          throw bucketError;
        }
        throw new Error(`Bucket usage update failed while deleting time entry ${entryId}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
      }
    }
  }
  // --- End Bucket Usage Update Logic ---

  // --- Hour-block burn reversal ---
  // Restore the minutes the deleted entry drew from any hour blocks. Best-
  // effort like the save path: failures are logged and the nightly reconcile
  // converges. Runs unconditionally (an entry may carry block allocations
  // without being contract-covered).
  try {
    await reverseTimeEntryAllocations(trx, tenant, entryId);
  } catch (blockReverseError) {
    console.error(`Error reversing hour-block burn for deleted time entry ${entryId}:`, blockReverseError);
  }
  // --- End Hour-block burn reversal ---

  const deleteCount = await trxTenantDb.table('time_entries')
    .where({ entry_id: entryId })
    .delete();

  await recalculateProjectTaskActualHoursForEntryChange(trx, tenant, timeEntry, null);

  return { timeEntry, deleteCount };
}
