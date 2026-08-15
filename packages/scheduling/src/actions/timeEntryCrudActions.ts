'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { determineDefaultContractLine } from '../lib/contractLineDisambiguation';
// Bucket usage MUST go through the shared canonical service. This package used
// to carry a local fork (src/services/bucketUsageService.ts) that kept querying
// the dropped `client_contract_lines` table and caused a prod outage on
// time-entry save. Don't recreate a local copy.
import { adjustTimeSpanDraw } from '@alga-psa/shared/billingClients/drawAdjustments';
import { isBucketUsageError } from '@alga-psa/shared/billingClients/bucketUsageErrors';
// Hour-block burn MUST go through the shared canonical service too — same
// rationale as bucketUsageService (both scheduling and billing import it).
import {
  allocateTimeEntry,
  reverseTimeEntryAllocations,
} from '@alga-psa/shared/billingClients/hourBlockService';
import {
  ITimeEntry,
  ITimeEntryWithWorkItem,
} from '@alga-psa/types';
import { IWorkItem } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import { formatISO } from 'date-fns';
import { validateData } from '@alga-psa/validation';
import {
  fetchTimeEntriesParamsSchema,
  FetchTimeEntriesParams,
  saveTimeEntryParamsSchema,
  SaveTimeEntryParams,
  updateTimeEntryApprovalStatusParamsSchema,
  UpdateTimeEntryApprovalStatusParams,
} from './timeEntrySchemas'; // Import schemas
import { getClientIdForWorkItem } from './timeEntryHelpers'; // Import helper
import { computeWorkDateFields, resolveUserTimeZone, truncateToMinute } from '@alga-psa/db';
import { assertCanActOnBehalf, assertCanApproveSubject } from './timeEntryDelegationAuth';
import { toPlainDate } from '@alga-psa/core';
import {
  createTimeEntryChangeRequestRecord,
  fetchTimeEntryChangeRequestsForEntryIdsFromDb,
  markTimeEntryChangeRequestsHandled,
} from './timeEntryChangeRequestActions';
import { attachTimeEntryChangeRequests } from '../lib/timeEntryChangeRequests';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import {
  timeSheetActionErrorFrom,
  type TimeSheetActionError,
} from './timeSheetActionErrors';
import { recalculateProjectTaskActualHoursForEntryChange } from '@alga-psa/db';

function captureAnalytics(_event: string, _properties?: Record<string, any>, _userId?: string): void {
  // Intentionally no-op: avoid pulling analytics (and its tenancy/client-portal deps) into scheduling.
}

const NON_BILLABLE_FALLBACK_WORK_ITEM_ID = '__non_billable__';

type TimeEntrySearchEventType =
  | 'TIME_ENTRY_CREATED'
  | 'TIME_ENTRY_UPDATED'
  | 'TIME_ENTRY_DELETED'
  | 'TIME_ENTRY_SUBMITTED'
  | 'TIME_ENTRY_APPROVED'
  | 'TIME_ENTRY_CHANGES_REQUESTED';

async function publishTimeEntrySearchEvent(
  eventType: TimeEntrySearchEventType,
  payload: {
    tenantId: string;
    timeEntryId: string;
    userId?: string;
    workItemId?: string | null;
    workItemType?: string | null;
    approvedBy?: string;
    requestedBy?: string;
    reason?: string;
    changes?: Record<string, unknown>;
  },
): Promise<void> {
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

function normalizeFetchedWorkItemId(entry: Pick<ITimeEntry, 'work_item_id' | 'work_item_type'>): string {
  if (entry.work_item_type === 'non_billable_category' && !entry.work_item_id) {
    return NON_BILLABLE_FALLBACK_WORK_ITEM_ID;
  }

  return entry.work_item_id;
}

export const fetchTimeEntriesForTimeSheet = withAuth(async (
  user,
  { tenant },
  timeSheetId: string
): Promise<ITimeEntryWithWorkItem[] | TimeSheetActionError> => {
  try {
    const {knex: db} = await createTenantKnex();
    const tenantScopedDb = tenantDb(db, tenant) as any;

  // Check permission for time entry reading
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read time entries');
  }

  // Validate input
  const validatedParams = validateData<FetchTimeEntriesParams>(fetchTimeEntriesParamsSchema, { timeSheetId });

  const timeSheet = await tenantScopedDb.table('time_sheets')
    .where({ id: validatedParams.timeSheetId })
    .select('user_id')
    .first();

  if (!timeSheet) {
    throw new Error('Time sheet not found');
  }

  await assertCanActOnBehalf(user, tenant, timeSheet.user_id, db);

  const timeEntriesQuery = tenantScopedDb.table('time_entries');
  tenantScopedDb.tenantJoin(
    timeEntriesQuery,
    'service_catalog',
    'time_entries.service_id',
    'service_catalog.service_id',
    { type: 'left' },
  );
  const timeEntries: any[] = await timeEntriesQuery
    .where({
      'time_entries.time_sheet_id': validatedParams.timeSheetId
    })
    .orderBy('time_entries.start_time', 'desc')
    .select('time_entries.*', 'service_catalog.service_name');

  const changeRequestsByEntryId = await fetchTimeEntryChangeRequestsForEntryIdsFromDb(
    db,
    tenant,
    timeEntries
      .map((entry: any) => entry.entry_id)
      .filter((entryId: any): entryId is string => Boolean(entryId)),
  );

  // Fetch work item details for these time entries
  const workItemDetails = await Promise.all(timeEntries.map(async (entry: any): Promise<IWorkItem> => {
    const normalizedWorkItemId = normalizeFetchedWorkItemId(entry);
    let workItem;
    switch (entry.work_item_type) {
      case 'ticket':
        [workItem] = await tenantScopedDb.table('tickets')
          .where({
            ticket_id: entry.work_item_id
          })
          .select('ticket_id as work_item_id', 'title as name', 'url as description', 'ticket_number');
        break;
      case 'project_task':
        const projectTaskQuery = tenantScopedDb.table('project_tasks')
          .where({
            task_id: entry.work_item_id
          });
        tenantScopedDb.tenantJoin(projectTaskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
        tenantScopedDb.tenantJoin(projectTaskQuery, 'projects', 'project_phases.project_id', 'projects.project_id');
        [workItem] = await projectTaskQuery
          .select(
            'task_id as work_item_id',
            'task_name as name',
            'project_tasks.description',
            'projects.project_name as project_name',
            'project_phases.phase_name as phase_name'
          );
        break;
      case 'non_billable_category':
        workItem = {
          work_item_id: normalizedWorkItemId,
          name: entry.notes?.trim() || 'Non-billable',
          description: '',
          type: 'non_billable_category',
        };
        break;
      case 'ad_hoc':
        // For ad_hoc entries, get the title from schedule entries
        const scheduleEntry = await tenantScopedDb.table('schedule_entries')
          .where({
            entry_id: entry.work_item_id
          })
          .first();

        workItem = {
          work_item_id: entry.work_item_id,
          name: scheduleEntry?.title || entry.work_item_id,
          description: '',
          type: 'ad_hoc',
        };
        break;
      case 'interaction':
        const interactionQuery = tenantScopedDb.table('interactions')
          .where({
            'interactions.interaction_id': entry.work_item_id
          });
        tenantScopedDb.tenantJoin(interactionQuery, 'clients', 'interactions.client_id', 'clients.client_id', { type: 'left' });
        tenantScopedDb.tenantJoin(interactionQuery, 'contacts', 'interactions.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
        tenantScopedDb.tenantJoin(interactionQuery, 'interaction_types', 'interactions.type_id', 'interaction_types.type_id', { type: 'left' });
        [workItem] = await interactionQuery
          .select(
            'interactions.interaction_id as work_item_id',
            'interactions.title as name',
            db.raw("'' as description"), // Don't copy interaction notes to time entry
            'clients.client_name',
            'contacts.full_name as contact_name',
            'interaction_types.type_name as interaction_type'
          );
        
        // If interaction not found, create a placeholder
        if (!workItem) {
          console.warn(`Interaction not found for time entry: ${entry.work_item_id}`);
          workItem = {
            work_item_id: entry.work_item_id,
            name: 'Deleted Interaction',
            description: '',
            type: 'interaction'
          };
        }
        break;
      default:
        throw new Error(`Unknown work item type: ${entry.work_item_type}`);
    }

    // Fetch service information without treating billing mode as service identity/type.
    const serviceQuery = tenantScopedDb.table('service_catalog as sc');
    tenantScopedDb.tenantJoin(serviceQuery, 'service_types as st', 'sc.custom_service_type_id', 'st.id', { type: 'left' });
    const [service] = await serviceQuery
      .where({
        'sc.service_id': entry.service_id
      })
      .select(
        'sc.service_name',
        'st.name as service_type',
        'sc.billing_method as billing_mode',
        'sc.item_kind',
        db.raw('CAST(sc.default_rate AS FLOAT) as default_rate')
      );

    return {
      ...workItem,
      created_at: formatISO(entry.created_at),
      updated_at: formatISO(entry.updated_at),
      start_date: formatISO(entry.start_time),
      end_date: formatISO(entry.end_time),
      type: entry.work_item_type,
      is_billable: entry.billable_duration > 0,
      ticket_number: entry.work_item_type === 'ticket' ? workItem.ticket_number : undefined,
      service: service ? {
        id: entry.service_id,
        name: service.service_name,
        type: service.service_type,
        billing_mode: service.billing_mode,
        item_kind: service.item_kind,
        default_rate: service.default_rate
      } : null
    };
  }));

  const workItemMap = new Map(workItemDetails.map((item): [string, IWorkItem] => [item.work_item_id, item]));

  const entriesWithWorkItems = timeEntries.map((entry: any): ITimeEntryWithWorkItem => {
    const normalizedWorkItemId = normalizeFetchedWorkItemId(entry);

    return {
      ...entry,
      work_item_id: normalizedWorkItemId,
      date: new Date(entry.start_time),
      start_time: formatISO(entry.start_time),
      end_time: formatISO(entry.end_time),
      updated_at: formatISO(entry.updated_at),
      created_at: formatISO(entry.created_at),
      // work_date is a DATE column - convert to ISO string (YYYY-MM-DD)
      work_date: entry.work_date instanceof Date
        ? entry.work_date.toISOString().slice(0, 10)
        : (typeof entry.work_date === 'string' ? entry.work_date.slice(0, 10) : undefined),
      workItem: workItemMap.get(normalizedWorkItemId),
    };
  });

    return attachTimeEntryChangeRequests(entriesWithWorkItems, changeRequestsByEntryId);
  } catch (error) {
    console.error('Error fetching time entries for time sheet:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const saveTimeEntry = withAuth(async (
  user,
  { tenant },
  timeEntry: Omit<ITimeEntry, 'tenant'>
): Promise<ITimeEntryWithWorkItem | TimeSheetActionError> => {
  const {knex: db} = await createTenantKnex();
  const tenantScopedDb = tenantDb(db, tenant) as any;

  try {
  // Check permission based on whether this is a create or update operation
  if (timeEntry.entry_id) {
    // Update operation
    if (!await hasPermission(user, 'timeentry', 'update', db)) {
      throw new Error('Permission denied: Cannot update time entries');
    }
  } else {
    // Create operation
    if (!await hasPermission(user, 'timeentry', 'create', db)) {
      throw new Error('Permission denied: Cannot create time entries');
    }
  }

  // Validate input
  const validatedTimeEntry = validateData<SaveTimeEntryParams>(saveTimeEntryParamsSchema, timeEntry);

  if (!validatedTimeEntry.service_id?.trim()) {
    throw new Error('Service is required for time entries');
  }

  const actorUserId = user.user_id;
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

    await assertCanActOnBehalf(user, tenant, timeEntryUserId, db);

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

    const subjectTimeZone = await resolveUserTimeZone(db, tenant, timeEntryUserId);
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
      tax_rate_id, // Add tax_rate_id to the object being saved
      user_id: timeEntryUserId,
      updated_by: actorUserId,
      tenant: tenant as string,
      updated_at: new Date().toISOString()
    };

    // Log the cleaned entry for debugging
    console.log('Cleaned entry data:', cleanedEntry);

    let resultingEntry: ITimeEntry | null = null;

    // If no contract line ID is provided, try to determine the default one
    if (!contract_line_id && service_id) {
      try {
        const effectiveDateForContractResolution = work_date || start_time;
        let defaultContractClientId: string | null = null;

        if (work_item_type === 'project_task') {
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
          defaultContractClientId = (await projectTaskClientQuery
            .where({ 'project_tasks.task_id': work_item_id })
            .first('projects.client_id'))?.client_id ?? null;
        } else if (work_item_type === 'ticket') {
          defaultContractClientId = (await tenantScopedDb.table('tickets')
            .where({ ticket_id: work_item_id })
            .first('client_id'))?.client_id ?? null;
        } else if (work_item_type === 'interaction') {
          defaultContractClientId = (await tenantScopedDb.table('interactions')
            .where({ interaction_id: work_item_id })
            .first('client_id'))?.client_id ?? null;
        }

        const defaultPlanId = await determineDefaultContractLine(
          defaultContractClientId as string,
          service_id,
          effectiveDateForContractResolution
        );

        if (defaultPlanId) {
          cleanedEntry.contract_line_id = defaultPlanId;
        }
      } catch (error) {
        console.error('Error determining default contract line:', error);
      }
    }


    await db.transaction(async (trx) => {
      const trxTenantDb = tenantDb(trx, tenant) as any;
      console.log('Starting transaction for time entry');
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
        const originalEntryForUpdate = await trxTenantDb.table('time_entries')
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
        const [updated] = await trxTenantDb.table('time_entries')
          .where({ entry_id })
          .update(updateData)
          .returning('*');

        if (!updated) {
          throw new Error('Time entry not found');
        }

        resultingEntry = updated;
        console.log('Updated entry:', resultingEntry);

        if (updated.time_sheet_id) {
          const timeSheetStatus = await trxTenantDb.table('time_sheets')
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
        const [inserted] = await trxTenantDb.table('time_entries')
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
          const task = await trxTenantDb.table('project_tasks')
            .where({
              task_id: work_item_id,
            })
            .first();

          if (task) {
            // Check if user is already in task_resources for this task
            const existingResource = await trxTenantDb.table('task_resources')
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
                await trxTenantDb.table('task_resources').insert({
                  task_id: work_item_id,
                  assigned_to: task.assigned_to,
                  additional_user_id: timeEntryUserId,
                  assigned_at: new Date(),
                  tenant,
                });
              }
            } else if (!task.assigned_to) {
              // If task has no assignee, only update the task's assigned_to field
              await trxTenantDb.table('project_tasks')
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
          const existingResource = await trxTenantDb.table('ticket_resources')
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
            const ticket = await trxTenantDb.table('tickets')
              .where({
                ticket_id: work_item_id,
              })
              .first();

            if (ticket) {
              // If ticket already has an assignee, add user as additional_user_id
              if (ticket.assigned_to && ticket.assigned_to !== timeEntryUserId) {
                await trxTenantDb.table('ticket_resources').insert({
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
                await trxTenantDb.table('tickets')
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
      // --- Bucket Usage Update Logic ---
      // Two independent draws, each resolved from ITS OWN record side:
      // reverse the OLD entry's burn under the OLD entry's own client (its own
      // work item), span, service, and line; then apply the NEW entry's burn
      // under the NEW entry's own client, span, service, and line. Never reuse
      // the new context to reverse the old draw (or vice versa) — that would
      // reverse against the wrong pool when an entry moves clients/lines.
      let newClientId: string | null = null;
      if (resultingEntry?.work_item_id && resultingEntry.work_item_type) {
        newClientId = await getClientIdForWorkItem(trx, tenant, resultingEntry.work_item_id as string, resultingEntry.work_item_type as string);
      }
      if (newClientId) {
        // New side: apply the saved entry's burn when it resolves to a pool.
        if (resultingEntry && resultingEntry.service_id && (resultingEntry.billable_duration || 0) > 0) {
          try {
            const appliedDelta = await adjustTimeSpanDraw(
              trx,
              tenant,
              newClientId,
              {
                service_id: resultingEntry.service_id,
                start_time: resultingEntry.start_time,
                end_time: resultingEntry.end_time,
                billable_duration: resultingEntry.billable_duration,
                contract_line_id: resultingEntry.contract_line_id ?? null,
              },
              1,
            );
            if (appliedDelta !== 0) {
              console.log(`Applied new bucket usage for entry ${resultingEntry.entry_id} (weighted ${appliedDelta})`);
            }
          } catch (bucketError) {
            if (isBucketUsageError(bucketError)) throw bucketError;
            throw new Error(`Bucket usage update failed for time entry ${resultingEntry.entry_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
          }
        }
      }

      // Old side (updates only): resolve the reversal under the OLD entry's own
      // client (its own work item), span, service, and line.
      let oldClientId: string | null = null;
      if (entry_id && oldEntrySpan?.work_item_id && oldEntrySpan.work_item_type) {
        oldClientId = await getClientIdForWorkItem(trx, tenant, oldEntrySpan.work_item_id as string, oldEntrySpan.work_item_type as string);
      }
      if (entry_id && oldClientId && oldEntrySpan?.service_id && oldEntrySpan.start_time) {
        try {
          const reversedDelta = await adjustTimeSpanDraw(
            trx,
            tenant,
            oldClientId,
            {
              service_id: oldEntrySpan.service_id,
              start_time: oldEntrySpan.start_time,
              end_time: oldEntrySpan.end_time ?? oldEntrySpan.start_time,
              billable_duration: oldDuration,
              contract_line_id: oldEntrySpan.contract_line_id ?? null,
            },
            -1,
          );
          if (reversedDelta !== 0) {
            console.log(`Reversed old bucket usage for entry ${resultingEntry?.entry_id} (weighted ${reversedDelta})`);
          }
        } catch (bucketError) {
          if (isBucketUsageError(bucketError)) throw bucketError;
          throw new Error(`Bucket usage reversal failed for time entry ${resultingEntry?.entry_id}: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
        }
      }
      // --- End Bucket Usage Update Logic ---

      // --- Hour-block burn logic ---
      // Applies only when the entry is NOT contract-covered (contracts always
      // win), so it never fires for the bucket path above — the two are
      // mutually exclusive by construction. Block burn is best-effort on save:
      // a failure is logged, never aborts the entry save, and the nightly
      // reconcile converges allocations to the canonical FIFO state.
      // The reverse-on-update runs UNCONDITIONALLY (before any eligibility
      // check): an entry edited to be contract-covered, non-billable, or
      // serviceless must still give its minutes back to the blocks immediately
      // — otherwise the client loses block minutes AND pays the contract/
      // hourly rate until the nightly reconcile catches up.
      try {
        const savedEntryId = resultingEntry?.entry_id;
        if (entry_id && savedEntryId) {
          // Update: reverse then re-allocate (clean FIFO, no delta).
          await reverseTimeEntryAllocations(trx, tenant, savedEntryId);
        }
        if (resultingEntry && resultingEntry.service_id && (resultingEntry.billable_duration || 0) > 0) {
          let blockClientId: string | null = null;
          if (resultingEntry.work_item_id && resultingEntry.work_item_type) {
            blockClientId = await getClientIdForWorkItem(
              trx,
              tenant,
              resultingEntry.work_item_id as string,
              resultingEntry.work_item_type as string,
            );
          }
          if (blockClientId && !resultingEntry.contract_line_id) {
            const burnEntry = {
              entry_id: savedEntryId!,
              service_id: resultingEntry.service_id,
              billable_duration: resultingEntry.billable_duration,
              contract_line_id: resultingEntry.contract_line_id,
              work_item_id: resultingEntry.work_item_id,
              work_item_type: resultingEntry.work_item_type,
              work_date: resultingEntry.work_date,
              start_time: resultingEntry.start_time,
            };
            const burned = await allocateTimeEntry(trx, tenant, blockClientId, burnEntry);
            if (burned.length > 0) {
              console.log(`Time entry ${savedEntryId} burned ${burned.reduce((sum, a) => sum + a.minutes, 0)} block minutes.`);
            }
          }
        }
      } catch (blockBurnError) {
        console.error(`Error applying hour-block burn for time entry ${resultingEntry?.entry_id}:`, blockBurnError);
      }
      // --- End Hour-block burn logic ---
    });

    if (!resultingEntry) {
      throw new Error('Time entry save completed without creating or updating a row.');
    }

    // Ensure resultingEntry is treated as ITimeEntry
    const entry = resultingEntry as ITimeEntry;
    if (!entry.entry_id) {
      throw new Error('Time entry save returned a row without an entry ID.');
    }

    await publishTimeEntrySearchEvent(entry_id ? 'TIME_ENTRY_UPDATED' : 'TIME_ENTRY_CREATED', {
      tenantId: tenant,
      timeEntryId: entry.entry_id,
      userId: entry.user_id,
      workItemId: entry.work_item_id,
      workItemType: entry.work_item_type,
      changes: entry_id ? validatedTimeEntry : undefined,
    });

    // Fetch work item details based on the saved entry
    let workItemDetails: IWorkItem;
    switch (entry.work_item_type) {
      case 'project_task': {
        const taskQuery = tenantScopedDb.table('project_tasks')
          .where({
            task_id: entry.work_item_id
          });
        tenantScopedDb.tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
        tenantScopedDb.tenantJoin(taskQuery, 'projects', 'project_phases.project_id', 'projects.project_id');
        const [task] = await taskQuery
          .select(
            'task_id as work_item_id',
            'task_name as name',
            'project_tasks.description',
            'projects.project_name as project_name',
            'project_phases.phase_name as phase_name'
          );
        workItemDetails = {
          ...task,
          type: 'project_task',
          is_billable: entry.billable_duration > 0,
          project_name: task.project_name,
          phase_name: task.phase_name
        };
        break;
      }
      case 'ad_hoc': {
        const schedule = await tenantScopedDb.table('schedule_entries')
          .where({
            entry_id: entry.work_item_id
          })
          .first();
        workItemDetails = {
          work_item_id: entry.work_item_id,
          name: schedule?.title || 'Ad Hoc Entry',
          description: '',
          type: 'ad_hoc',
          is_billable: entry.billable_duration > 0
        };
        break;
      }
      case 'ticket': {
        const [ticket] = await tenantScopedDb.table('tickets')
          .where({
            ticket_id: entry.work_item_id
          })
          .select(
            'ticket_id as work_item_id',
            'title as name',
            'url as description',
            'ticket_number'
          );
        workItemDetails = {
          ...ticket,
          type: 'ticket',
          is_billable: entry.billable_duration > 0,
          ticket_number: ticket.ticket_number
        };
        break;
      }
      case 'non_billable_category':
        workItemDetails = {
          work_item_id: entry.work_item_id,
          name: entry.work_item_id,
          description: '',
          type: 'non_billable_category',
          is_billable: false
        };
        break;
      case 'interaction': {
        const interactionQuery = tenantScopedDb.table('interactions')
          .where({
            'interactions.interaction_id': entry.work_item_id
          });
        tenantScopedDb.tenantJoin(interactionQuery, 'clients', 'interactions.client_id', 'clients.client_id', { type: 'left' });
        tenantScopedDb.tenantJoin(interactionQuery, 'contacts', 'interactions.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
        tenantScopedDb.tenantJoin(interactionQuery, 'interaction_types', 'interactions.type_id', 'interaction_types.type_id', { type: 'left' });
        const [interaction] = await interactionQuery
          .select(
            'interactions.interaction_id as work_item_id',
            'interactions.title as name',
            db.raw("'' as description"), // Don't copy interaction notes to time entry
            'clients.client_name',
            'contacts.full_name as contact_name',
            'interaction_types.type_name as interaction_type'
          );
        workItemDetails = {
          ...interaction,
          type: 'interaction',
          is_billable: entry.billable_duration > 0,
          client_name: interaction.client_name,
          contact_name: interaction.contact_name,
          interaction_type: interaction.interaction_type
        };
        break;
      }
      default:
        throw new Error(`Unknown work item type: ${entry.work_item_type}`);
    }

    // Track time entry analytics
    const isUpdate = !!entry_id;
    captureAnalytics(isUpdate ? 'time_entry_updated' : 'time_entry_created', {
      work_item_type: entry.work_item_type,
      duration_minutes: finalBillableDuration,
      is_billable: finalBillableDuration > 0,
      has_notes: !!notes,
      has_service: !!service_id,
      has_tax_region: !!tax_region,
      has_contract_line: !!contract_line_id,
      approval_status: approval_status || 'pending',
      // Track if this was a duration adjustment
      duration_changed: isUpdate ? (entry.billable_duration !== finalBillableDuration) : false,
      duration_delta: isUpdate ? (finalBillableDuration - entry.billable_duration) : finalBillableDuration,
    }, user.user_id);

    // Return the complete time entry with work item details
    // Format work_date properly (DATE column comes back as Date object)
    const result: ITimeEntryWithWorkItem = {
      ...entry,
      work_date: (entry.work_date as unknown) instanceof Date
        ? (entry.work_date as unknown as Date).toISOString().slice(0, 10)
        : (typeof entry.work_date === 'string' ? entry.work_date.slice(0, 10) : undefined),
      workItem: workItemDetails
    };
    return result;

  } catch (error) {
    console.error('Error saving time entry:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const updateTimeEntryApprovalStatus = withAuth(async (
  user,
  { tenant },
  params: {
    entryId: string;
    approvalStatus: ITimeEntry['approval_status'];
    changeRequestComment?: string;
  }
): Promise<void | TimeSheetActionError> => {
  const { knex: db } = await createTenantKnex();
  const tenantScopedDb = tenantDb(db, tenant) as any;

  try {
    if (!await hasPermission(user, 'timesheet', 'approve', db)) {
      throw new Error('Permission denied: Cannot update time entry approval status');
    }

    const validatedParams = validateData<UpdateTimeEntryApprovalStatusParams>(
      updateTimeEntryApprovalStatusParamsSchema,
      params,
    );

    const existingEntry = await tenantScopedDb.table('time_entries')
      .where({
        entry_id: validatedParams.entryId,
      })
      .select('entry_id', 'user_id', 'invoiced', 'time_sheet_id', 'work_item_id', 'work_item_type')
      .first();

    if (!existingEntry) {
      throw new Error('Time entry not found');
    }

    if (validatedParams.approvalStatus === 'APPROVED') {
      await assertCanApproveSubject(user, tenant, existingEntry.user_id, db);
    } else {
      await assertCanActOnBehalf(user, tenant, existingEntry.user_id, db);
    }

    if (existingEntry.invoiced) {
      throw new Error('This time entry has already been invoiced and cannot be modified.');
    }

    await db.transaction(async (trx) => {
      const trxTenantDb = tenantDb(trx, tenant) as any;

      await trxTenantDb.table('time_entries')
        .where({
          entry_id: validatedParams.entryId,
        })
        .update({
          approval_status: validatedParams.approvalStatus,
          updated_at: new Date(),
          updated_by: user.user_id,
        });

      if (
        validatedParams.approvalStatus === 'CHANGES_REQUESTED' &&
        existingEntry.time_sheet_id
      ) {
        await trxTenantDb.table('time_sheets')
          .where({
            id: existingEntry.time_sheet_id,
          })
          .update({
            approval_status: 'CHANGES_REQUESTED',
            approved_at: null,
            approved_by: null,
          });
      }

      if (
        validatedParams.approvalStatus === 'CHANGES_REQUESTED' &&
        validatedParams.changeRequestComment &&
        existingEntry.time_sheet_id
      ) {
        await createTimeEntryChangeRequestRecord(trx, {
          tenant,
          timeEntryId: validatedParams.entryId,
          timeSheetId: existingEntry.time_sheet_id,
          comment: validatedParams.changeRequestComment,
          createdBy: user.user_id,
        });
      }
    });

    const eventType =
      validatedParams.approvalStatus === 'APPROVED'
        ? 'TIME_ENTRY_APPROVED'
        : validatedParams.approvalStatus === 'CHANGES_REQUESTED'
          ? 'TIME_ENTRY_CHANGES_REQUESTED'
          : validatedParams.approvalStatus === 'SUBMITTED'
            ? 'TIME_ENTRY_SUBMITTED'
            : 'TIME_ENTRY_UPDATED';

    await publishTimeEntrySearchEvent(eventType, {
      tenantId: tenant,
      timeEntryId: validatedParams.entryId,
      userId: existingEntry.user_id,
      workItemId: existingEntry.work_item_id,
      workItemType: existingEntry.work_item_type,
      approvedBy: validatedParams.approvalStatus === 'APPROVED' ? user.user_id : undefined,
      requestedBy: validatedParams.approvalStatus === 'CHANGES_REQUESTED' ? user.user_id : undefined,
      reason: validatedParams.changeRequestComment,
      changes: {
        approvalStatus: validatedParams.approvalStatus,
      },
    });
  } catch (error) {
    console.error('Error updating time entry approval status:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const deleteTimeEntry = withAuth(async (
  user,
  { tenant },
  entryId: string
): Promise<void | TimeSheetActionError> => {
  const {knex: db} = await createTenantKnex();

  try {
  // Check permission for time entry deletion
  if (!await hasPermission(user, 'timeentry', 'delete', db)) {
    throw new Error('Permission denied: Cannot delete time entries');
  }

    const deletedTimeEntry = await db.transaction(async (trx) => {
      const trxTenantDb = tenantDb(trx, tenant) as any;
      // Get the time entry to be deleted
      const timeEntry = await trxTenantDb.table('time_entries')
        .where({
          entry_id: entryId
        })
        .first();

      if (!timeEntry) {
        throw new Error('Time entry not found');
      }

      await assertCanActOnBehalf(user, tenant, timeEntry.user_id, trx);

      if (timeEntry.invoiced) {
        throw new Error('This time entry has already been invoiced and cannot be deleted.');
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
      // effort like the save path: failures are logged and the nightly
      // reconcile converges. Runs unconditionally (an entry may carry block
      // allocations without being contract-covered).
      try {
        await reverseTimeEntryAllocations(trx, tenant, entryId);
      } catch (blockReverseError) {
        console.error(`Error reversing hour-block burn for deleted time entry ${entryId}:`, blockReverseError);
      }
      // --- End Hour-block burn reversal ---

      // 2. Delete the time entry
      const deleteCount = await trxTenantDb.table('time_entries')
        .where({ entry_id: entryId })
        .delete();

      if (deleteCount === 0) {
         // This shouldn't happen if the initial fetch succeeded, but handle defensively
         console.warn(`Attempted to delete time entry ${entryId}, but it was not found (possibly deleted concurrently).`);
      } else {
         console.log(`Successfully deleted time entry ${entryId}`);
         
         // Track time entry deletion analytics
         captureAnalytics('time_entry_deleted', {
           work_item_type: timeEntry.work_item_type,
           duration_minutes: timeEntry.billable_duration || 0,
           was_billable: (timeEntry.billable_duration || 0) > 0,
           had_notes: !!timeEntry.notes,
           approval_status: timeEntry.approval_status || 'pending',
           age_in_days: timeEntry.created_at ? 
             Math.round((Date.now() - new Date(timeEntry.created_at).getTime()) / 1000 / 60 / 60 / 24) : 0,
         }, user.user_id);
      }

      await recalculateProjectTaskActualHoursForEntryChange(trx, tenant, timeEntry, null);

      return timeEntry as ITimeEntry;
    });

    if (!deletedTimeEntry.entry_id) {
      throw new Error('Time entry delete returned a row without an entry ID.');
    }

    await publishTimeEntrySearchEvent('TIME_ENTRY_DELETED', {
      tenantId: tenant,
      timeEntryId: deletedTimeEntry.entry_id,
      userId: deletedTimeEntry.user_id,
      workItemId: deletedTimeEntry.work_item_id,
      workItemType: deletedTimeEntry.work_item_type,
    });
  } catch (error) {
    console.error('Error deleting time entry:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Fetches a single time entry by its ID, including work item details.
 * @param entryId The ID of the time entry.
 * @returns The time entry with work item details, or null if not found.
 */
export const getTimeEntryById = withAuth(async (
  user,
  { tenant },
  entryId: string
): Promise<ITimeEntryWithWorkItem | null | TimeSheetActionError> => {
  const { knex: db } = await createTenantKnex();
  const tenantScopedDb = tenantDb(db, tenant) as any;

  try {
  // Check permission for time entry reading
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read time entries');
  }

      const entry = await tenantScopedDb.table('time_entries')
        .where({ entry_id: entryId })
        .first();

      if (!entry) {
        return null;
      }

      await assertCanActOnBehalf(user, tenant, entry.user_id, db);

      // Fetch work item details based on the saved entry
      let workItemDetails: IWorkItem;
      switch (entry.work_item_type) {
        case 'project_task': {
          const taskQuery = tenantScopedDb.table('project_tasks')
            .where({
              task_id: entry.work_item_id
            });
          tenantScopedDb.tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
          tenantScopedDb.tenantJoin(taskQuery, 'projects', 'project_phases.project_id', 'projects.project_id');
          const [task] = await taskQuery
            .select(
              'task_id as work_item_id',
              'task_name as name',
              'project_tasks.description',
              'projects.project_name as project_name',
              'project_phases.phase_name as phase_name'
            );
          workItemDetails = {
            ...task,
            type: 'project_task',
            is_billable: entry.billable_duration > 0,
            project_name: task.project_name,
            phase_name: task.phase_name
          };
          break;
        }
        case 'ad_hoc': {
          const schedule = await tenantScopedDb.table('schedule_entries')
            .where({
              entry_id: entry.work_item_id
            })
            .first();
          workItemDetails = {
            work_item_id: entry.work_item_id,
            name: schedule?.title || 'Ad Hoc Entry',
            description: '',
            type: 'ad_hoc',
            is_billable: entry.billable_duration > 0
          };
          break;
        }
        case 'ticket': {
          const [ticket] = await tenantScopedDb.table('tickets')
            .where({
              ticket_id: entry.work_item_id
            })
            .select(
              'ticket_id as work_item_id',
              'title as name',
              'url as description',
              'ticket_number'
            );
          workItemDetails = {
            ...ticket,
            type: 'ticket',
            is_billable: entry.billable_duration > 0,
            ticket_number: ticket.ticket_number
          };
          break;
        }
        case 'non_billable_category':
          workItemDetails = {
            work_item_id: entry.work_item_id,
            name: entry.work_item_id,
            description: '',
            type: 'non_billable_category',
            is_billable: false
          };
          break;
        case 'interaction': {
          const interactionQuery = tenantScopedDb.table('interactions')
            .where({
              'interactions.interaction_id': entry.work_item_id
            });
          tenantScopedDb.tenantJoin(interactionQuery, 'clients', 'interactions.client_id', 'clients.client_id', { type: 'left' });
          tenantScopedDb.tenantJoin(interactionQuery, 'contacts', 'interactions.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
          tenantScopedDb.tenantJoin(interactionQuery, 'interaction_types', 'interactions.type_id', 'interaction_types.type_id', { type: 'left' });
          const [interaction] = await interactionQuery
            .select(
              'interactions.interaction_id as work_item_id',
              'interactions.title as name',
              db.raw("'' as description"), // Don't copy interaction notes to time entry
              'clients.client_name',
              'contacts.full_name as contact_name',
              'interaction_types.type_name as interaction_type'
            );
          workItemDetails = {
            ...interaction,
            type: 'interaction',
            is_billable: entry.billable_duration > 0,
            client_name: interaction.client_name,
            contact_name: interaction.contact_name,
            interaction_type: interaction.interaction_type
          };
          break;
        }
        default:
          throw new Error(`Unknown work item type: ${entry.work_item_type}`);
      }

      // Return the complete time entry with work item details.
      // Knex returns timestamps as Date objects; downstream callers (TimeEntryProvider)
      // expect ISO strings and pass them to date-fns parseISO, which requires strings.
      const result: ITimeEntryWithWorkItem = {
        ...entry,
        start_time: formatISO(entry.start_time),
        end_time: formatISO(entry.end_time),
        created_at: formatISO(entry.created_at),
        updated_at: formatISO(entry.updated_at),
        work_date: (entry.work_date as unknown) instanceof Date
          ? (entry.work_date as unknown as Date).toISOString().slice(0, 10)
          : (typeof entry.work_date === 'string' ? entry.work_date.slice(0, 10) : undefined),
        workItem: workItemDetails
      };
      return result;

  } catch (error) {
    console.error(`Error fetching time entry by ID ${entryId}:`, error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
