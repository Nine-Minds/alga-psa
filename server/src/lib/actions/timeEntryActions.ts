'use server'

import { createTenantKnex } from '@/lib/db';
import { 
  ITimeEntry, 
  ITimePeriod, 
  ITimeEntryWithWorkItem, 
  ITimeSheet, 
  ITimeSheetView,
  ITimePeriodWithStatus,
  ITimePeriodView,
  ITimePeriodWithStatusView,
  TimeSheetStatus 
} from '@/interfaces/timeEntry.interfaces';
import { IWorkItem } from '@/interfaces/workItem.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "@/app/api/auth/[...nextauth]/options";
import { TaxRegion } from '@/types/types.d';
import { v4 as uuidv4 } from 'uuid';
import { formatISO } from 'date-fns';
import { toPlainDate } from '@/lib/utils/dateTimeUtils';
import { validateData } from '@/lib/utils/validation';
import { z } from 'zod';
import { timeEntrySchema } from '@/lib/schemas/timeSheet.schemas';

// Parameter schemas
const fetchTimeEntriesParamsSchema = z.object({
  timeSheetId: z.string().min(1, "Time sheet ID is required"),
});

type FetchTimeEntriesParams = z.infer<typeof fetchTimeEntriesParamsSchema>;

const saveTimeEntryParamsSchema = timeEntrySchema;

type SaveTimeEntryParams = z.infer<typeof saveTimeEntryParamsSchema>;

const addWorkItemParamsSchema = z.object({
  work_item_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.string(),
  is_billable: z.boolean(),
});

type AddWorkItemParams = z.infer<typeof addWorkItemParamsSchema>;

const submitTimeSheetParamsSchema = z.object({
  timeSheetId: z.string().min(1, "Time sheet ID is required"),
});

type SubmitTimeSheetParams = z.infer<typeof submitTimeSheetParamsSchema>;

const fetchOrCreateTimeSheetParamsSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  periodId: z.string().min(1, "Period ID is required"),
});

type FetchOrCreateTimeSheetParams = z.infer<typeof fetchOrCreateTimeSheetParamsSchema>;

const fetchTimePeriodsParamsSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

type FetchTimePeriodsParams = z.infer<typeof fetchTimePeriodsParamsSchema>;

// Rest of the functions remain the same, but with proper type assertions for validateData results
export async function fetchTimeSheets(): Promise<ITimeSheet[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error("User not authenticated");
  }
  const currentUserId = session.user.id;

  console.log('Fetching time sheets for user:', currentUserId);
  
  const {knex: db, tenant} = await createTenantKnex();
  const query = db('time_sheets')
    .join('time_periods', function() {
      this.on('time_sheets.period_id', '=', 'time_periods.period_id')
          .andOn('time_sheets.tenant', '=', 'time_periods.tenant');
    })
    .where({
      'time_sheets.user_id': currentUserId,
      'time_sheets.tenant': tenant
    })
    .orderBy('time_periods.start_date', 'desc')
    .select(
      'time_sheets.*',
      'time_periods.start_date',
      'time_periods.end_date'
    );

  console.log('SQL Query:', query.toString());

  const timeSheets = await query;

  return timeSheets.map((sheet): ITimeSheet => ({
    ...sheet,
    time_period: {
      period_id: sheet.period_id,
      start_date: toPlainDate(sheet.start_date).toString(),
      end_date: toPlainDate(sheet.end_date).toString(),
      tenant: sheet.tenant
    }
  }));
}

export async function fetchTimeEntriesForTimeSheet(timeSheetId: string): Promise<ITimeEntryWithWorkItem[]> {
  // Validate input
  const validatedParams = validateData<FetchTimeEntriesParams>(fetchTimeEntriesParamsSchema, { timeSheetId });

  const {knex: db, tenant} = await createTenantKnex();

  const timeEntries = await db('time_entries')
    .where({ 
      time_sheet_id: validatedParams.timeSheetId,
      tenant
    })
    .orderBy('start_time', 'desc')
    .select('*');

  // Fetch work item details for these time entries
  const workItemDetails = await Promise.all(timeEntries.map(async (entry): Promise<IWorkItem> => {
    let workItem;
    switch (entry.work_item_type) {
      case 'ticket':
        [workItem] = await db('tickets')
          .where({ 
            ticket_id: entry.work_item_id,
            tenant
          })
          .select('ticket_id as work_item_id', 'title as name', 'url as description', 'ticket_number');
        break;
      case 'project_task':
        [workItem] = await db('project_tasks')
          .where({ 
            task_id: entry.work_item_id,
            tenant
          })
          .join('project_phases', function() {
            this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
                .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
          })
          .join('projects', function() {
            this.on('project_phases.project_id', '=', 'projects.project_id')
                .andOn('project_phases.tenant', '=', 'projects.tenant');
          })
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
          work_item_id: entry.work_item_id,
          name: entry.work_item_id,
          description: '',
          type: 'non_billable_category',
        };
        break;
      case 'ad_hoc':
        // For ad_hoc entries, get the title from schedule entries
        const scheduleEntry = await db('schedule_entries')
          .where({ 
            entry_id: entry.work_item_id,
            tenant
          })
          .first();
        
        workItem = {
          work_item_id: entry.work_item_id,
          name: scheduleEntry?.title || entry.work_item_id,
          description: '',
          type: 'ad_hoc',
        };
        break;
      default:
        throw new Error(`Unknown work item type: ${entry.work_item_type}`);
    }

    // Fetch service information
    const [service] = await db('service_catalog')
      .where({ 
        service_id: entry.service_id,
        tenant
      })
      .select('service_name', 'service_type', 'default_rate');

    return {
      ...workItem,
      created_at: formatISO(entry.created_at),
      updated_at: formatISO(entry.updated_at),
      start_date: formatISO(entry.start_time),
      end_date: formatISO(entry.end_time),
      type: entry.work_item_type,
      is_billable: entry.is_billable,
      ticket_number: entry.work_item_type === 'ticket' ? workItem.ticket_number : undefined,
      service: service ? {
        id: entry.service_id,
        name: service.service_name,
        type: service.service_type,
        default_rate: service.default_rate
      } : null
    };
  }));

  const workItemMap = new Map(workItemDetails.map((item): [string, IWorkItem] => [item.work_item_id, item]));

  return timeEntries.map((entry): ITimeEntryWithWorkItem => ({
    ...entry,
    date: new Date(entry.start_time),
    start_time: formatISO(entry.start_time),
    end_time: formatISO(entry.end_time),
    updated_at: formatISO(entry.updated_at),
    created_at: formatISO(entry.created_at),
    workItem: workItemMap.get(entry.work_item_id),
  }));
}

export async function fetchTaxRegions(): Promise<TaxRegion[]> {
  const {knex: db, tenant} = await createTenantKnex();
  const regions = await db('tax_rates')
    .where({ tenant })
    .select('tax_rate_id as id', 'region as name')
    .distinct('region')
    .orderBy('region');
  return regions;
}

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
    .where('project_tasks.tenant', tenant)
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

export async function saveTimeEntry(timeEntry: Omit<ITimeEntry, 'tenant'>): Promise<ITimeEntryWithWorkItem> {
  // Validate input
  const validatedTimeEntry = validateData<SaveTimeEntryParams>(saveTimeEntryParamsSchema, timeEntry);

  const {knex: db, tenant} = await createTenantKnex();
  const session = await getServerSession(options);
  
  // Check for session and user ID
  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please log in to continue");
  }

  try {
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
    } = timeEntry;
    
    const cleanedEntry = {
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
      user_id: session.user.id, // Always use session user_id
      tenant: tenant as string,
      updated_at: new Date().toISOString()
    };

    // Log the cleaned entry for debugging
    console.log('Cleaned entry data:', cleanedEntry);

    let resultingEntry: ITimeEntry;

    if (entry_id) {
      // Update existing entry
      const [updated] = await db('time_entries')
        .where({ entry_id })
        .update(cleanedEntry)
        .returning('*');

      if (!updated) {
        throw new Error('Failed to update time entry');
      }
      
      resultingEntry = updated;
      console.log('Updated entry:', resultingEntry);
    } else {
      // Insert new entry
      const [inserted] = await db('time_entries')
        .insert({
          ...cleanedEntry,
          entry_id: uuidv4(),
          created_at: new Date().toISOString()
        })
        .returning('*');

      if (!inserted) {
        throw new Error('Failed to insert time entry');
      }

      resultingEntry = inserted;
      console.log('Inserted entry:', resultingEntry);
    }

    // Fetch work item details based on the saved entry
    let workItemDetails: IWorkItem;
    switch (resultingEntry.work_item_type) {
      case 'project_task': {
        const [task] = await db('project_tasks')
          .where({ 
            task_id: resultingEntry.work_item_id,
            tenant
          })
          .join('project_phases', function() {
            this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
                .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
          })
          .join('projects', function() {
            this.on('project_phases.project_id', '=', 'projects.project_id')
                .andOn('project_phases.tenant', '=', 'projects.tenant');
          })
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
          is_billable: true,
          project_name: task.project_name,
          phase_name: task.phase_name
        };
        break;
      }
      case 'ad_hoc': {
        const schedule = await db('schedule_entries')
          .where({ 
            entry_id: resultingEntry.work_item_id,
            tenant
          })
          .first();
        workItemDetails = {
          work_item_id: resultingEntry.work_item_id,
          name: schedule?.title || 'Ad Hoc Entry',
          description: '',
          type: 'ad_hoc',
          is_billable: true
        };
        break;
      }
      case 'ticket': {
        const [ticket] = await db('tickets')
          .where({ 
            ticket_id: resultingEntry.work_item_id,
            tenant
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
          is_billable: true,
          ticket_number: ticket.ticket_number
        };
        break;
      }
      case 'non_billable_category':
        workItemDetails = {
          work_item_id: resultingEntry.work_item_id,
          name: resultingEntry.work_item_id,
          description: '',
          type: 'non_billable_category',
          is_billable: false
        };
        break;
      default:
        throw new Error(`Unknown work item type: ${resultingEntry.work_item_type}`);
    }

    // Return the complete time entry with work item details
    return {
      ...resultingEntry,
      workItem: workItemDetails
    } as ITimeEntryWithWorkItem;

  } catch (error) {
    console.error('Error saving time entry:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to save time entry');
  }
}

export async function addWorkItem(workItem: Omit<IWorkItem, 'tenant'>): Promise<IWorkItem> {
  // Validate input
  const validatedWorkItem = validateData<AddWorkItemParams>(addWorkItemParamsSchema, workItem);

  const {knex: db, tenant} = await createTenantKnex();

  const [newWorkItem] = await db('service_catalog')
    .insert({
      service_id: validatedWorkItem.work_item_id,
      service_name: validatedWorkItem.name,
      description: validatedWorkItem.description,
      service_type: validatedWorkItem.type,
      default_rate: validatedWorkItem.is_billable ? 0 : null,
      tenant
    })
    .returning(['service_id as work_item_id', 'service_name as name', 'description', 'service_type as type']);

  return {
    ...newWorkItem,
    is_billable: newWorkItem.type !== 'non_billable_category',
  };
}

export async function submitTimeSheet(timeSheetId: string): Promise<ITimeSheet> {
  // Validate input
  const validatedParams = validateData<SubmitTimeSheetParams>(submitTimeSheetParamsSchema, { timeSheetId });

  const {knex: db, tenant} = await createTenantKnex();

  try {
    return await db.transaction(async (trx) => {
      // Update the time sheet status
      const [updatedTimeSheet] = await trx('time_sheets')
        .where({ 
          id: validatedParams.timeSheetId,
          tenant
        })
        .update({
          approval_status: 'SUBMITTED',
          submitted_at: trx.fn.now()
        })
        .returning('*');

      // Update all time entries associated with this time sheet
      await trx('time_entries')
        .where({ 
          time_sheet_id: validatedParams.timeSheetId,
          tenant
        })
        .update({
          approval_status: 'SUBMITTED',
          updated_at: trx.fn.now()
        });

      return updatedTimeSheet;
    });
  } catch (error) {
    console.error('Error submitting time sheet:', error);
    throw new Error('Failed to submit time sheet');
  }
}

export async function fetchAllTimeSheets(): Promise<ITimeSheet[]> {
  const {knex: db, tenant} = await createTenantKnex();

  console.log('Fetching all time sheets');
  
  const query = db('time_sheets')
    .join('time_periods', function() {
      this.on('time_sheets.period_id', '=', 'time_periods.period_id')
          .andOn('time_sheets.tenant', '=', 'time_periods.tenant');
    })
    .where('time_sheets.tenant', tenant)
    .orderBy('time_periods.start_date', 'desc')
    .select(
      'time_sheets.*',
      'time_periods.start_date',
      'time_periods.end_date'
    );

  console.log('SQL Query:', query.toString());

  const timeSheets = await query;

  return timeSheets.map((sheet): ITimeSheet => ({
    ...sheet,
    time_period: {
      start_date: toPlainDate(sheet.start_date).toString(),
      end_date: toPlainDate(sheet.end_date).toString()
    }
  }));
}

export async function fetchTimePeriods(userId: string): Promise<ITimePeriodWithStatusView[]> {
  // Validate input
  const validatedParams = validateData<FetchTimePeriodsParams>(fetchTimePeriodsParamsSchema, { userId });

  const {knex: db, tenant} = await createTenantKnex();

  const periods = await db('time_periods as tp')
    .leftJoin('time_sheets as ts', function() {
      this.on('tp.period_id', '=', 'ts.period_id')
          .andOn('tp.tenant', '=', 'ts.tenant')
          .andOn('ts.user_id', '=', db.raw('?', [validatedParams.userId]));
    })
    .where('tp.tenant', tenant)
    .orderBy('tp.start_date', 'desc')
    .select(
      'tp.*',
      'ts.approval_status',
      db.raw('COALESCE(ts.approval_status, ?) as timeSheetStatus', ['DRAFT'])
    );

  console.log('Fetched periods:', periods);

  return periods.map((period): ITimePeriodWithStatusView => ({
    ...period,
    start_date: toPlainDate(period.start_date).toString(),
    end_date: toPlainDate(period.end_date).toString(),
    timeSheetStatus: (period.approval_status || period.timeSheetStatus || 'DRAFT') as TimeSheetStatus
  }));
}

export async function fetchOrCreateTimeSheet(userId: string, periodId: string): Promise<ITimeSheetView> {
  // Validate input
  const validatedParams = validateData<FetchOrCreateTimeSheetParams>(
    fetchOrCreateTimeSheetParamsSchema,
    { userId, periodId }
  );

  const {knex: db, tenant} = await createTenantKnex();

  let timeSheet = await db('time_sheets')
    .where({
      user_id: validatedParams.userId,
      period_id: validatedParams.periodId,
      tenant
    })
    .first();

  if (!timeSheet) {
    [timeSheet] = await db('time_sheets')
      .insert({
        user_id: validatedParams.userId,
        period_id: validatedParams.periodId,
        approval_status: 'DRAFT',
        tenant
      })
      .returning('*');
  }

  const timePeriod = await db('time_periods')
    .where({ 
      period_id: validatedParams.periodId,
      tenant
    })
    .first();

  // Fetch comments for the time sheet
  const comments = await db('time_sheet_comments')
    .where({ 
      time_sheet_id: timeSheet.id,
      tenant
    })
    .orderBy('created_at', 'desc')
    .select('*');

  return {
    ...timeSheet,
    time_period: {
      ...timePeriod,
      start_date: toPlainDate(timePeriod.start_date).toString(),
      end_date: toPlainDate(timePeriod.end_date).toString()
    },
    comments: comments,
  };
}

export async function fetchCompanyTaxRateForWorkItem(workItemId: string, workItemType: string): Promise<string | undefined> {
  console.log(`Fetching tax rate for work item ${workItemId} of type ${workItemType}`);
  
  const {knex: db, tenant} = await createTenantKnex();

  try {
    let query;
    
    if (workItemType === 'ticket') {
      query = db('tickets')
        .where({
          'tickets.ticket_id': workItemId,
          'tickets.tenant': tenant
        })
        .join('companies', function() {
          this.on('tickets.company_id', '=', 'companies.company_id')
              .andOn('tickets.tenant', '=', 'companies.tenant');
        });
    } else if (workItemType === 'project_task') {
      query = db('project_tasks')
        .where({
          'project_tasks.task_id': workItemId,
          'project_tasks.tenant': tenant
        })
        .join('project_phases', function() {
          this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
              .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
        })
        .join('projects', function() {
          this.on('project_phases.project_id', '=', 'projects.project_id')
              .andOn('project_phases.tenant', '=', 'projects.tenant');
        })
        .join('companies', function() {
          this.on('projects.company_id', '=', 'companies.company_id')
              .andOn('projects.tenant', '=', 'companies.tenant');
        });
    } else {
      console.log(`Unsupported work item type: ${workItemType}`);
      return undefined;
    }

    query = query
      .join('company_tax_rates', function() {
        this.on('companies.company_id', '=', 'company_tax_rates.company_id')
            .andOn('companies.tenant', '=', 'company_tax_rates.tenant');
      })
      .join('tax_rates', function() {
        this.on('company_tax_rates.tax_rate_id', '=', 'tax_rates.tax_rate_id')
            .andOn('company_tax_rates.tenant', '=', 'tax_rates.tenant');
      })
      .select('tax_rates.region');

    console.log('Executing query:', query.toString());

    const result = await query.first();
    
    if (result) {
      console.log(`Found tax region: ${result.region}`);
      return result.region;
    } else {
      console.log('No tax region found');
      return undefined;
    }
  } catch (error) {
    console.error('Error fetching tax rate:', error);
    return undefined;
  }
}

export async function deleteTimeEntry(entryId: string): Promise<void> {
  const {knex: db, tenant} = await createTenantKnex();
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error("User not authenticated");
  }

  try {
    await db('time_entries')
      .where({ 
        entry_id: entryId,
        tenant
      })
      .delete();
  } catch (error) {
    console.error('Error deleting time entry:', error);
    throw new Error('Failed to delete time entry');
  }
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
      await trx('time_entries')
        .where({ 
          work_item_id: workItemId,
          tenant
        })
        .delete();
    });
  } catch (error) {
    console.error('Error deleting work item:', error);
    throw new Error('Failed to delete work item');
  }
}

export async function fetchServicesForTimeEntry(workItemType?: string): Promise<{ id: string; name: string; type: string; is_taxable: boolean }[]> {
  const {knex: db, tenant} = await createTenantKnex();

  let query = db('service_catalog')
    .where({ tenant })
    .select(
      'service_id as id',
      'service_name as name',
      'service_type as type',
      'is_taxable'
    );

  // For ad_hoc entries, only show Time-based services
  if (workItemType === 'ad_hoc') {
    query = query.where('service_type', 'Time');
  }

  const services = await query;
  return services;
}
