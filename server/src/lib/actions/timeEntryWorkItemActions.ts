'use server'

import { Knex } from 'knex'; // Import Knex type
import { createTenantKnex } from 'server/src/lib/db';
import { IWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import { validateData } from 'server/src/lib/utils/validation';
import {
  fetchTimeEntriesParamsSchema, // Re-use for fetching work items based on time sheet
  FetchTimeEntriesParams,
  addWorkItemParamsSchema,
  AddWorkItemParams
} from './timeEntrySchemas'; // Import schemas

export async function fetchWorkItemsForTimeSheet(timeSheetId: string): Promise<IWorkItem[]> {
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
    .where({ 'project_tasks.tenant': tenant })
    .select(
      'task_id as work_item_id',
      'task_name as name',
      'project_tasks.description',
      'projects.project_name as project_name',
      'project_phases.phase_name as phase_name',
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

  return [...tickets, ...projectTasks, ...adHocEntries].map((item): IWorkItem => ({
    ...item,
    is_billable: item.type !== 'non_billable_category',
    ticket_number: item.type === 'ticket' ? item.ticket_number : undefined
  }));
}

export async function addWorkItem(workItem: Omit<IWorkItem, 'tenant'>): Promise<IWorkItem> {
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
  const {knex: db, tenant} = await createTenantKnex();
  const session = await getServerSession(options);
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