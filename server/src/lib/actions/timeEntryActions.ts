'use server'

import { createTenantKnex } from '@/lib/db';
import { ITimeEntry, ITimePeriod, ITimeEntryWithWorkItem, ITimeSheet } from '@/interfaces/timeEntry.interfaces';
import { ITimePeriodWithStatus, TimeSheetStatus } from '@/interfaces/timeEntry.interfaces';
import { IWorkItem } from '@/interfaces/workItem.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "@/app/api/auth/[...nextauth]/options";
import { TaxRegion } from '@/types/types.d';
import { v4 as uuidv4 } from 'uuid';
import { formatISO } from 'date-fns';
import { validateData } from '@/lib/utils/validation';
import { z } from 'zod';
import {
  timeEntrySchema,
  timeSheetSchema,
  timePeriodSchema,
  timeSheetStatusSchema,
  workItemTypeSchema
} from '@/lib/schemas/timeSheet.schemas';

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
  
  const {knex: db} = await createTenantKnex();
  const query = db('time_sheets')
    .join('time_periods', 'time_sheets.period_id', '=', 'time_periods.period_id')
    .where('time_sheets.user_id', currentUserId)
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
      start_date: new Date(sheet.start_date),
      end_date: new Date(sheet.end_date)
    }
  }));
}

export async function fetchTimeEntriesForTimeSheet(timeSheetId: string): Promise<ITimeEntryWithWorkItem[]> {
  // Validate input
  const validatedParams = validateData<FetchTimeEntriesParams>(fetchTimeEntriesParamsSchema, { timeSheetId });

  const {knex: db} = await createTenantKnex();

  const timeEntries = await db('time_entries')
    .where({ time_sheet_id: validatedParams.timeSheetId })
    .orderBy('start_time', 'desc')
    .select('*');

  // Fetch work item details for these time entries
  const workItemDetails = await Promise.all(timeEntries.map(async (entry): Promise<IWorkItem> => {
    let workItem;
    switch (entry.work_item_type) {
      case 'ticket':
        [workItem] = await db('tickets')
          .where({ ticket_id: entry.work_item_id })
          .select('ticket_id as work_item_id', 'title as name', 'url as description');
        break;
      case 'project_task':
        [workItem] = await db('project_tasks')
          .where({ task_id: entry.work_item_id })
          .select('task_id as work_item_id', 'task_name as name', 'description');
        break;
      case 'non_billable_category':
        workItem = {
          work_item_id: entry.work_item_id,
          name: entry.work_item_id,
          description: '',
          type: 'non_billable_category',
        };
        break;
      default:
        throw new Error(`Unknown work item type: ${entry.work_item_type}`);
    }

    // Fetch service information
    const [service] = await db('service_catalog')
      .where({ service_id: entry.service_id })
      .select('service_name', 'service_type', 'default_rate');

    return {
      ...workItem,
      created_at: formatISO(entry.created_at),
      updated_at: formatISO(entry.updated_at),
      start_date: formatISO(entry.start_time),
      end_date: formatISO(entry.end_time),
      type: entry.work_item_type,
      is_billable: entry.is_billable,
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
  const {knex: db} = await createTenantKnex();
  const regions = await db('tax_rates')
    .select('tax_rate_id as id', 'region as name')
    .distinct('region')
    .orderBy('region');
  return regions;
}

export async function fetchWorkItemsForTimeSheet(timeSheetId: string): Promise<IWorkItem[]> {
  // Validate input
  const validatedParams = validateData<FetchTimeEntriesParams>(fetchTimeEntriesParamsSchema, { timeSheetId });

  const {knex: db} = await createTenantKnex();

  const tickets = await db('tickets')
    .whereIn('ticket_id', function () {
      this.select('work_item_id')
        .from('time_entries')
        .where('time_entries.work_item_type', 'ticket')
        .where('time_entries.time_sheet_id', validatedParams.timeSheetId);
    })
    .select(
      'ticket_id as work_item_id',
      'title as name',
      'url as description',
      db.raw("'ticket' as type")
    );

  const projectTasks = await db('project_tasks')
    .whereIn('task_id', function () {
      this.select('work_item_id')
        .from('time_entries')
        .where('time_entries.work_item_type', 'project_task')
        .where('time_entries.time_sheet_id', validatedParams.timeSheetId);
    })
    .select(
      'task_id as work_item_id',
      'task_name as name',
      'description',
      db.raw("'project_task' as type")
    );

  return [...tickets, ...projectTasks].map((item): IWorkItem => ({
    ...item,
    is_billable: true, // TODO: reconsider this
  }));
}

export async function saveTimeEntry(timeEntry: Omit<ITimeEntry, 'tenant'>): Promise<ITimeEntry> {
  // Validate input
  const validatedTimeEntry = validateData<SaveTimeEntryParams>(saveTimeEntryParamsSchema, timeEntry);

  const {knex: db, tenant} = await createTenantKnex();
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error("User not authenticated");
  }
  validatedTimeEntry.user_id = session.user.id;

  // require the time_sheet_id to be set
  if (!validatedTimeEntry.time_sheet_id) {
    throw new Error('time_sheet_id is required');
  }

  const { entry_id, ...entryData } = validatedTimeEntry;

  let resultingEntry: ITimeEntry[] | undefined;

  if (entry_id) {
    // Update existing entry
    resultingEntry = await db<ITimeEntry>('time_entries')
      .where({ entry_id: entry_id })
      .update({
        ...entryData,
        updated_at: db.fn.now()
      }).returning('*');
  } else {
    // log the entry data
    console.log(`Saving new time entry: ${JSON.stringify(entryData)}`);
    validatedTimeEntry.entry_id = uuidv4();
    // Insert new entry
    if (!validatedTimeEntry.tax_region) {      
      let company_id = '';
      if (validatedTimeEntry.work_item_type === 'project_task') {
        const projectTask = await db('project_tasks')
          .where({ task_id: validatedTimeEntry.work_item_id })
          .select('company_id')
          .first();
        company_id = projectTask?.company_id;
      } else if (validatedTimeEntry.work_item_type === 'ticket') {
        const ticket = await db('tickets')
          .where({ ticket_id: validatedTimeEntry.work_item_id })
          .select('company_id')
          .first();
        company_id = ticket?.company_id;
      }
      const company = await db('companies')
        .where({ company_id: company_id })
        .select('tax_region')
        .first();

      validatedTimeEntry.tax_region = company?.tax_region;
    }       
    const [newEntry] = await db('time_entries')
      .insert({ ...validatedTimeEntry, tenant })
      .returning('*');

    resultingEntry = [newEntry];

    validatedTimeEntry.entry_id = resultingEntry![0].entry_id;
  }

  // Fetch the work_item_type and service information
  const [workItem] = await db('service_catalog')
    .where({ service_id: validatedTimeEntry.service_id })
    .select('service_type as work_item_type', 'service_name', 'default_rate');

  if (!resultingEntry) {
    throw new Error('Failed to save time entry');
  }

  return {
    ...resultingEntry[0],
    work_item_type: workItem.work_item_type,
    service_id: validatedTimeEntry.service_id,
  };
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

  const {knex: db} = await createTenantKnex();

  try {
    return await db.transaction(async (trx) => {
      // Update the time sheet status
      const [updatedTimeSheet] = await trx('time_sheets')
        .where({ id: validatedParams.timeSheetId })
        .update({
          approval_status: 'SUBMITTED',
          submitted_at: trx.fn.now()
        })
        .returning('*');

      // Update all time entries associated with this time sheet
      await trx('time_entries')
        .where({ time_sheet_id: validatedParams.timeSheetId })
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
  const {knex: db} = await createTenantKnex();

  console.log('Fetching all time sheets');
  
  const query = db('time_sheets')
    .join('time_periods', 'time_sheets.period_id', '=', 'time_periods.period_id')
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
      start_date: new Date(sheet.start_date),
      end_date: new Date(sheet.end_date)
    }
  }));
}

export async function fetchTimePeriods(userId: string): Promise<ITimePeriodWithStatus[]> {
  // Validate input
  const validatedParams = validateData<FetchTimePeriodsParams>(fetchTimePeriodsParamsSchema, { userId });

  const {knex: db} = await createTenantKnex();

  const periods = await db('time_periods as tp')
    .leftJoin('time_sheets as ts', function() {
      this.on('tp.period_id', '=', 'ts.period_id')
          .andOn('ts.user_id', '=', db.raw('?', [validatedParams.userId]));
    })
    .orderBy('tp.start_date', 'desc')
    .select(
      'tp.*',
      'ts.approval_status',
      db.raw('COALESCE(ts.approval_status, ?) as timeSheetStatus', ['DRAFT'])
    );

  console.log('Fetched periods:', periods);

  return periods.map((period): ITimePeriodWithStatus => ({
    ...period,
    start_date: period.start_date.toISOString().split('.')[0] + 'Z',
    end_date: period.end_date.toISOString().split('.')[0] + 'Z',
    timeSheetStatus: (period.approval_status || period.timeSheetStatus || 'DRAFT') as TimeSheetStatus
  }));
}

export async function fetchOrCreateTimeSheet(userId: string, periodId: string): Promise<ITimeSheet> {
  // Validate input
  const validatedParams = validateData<FetchOrCreateTimeSheetParams>(
    fetchOrCreateTimeSheetParamsSchema,
    { userId, periodId }
  );

  const {knex: db, tenant} = await createTenantKnex();

  let timeSheet = await db('time_sheets')
    .where({
      user_id: validatedParams.userId,
      period_id: validatedParams.periodId
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
    .where({ period_id: validatedParams.periodId })
    .first();

  // Fetch comments for the time sheet
  const comments = await db('time_sheet_comments')
    .where({ time_sheet_id: timeSheet.id })
    .orderBy('created_at', 'desc')
    .select('*');

  return {
    ...timeSheet,
    time_period: {
      ...timePeriod,
      start_date: formatISO(timePeriod.start_date),
      end_date: formatISO(timePeriod.end_date),
    },
    comments: comments,
  };
}

export async function fetchServicesForTimeEntry(): Promise<{ id: string; name: string; type: string; is_taxable: boolean }[]> {
  const {knex: db} = await createTenantKnex();

  const services = await db('service_catalog')
    .select(
      'service_id as id',
      'service_name as name',
      'service_type as type',
      'is_taxable'
    );

  return services;
}
