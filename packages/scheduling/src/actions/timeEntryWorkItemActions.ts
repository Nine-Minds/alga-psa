'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { IWorkItem, IExtendedWorkItem } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { validateData } from '@alga-psa/validation';
import { assertCanActOnBehalf } from './timeEntryDelegationAuth';
import {
  fetchTimeEntriesParamsSchema, // Re-use for fetching work items based on time sheet
  FetchTimeEntriesParams,
  addWorkItemParamsSchema,
  AddWorkItemParams
} from './timeEntrySchemas'; // Import schemas

const NON_BILLABLE_FALLBACK_WORK_ITEM_ID = '__non_billable__';

function normalizeNonBillableWorkItemId(workItemId: string | null | undefined): string {
  return workItemId || NON_BILLABLE_FALLBACK_WORK_ITEM_ID;
}

export const fetchWorkItemsForTimeSheet = withAuth(async (
  user,
  { tenant },
  timeSheetId: string
): Promise<IExtendedWorkItem[]> => {
  const {knex: db} = await createTenantKnex();
  const scopedDb = tenantDb(db, tenant) as any;

  // Check permission for time entry reading (reading work items for time entries)
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read time entry work items');
  }

  // Validate input
  const validatedParams = validateData<FetchTimeEntriesParams>(fetchTimeEntriesParamsSchema, { timeSheetId });

  const timeSheet = await scopedDb.table('time_sheets')
    .where({ id: validatedParams.timeSheetId, tenant })
    .select('user_id')
    .first();

  if (!timeSheet) {
    throw new Error(`Time sheet with id ${validatedParams.timeSheetId} not found`);
  }

  await assertCanActOnBehalf(user, tenant, timeSheet.user_id, db);

  // Get tickets
  const ticketsQuery = scopedDb.table('tickets')
    .whereIn(
      'tickets.ticket_id',
      scopedDb.table('time_entries')
        .select('work_item_id')
        .where({
          'time_entries.work_item_type': 'ticket',
          'time_entries.time_sheet_id': validatedParams.timeSheetId
        })
    );
  scopedDb.tenantJoin(ticketsQuery, 'tickets as mt', 'tickets.master_ticket_id', 'mt.ticket_id', { type: 'left' });
  const tickets = await ticketsQuery
    .select(
      'tickets.ticket_id as work_item_id',
      'tickets.title as name',
      'tickets.url as description',
      'tickets.ticket_number',
      'tickets.master_ticket_id',
      'mt.ticket_number as master_ticket_number',
      db.raw("'ticket' as type")
    );

  // Get project tasks
  const projectTasksQuery = scopedDb.table('project_tasks')
    .whereIn(
      'task_id',
      scopedDb.table('time_entries')
        .select('work_item_id')
        .where({
          'time_entries.work_item_type': 'project_task',
          'time_entries.time_sheet_id': validatedParams.timeSheetId
        })
    );
  scopedDb.tenantJoin(projectTasksQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
  scopedDb.tenantJoin(projectTasksQuery, 'projects', 'project_phases.project_id', 'projects.project_id');
  scopedDb.tenantJoin(projectTasksQuery, 'service_catalog', 'project_tasks.service_id', 'service_catalog.service_id', { type: 'left' });
  const projectTasks = await projectTasksQuery
    .select(
      'task_id as work_item_id',
      'task_name as name',
      'project_tasks.description',
      'projects.project_name as project_name',
      'project_phases.phase_name as phase_name',
      'project_tasks.service_id',
      'service_catalog.service_name',
      db.raw("'project_task' as type")
    );

  // Get ad-hoc entries
  const adHocEntries = await scopedDb.table('schedule_entries')
    .whereIn(
      'entry_id',
      scopedDb.table('time_entries')
        .select('work_item_id')
        .where({
          'time_entries.work_item_type': 'ad_hoc',
          'time_entries.time_sheet_id': validatedParams.timeSheetId
        })
    )
    .select(
      'entry_id as work_item_id',
      'title as name',
      db.raw("'' as description"),
      db.raw("'ad_hoc' as type")
    );

  // Get interactions
  const interactionsQuery = scopedDb.table('interactions')
    .whereIn(
      'interaction_id',
      scopedDb.table('time_entries')
        .select('work_item_id')
        .where({
          'time_entries.work_item_type': 'interaction',
          'time_entries.time_sheet_id': validatedParams.timeSheetId
        })
    );
  scopedDb.tenantJoin(interactionsQuery, 'clients', 'interactions.client_id', 'clients.client_id', { type: 'left' });
  scopedDb.tenantJoin(interactionsQuery, 'contacts', 'interactions.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
  scopedDb.tenantJoin(interactionsQuery, 'interaction_types', 'interactions.type_id', 'interaction_types.type_id', { type: 'left' });
  const interactions = await interactionsQuery
    .select(
      'interactions.interaction_id as work_item_id',
      'interactions.title as name',
      db.raw("'' as description"), // Don't copy interaction notes to time entry
      'clients.client_name',
      'contacts.full_name as contact_name',
      'interaction_types.type_name as interaction_type',
      db.raw("'interaction' as type")
    );

  const nonBillableEntries = await scopedDb.table('time_entries')
    .where({
      'time_entries.work_item_type': 'non_billable_category',
      'time_entries.time_sheet_id': validatedParams.timeSheetId
    })
    .select('work_item_id', 'notes');

  const nonBillableWorkItems = Array.from(
    nonBillableEntries.reduce((map: Map<string, Pick<IWorkItem, 'work_item_id' | 'name' | 'description' | 'type'>>, entry: any) => {
      const workItemId = normalizeNonBillableWorkItemId(entry.work_item_id);

      if (!map.has(workItemId)) {
        map.set(workItemId, {
          work_item_id: workItemId,
          name: entry.notes?.trim() || 'Non-billable',
          description: '',
          type: 'non_billable_category'
        });
      }

      return map;
    }, new Map<string, Pick<IWorkItem, 'work_item_id' | 'name' | 'description' | 'type'>>()).values()
  );

  return [...tickets, ...projectTasks, ...adHocEntries, ...interactions, ...nonBillableWorkItems].map((item): IExtendedWorkItem => ({
    ...item,
    is_billable: item.type !== 'non_billable_category',
    ticket_number: item.type === 'ticket' ? item.ticket_number : undefined
  }));
});

export const addWorkItem = withAuth(async (
  user,
  { tenant },
  workItem: Omit<IWorkItem, 'tenant'>
): Promise<IWorkItem> => {
  const {knex: db} = await createTenantKnex();
  const scopedDb = tenantDb(db, tenant) as any;

  // Check permission for time entry creation (adding work items for time entries)
  if (!await hasPermission(user, 'timeentry', 'create', db)) {
    throw new Error('Permission denied: Cannot add work items for time entries');
  }

  // Validate input
  const validatedWorkItem = validateData<AddWorkItemParams>(addWorkItemParamsSchema, workItem);

  // Note: This function seems to insert into 'service_catalog', which might be incorrect
  // based on the function name 'addWorkItem'. Review if this logic is correct.
  // Assuming it's meant to add a generic work item representation somewhere or
  // perhaps this function is misnamed/misplaced.
  // For now, keeping the original logic but adding a comment.
  const [newWorkItem] = await scopedDb.table('service_catalog') // <-- Review this table name
    .insert({
      service_id: validatedWorkItem.work_item_id, // Using work_item_id as service_id
      service_name: validatedWorkItem.name,
      description: validatedWorkItem.description,
      service_type: validatedWorkItem.type, // Using type as service_type
      default_rate: validatedWorkItem.is_billable ? 0 : null, // Assuming 0 rate for billable?
      tenant
    })
    .returning(['service_id as work_item_id', 'service_name as name', 'description', 'service_type as type']);

  return {
    ...newWorkItem,
    is_billable: newWorkItem.type !== 'non_billable_category', // Inferring billable status
  };
});


export const deleteWorkItem = withAuth(async (
  user,
  { tenant },
  workItemId: string
): Promise<void> => {
  const {knex: db} = await createTenantKnex();

  // Check permission for time entry deletion (deleting work items affects time entries)
  if (!await hasPermission(user, 'timeentry', 'delete', db)) {
    throw new Error('Permission denied: Cannot delete work items for time entries');
  }

  try {
    await db.transaction(async (trx) => {
      const scopedDb = tenantDb(trx, tenant) as any;
      // First delete all time entries associated with this work item
      // Note: This only deletes time entries. It doesn't delete the work item itself
      // (e.g., the ticket or project task). Consider if the work item itself should be deleted.
      await scopedDb.table('time_entries')
        .where({
          work_item_id: workItemId
        })
        .delete();
        console.log(`Deleted time entries associated with work item ${workItemId}`);
    });
  } catch (error) {
    console.error('Error deleting work item (associated time entries):', error);
    throw new Error('Failed to delete work item (associated time entries)');
  }
});
