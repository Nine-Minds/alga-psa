'use server'

import { Knex } from 'knex'; // Import Knex type
import { createTenantKnex } from '@alga-psa/db';
import { IWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { hasPermission } from '@alga-psa/auth/rbac';
import { validateData } from '@alga-psa/validation';
import {
  fetchTimeEntriesParamsSchema, // Re-use for fetching work items based on time sheet
  FetchTimeEntriesParams,
  addWorkItemParamsSchema,
  AddWorkItemParams
} from './timeEntrySchemas'; // Import schemas
import { getSession } from 'server/src/lib/auth/getSession';

export async function fetchWorkItemsForTimeSheet(timeSheetId: string): Promise<IWorkItem[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for time entry reading (reading work items for time entries)
  if (!await hasPermission(currentUser, 'timeentry', 'read')) {
    throw new Error('Permission denied: Cannot read time entry work items');
  }

  // Validate input
  const validatedParams = validateData<FetchTimeEntriesParams>(fetchTimeEntriesParamsSchema, { timeSheetId });

  const {knex: db, tenant} = await createTenantKnex();

  // Get tickets
  const tickets = await db('tickets')
    .whereIn('ticket_id', function () {
      this.select('work_item_id')
        .from('time_entries')
        .where({
          'time_entries.work_item_type': 'ticket',
          'time_entries.time_sheet_id': validatedParams.timeSheetId,
          'time_entries.tenant': tenant
        });
    })
    .where('tickets.tenant', tenant)
    .select(
      'ticket_id as work_item_id',
      'title as name',
      'url as description',
      'ticket_number',
      db.raw("'ticket' as type")
    );

  // Get project tasks
  const projectTasks = await db('project_tasks')
    .whereIn('task_id', function () {
      this.select('work_item_id')
        .from('time_entries')
        .where({
          'time_entries.work_item_type': 'project_task',
          'time_entries.time_sheet_id': validatedParams.timeSheetId,
          'time_entries.tenant': tenant
        });
    })
    .join('project_phases', function() {
      this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
          .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
    })
    .join('projects', function() {
      this.on('project_phases.project_id', '=', 'projects.project_id')
          .andOn('project_phases.tenant', '=', 'projects.tenant');
    })
    .leftJoin('service_catalog', function() {
      this.on('project_tasks.service_id', '=', 'service_catalog.service_id')
          .andOn('project_tasks.tenant', '=', 'service_catalog.tenant');
    })
    .where({ 'project_tasks.tenant': tenant })
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
  const adHocEntries = await db('schedule_entries')
    .whereIn('entry_id', function () {
      this.select('work_item_id')
        .from('time_entries')
        .where({
          'time_entries.work_item_type': 'ad_hoc',
          'time_entries.time_sheet_id': validatedParams.timeSheetId,
          'time_entries.tenant': tenant
        });
    })
    .where('schedule_entries.tenant', tenant)
    .select(
      'entry_id as work_item_id',
      'title as name',
      db.raw("'' as description"),
      db.raw("'ad_hoc' as type")
    );

  // Get interactions
  const interactions = await db('interactions')
    .whereIn('interaction_id', function () {
      this.select('work_item_id')
        .from('time_entries')
        .where({
          'time_entries.work_item_type': 'interaction',
          'time_entries.time_sheet_id': validatedParams.timeSheetId,
          'time_entries.tenant': tenant
        });
    })
    .leftJoin('clients', function() {
      this.on('interactions.client_id', '=', 'clients.client_id')
        .andOn('clients.tenant', '=', 'interactions.tenant');
    })
    .leftJoin('contacts', function() {
      this.on('interactions.contact_name_id', '=', 'contacts.contact_name_id')
        .andOn('contacts.tenant', '=', 'interactions.tenant');
    })
    .leftJoin('interaction_types', function() {
      this.on('interactions.type_id', '=', 'interaction_types.type_id')
        .andOn('interaction_types.tenant', '=', 'interactions.tenant');
    })
    .where('interactions.tenant', tenant)
    .select(
      'interactions.interaction_id as work_item_id',
      'interactions.title as name',
      db.raw("'' as description"), // Don't copy interaction notes to time entry
      'clients.client_name',
      'contacts.full_name as contact_name',
      'interaction_types.type_name as interaction_type',
      db.raw("'interaction' as type")
    );

  return [...tickets, ...projectTasks, ...adHocEntries, ...interactions].map((item): IWorkItem => ({
    ...item,
    is_billable: item.type !== 'non_billable_category',
    ticket_number: item.type === 'ticket' ? item.ticket_number : undefined
  }));
}

export async function addWorkItem(workItem: Omit<IWorkItem, 'tenant'>): Promise<IWorkItem> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for time entry creation (adding work items for time entries)
  if (!await hasPermission(currentUser, 'timeentry', 'create')) {
    throw new Error('Permission denied: Cannot add work items for time entries');
  }

  // Validate input
  const validatedWorkItem = validateData<AddWorkItemParams>(addWorkItemParamsSchema, workItem);

  const {knex: db, tenant} = await createTenantKnex();

  // Note: This function seems to insert into 'service_catalog', which might be incorrect
  // based on the function name 'addWorkItem'. Review if this logic is correct.
  // Assuming it's meant to add a generic work item representation somewhere or
  // perhaps this function is misnamed/misplaced.
  // For now, keeping the original logic but adding a comment.
  const [newWorkItem] = await db('service_catalog') // <-- Review this table name
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
}


export async function deleteWorkItem(workItemId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for time entry deletion (deleting work items affects time entries)
  if (!await hasPermission(currentUser, 'timeentry', 'delete')) {
    throw new Error('Permission denied: Cannot delete work items for time entries');
  }

  const {knex: db, tenant} = await createTenantKnex();
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("User not authenticated");
  }

  try {
    await db.transaction(async (trx) => {
      // First delete all time entries associated with this work item
      // Note: This only deletes time entries. It doesn't delete the work item itself
      // (e.g., the ticket or project task). Consider if the work item itself should be deleted.
      await trx('time_entries')
        .where({
          work_item_id: workItemId,
          tenant
        })
        .delete();
        console.log(`Deleted time entries associated with work item ${workItemId}`);
    });
  } catch (error) {
    console.error('Error deleting work item (associated time entries):', error);
    throw new Error('Failed to delete work item (associated time entries)');
  }
}
