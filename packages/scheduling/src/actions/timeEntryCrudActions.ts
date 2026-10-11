'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
// Bucket usage MUST go through the shared canonical service. This package used
// to carry a local fork (src/services/bucketUsageService.ts) that kept querying
// the dropped `client_contract_lines` table and caused a prod outage on
// time-entry save. Don't recreate a local copy.
import { adjustTimeSpanDraw } from '@alga-psa/shared/billingClients/drawAdjustments';
import { isBucketUsageError } from '@alga-psa/shared/billingClients/bucketUsageErrors';
// Hour-block burn MUST go through the shared canonical service too — same
// rationale as bucketUsageService (both scheduling and billing import it).
import {
  reverseTimeEntryAllocations,
} from '@alga-psa/shared/billingClients/hourBlockService';
import {
  ITimeEntry,
  ITimeEntryWithWorkItem,
} from '@alga-psa/types';
import { IWorkItem } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
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
import { assertCanActOnBehalf, assertCanApproveSubject } from './timeEntryDelegationAuth';
import {
  createTimeEntryChangeRequestRecord,
  fetchTimeEntryChangeRequestsForEntryIdsFromDb,
} from './timeEntryChangeRequestActions';
import { persistTimeEntry, publishPersistedTimeEntryEvents } from '../lib/timeEntryWriteCore';
import { logSession } from '../lib/stopwatch/stopwatchCore';
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
  if (!await hasPermission(user, 'time_entry', 'read', db)) {
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
  timeEntry: Omit<ITimeEntry, 'tenant'> & { stopwatch_session_id?: string | null }
): Promise<ITimeEntryWithWorkItem | TimeSheetActionError> => {
  const {knex: db} = await createTenantKnex();
  const tenantScopedDb = tenantDb(db, tenant) as any;

  try {
  // Check permission based on whether this is a create or update operation
  if (timeEntry.entry_id) {
    // Update operation
    if (!await hasPermission(user, 'time_entry', 'update', db)) {
      throw new Error('Permission denied: Cannot update time entries');
    }
  } else {
    // Create operation
    if (!await hasPermission(user, 'time_entry', 'create', db)) {
      throw new Error('Permission denied: Cannot create time entries');
    }
  }

  // Validate input
  const validatedTimeEntry = validateData<SaveTimeEntryParams>(saveTimeEntryParamsSchema, timeEntry);

  if (!validatedTimeEntry.service_id?.trim()) {
    throw new Error('Service is required for time entries');
  }

    // Everything from ownership checks to bucket/hour-block draws lives in the
    // shared write core (D6); it runs inside this action-owned transaction.
    // With a stopwatch session the entry and the session close together (logSession semantics):
    // the drawer's values win over the session-derived ones, the session must be the acting
    // user's own open session, and any failure rolls back both.
    const stopwatchSessionId = validatedTimeEntry.stopwatch_session_id;
    if (stopwatchSessionId && validatedTimeEntry.entry_id) {
      throw new Error('Validation failed: a stopwatch session can only be logged as a new time entry');
    }
    const persisted = await db.transaction(async (trx) => {
      if (!stopwatchSessionId) {
        return persistTimeEntry(trx, { tenant, actor: user, entry: validatedTimeEntry });
      }
      const logged = await logSession(trx, tenant, user, stopwatchSessionId, {
        work_item_id: validatedTimeEntry.work_item_id,
        work_item_type: validatedTimeEntry.work_item_type,
        start_time: validatedTimeEntry.start_time,
        end_time: validatedTimeEntry.end_time,
        billable_duration: validatedTimeEntry.billable_duration,
        notes: validatedTimeEntry.notes,
        service_id: validatedTimeEntry.service_id,
        contract_line_id: validatedTimeEntry.contract_line_id,
        tax_region: validatedTimeEntry.tax_region,
        tax_rate_id: validatedTimeEntry.tax_rate_id,
        time_sheet_id: validatedTimeEntry.time_sheet_id,
        user_id: validatedTimeEntry.user_id,
      });
      return logged.persisted;
    });

    // Post-commit: publish only after the transaction above has committed.
    await publishPersistedTimeEntryEvents(persisted);

    const entry = persisted.entry;
    const entry_id = validatedTimeEntry.entry_id;
    const { notes, service_id, tax_region, contract_line_id, approval_status } = validatedTimeEntry;
    const finalBillableDuration = persisted.finalBillableDuration;

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
    if (!await hasPermission(user, 'time_sheet', 'approve', db)) {
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
  if (!await hasPermission(user, 'time_entry', 'delete', db)) {
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
  if (!await hasPermission(user, 'time_entry', 'read', db)) {
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
