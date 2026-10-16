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
import type { CoManagedNativeTimeAccess } from '@alga-psa/co-managed';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { resolveTimeEntryContract } from './timeEntryContract';
// Bucket draw and hour-block burn, through the shared canonical services.
import { reconcileTimeEntryBillingAllocations } from './timeEntryBillingAllocations';
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

/** Stands in for the work item of non-billable time saved without one. */
export const NON_BILLABLE_FALLBACK_WORK_ITEM_ID = '__non_billable__';

export interface PersistTimeEntryInput {
  tenant: string;
  /** The acting user (who is doing the write; may differ from the entry's subject). */
  actor: IUser;
  /** Already validated with saveTimeEntryParamsSchema (or the operational schema). */
  entry: SaveTimeEntryParams;
  /**
   * Operational (co-managed customer) time: no service or contract, the fields
   * from operationalTimeEntryFields are stored as given, and no billing draw.
   */
  operational?: { fields: Record<string, unknown> } | null;
  /**
   * Admitted co-managed access. The subject user comes from the admission
   * rather than act-on-behalf, and the save does not reassign work.
   */
  access?: CoManagedNativeTimeAccess | null;
}

export interface PersistedTimeEntry {
  /** The saved row. */
  entry: ITimeEntry;
  isUpdate: boolean;
  /** Billable minutes actually stored (after the explicit-zero / actual-duration rule). */
  finalBillableDuration: number;
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
}

export async function persistTimeEntry(
  trx: Knex.Transaction,
  input: PersistTimeEntryInput,
): Promise<PersistedTimeEntry> {
  const { tenant, actor } = input;
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

  const { operational, access } = input;
  if (access) timeEntryUserId = access.subjectUserId;
  else await assertCanActOnBehalf(actor, tenant, timeEntryUserId, trx);

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

    if (
      work_date < periodStart ||
      work_date >= periodEnd ||
      end_work_date < periodStart ||
      end_work_date >= periodEnd
    ) {
      throw new Error('Time entry must fall within the time period for the time sheet');
    }
  }

  // LEVERAGE: pattern time-entry-duration-persist — same normalize-to-minute + round shape
  // lives in TimeEntryService (create/update/stop); a shared persist layer would own it once.
  const startDate = truncateToMinute(start_time);
  const endDate = truncateToMinute(end_time);
  const actualDurationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  if (access && actualDurationMinutes <= 0) throw new Error('Time entry must contain at least one minute');
  
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
    co_managed_work_reference_id: work_item_type === 'co_managed' ? work_item_id : null,
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
  if (operational) Object.assign(cleanedEntry, operational.fields);
  if (access && work_item_type === 'non_billable_category' && work_item_id === NON_BILLABLE_FALLBACK_WORK_ITEM_ID) {
    Object.assign(cleanedEntry, { work_item_id: null });
  }

  let resultingEntry: ITimeEntry | null = null;

  // Commercial time resolves its contract line in this transaction; an explicit
  // line must actually cover the work's client and service.
  if (!operational) {
    Object.assign(cleanedEntry, await resolveTimeEntryContract(trx, tenant, cleanedEntry, {
      explicitLineId: contract_line_id,
    }));
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

  let oldEntrySpan: {
    billing_mode?: string;
    billable_duration?: number;
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
      .select('billing_mode', 'billable_duration', 'work_item_id', 'work_item_type', 'service_id', 'start_time', 'end_time', 'contract_line_id')
      .first();
    // If original entry not found, maybe throw error or handle gracefully?
    // Throwing error for now as update shouldn't happen if original is gone.
    if (!originalEntryForUpdate) {
         throw new Error(`Original time entry with ID ${entry_id} not found for update.`);
    }
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

    await recalculateProjectTaskActualHoursForEntryChange(trx, tenant, null, inserted);
    // Add user to ticket_resources or task_resources when a new time entry is
    // created. Co-managed (admitted) effort does not implicitly change work
    // assignments.
    if (!access && work_item_type === 'project_task') {

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
    } else if (!access && work_item_type === 'ticket') {
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

  if (!resultingEntry) {
    throw new Error('Time entry save completed without creating or updating a row.');
  }
  // Bucket draw and hour-block burn for the old/new rows (operational time draws nothing).
  await reconcileTimeEntryBillingAllocations(trx, tenant, oldEntrySpan, resultingEntry);

  // Ensure resultingEntry is treated as ITimeEntry
  const entry = resultingEntry as ITimeEntry;
  if (!entry.entry_id) {
    throw new Error('Time entry save returned a row without an entry ID.');
  }

  return {
    entry,
    isUpdate: !!entry_id,
    finalBillableDuration,
    searchEvent: {
      eventType: entry_id ? 'TIME_ENTRY_UPDATED' : 'TIME_ENTRY_CREATED',
      payload: {
        tenantId: tenant,
        timeEntryId: entry.entry_id,
        userId: entry.user_id,
        workItemId: entry.work_item_id,
        workItemType: entry.work_item_type,
        changes: entry_id && !access ? (validatedTimeEntry as Record<string, unknown>) : undefined,
      },
    },
  };
}
