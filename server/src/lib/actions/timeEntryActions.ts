'use server'

import { Knex } from 'knex'; // Import Knex type
import { createTenantKnex } from 'server/src/lib/db';
import { determineDefaultBillingPlan } from 'server/src/lib/utils/planDisambiguation';
import { findOrCreateCurrentBucketUsageRecord, updateBucketUsageMinutes } from 'server/src/lib/services/bucketUsageService'; // Import bucket service functions
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
} from 'server/src/interfaces/timeEntry.interfaces';
import { IWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import { TaxRegion } from 'server/src/types/types.d';
import { v4 as uuidv4 } from 'uuid';
import { formatISO } from 'date-fns';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { validateData } from 'server/src/lib/utils/validation';
import { z } from 'zod';
import { timeEntrySchema } from 'server/src/lib/schemas/timeSheet.schemas';
import { TentTree } from 'lucide-react';

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

// Helper function to get company_id from work_item
async function getCompanyIdForWorkItem(trx: Knex.Transaction, tenant: string, workItemId: string, workItemType: string): Promise<string | null> {
    if (workItemType === 'ticket') {
        const ticket = await trx('tickets')
            .where({ ticket_id: workItemId, tenant })
            .first('company_id');
        return ticket?.company_id || null;
    } else if (workItemType === 'project_task') {
        const task = await trx('project_tasks')
            .join('project_phases', function() {
                this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
                    .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
            })
            .join('projects', function() {
                this.on('project_phases.project_id', '=', 'projects.project_id')
                    .andOn('project_phases.tenant', '=', 'projects.tenant');
            })
            .where({ 'project_tasks.task_id': workItemId, 'project_tasks.tenant': tenant })
            .first('projects.company_id');
        return task?.company_id || null;
    }
    // Add other work item types if they can be associated with companies and buckets (e.g., ad_hoc if linked to a company)
    // For now, only tickets and project tasks are assumed to link to companies for billing plans.
    return null;
}

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
            'tickets.tenant': tenant
          })
          .select('ticket_id as work_item_id', 'title as name', 'url as description', 'ticket_number');
        break;
      case 'project_task':
        [workItem] = await db('project_tasks')
          .where({
            task_id: entry.work_item_id,
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
            'schedule_entries.tenant': tenant
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

    // Fetch service information with new schema (using billing_method instead of service_type)
    const [service] = await db('service_catalog as sc')
      .leftJoin('standard_service_types as sst', 'sc.standard_service_type_id', 'sst.id')
      .leftJoin('service_types as tst', function() {
        this.on('sc.custom_service_type_id', '=', 'tst.id')
            .andOn('sc.tenant', '=', 'tst.tenant_id');
      })
      .where({
        'sc.service_id': entry.service_id,
        'sc.tenant': tenant
      })
      .select(
        'sc.service_name',
        'sc.billing_method as service_type', // Use billing_method as service_type for backwards compatibility
        db.raw('CAST(sc.default_rate AS FLOAT) as default_rate')
      );

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

export async function saveTimeEntry(timeEntry: Omit<ITimeEntry, 'tenant'>): Promise<ITimeEntryWithWorkItem> {
  // Validate input
  const validatedTimeEntry = validateData<SaveTimeEntryParams>(saveTimeEntryParamsSchema, timeEntry);

  const {knex: db, tenant} = await createTenantKnex();
  const session = await getServerSession(options);

  if (!tenant) {
    throw new Error("Tenant not found");
  }
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
      billing_plan_id,
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
      billing_plan_id,
      user_id: session.user.id, // Always use session user_id
      tenant: tenant as string,
      updated_at: new Date().toISOString()
    };

    // Log the cleaned entry for debugging
    console.log('Cleaned entry data:', cleanedEntry);

    let resultingEntry: ITimeEntry | null = null;

    // If no billing plan ID is provided, try to determine the default one
    if (!billing_plan_id && service_id) {
      try {
        const defaultPlanId = await determineDefaultBillingPlan(
          work_item_type === 'project_task' ?
            (await db('project_tasks')
              .join('project_phases', function() {
                this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
                    .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
              })
              .join('projects', function() {
                this.on('project_phases.project_id', '=', 'projects.project_id')
                    .andOn('project_phases.tenant', '=', 'projects.tenant');
              })
              .where({ 'project_tasks.task_id': work_item_id, 'project_tasks.tenant': tenant })
              .first('projects.company_id')).company_id
            : work_item_type === 'ticket' ?
              (await db('tickets')
                .where({ ticket_id: work_item_id, tenant })
                .first('company_id')).company_id
              : null,
          service_id
        );

        if (defaultPlanId) {
          cleanedEntry.billing_plan_id = defaultPlanId;
        }
      } catch (error) {
        console.error('Error determining default billing plan:', error);
      }
    }


    await db.transaction(async (trx) => {
      console.log('Starting transaction for time entry');
      let oldDuration = 0; // Initialize oldDuration
      if (entry_id) {
        // Fetch original entry before update to calculate delta
        const originalEntryForUpdate = await trx('time_entries')
          .where({ entry_id, tenant })
          .select('billable_duration')
          .first();
        // If original entry not found, maybe throw error or handle gracefully?
        // Throwing error for now as update shouldn't happen if original is gone.
        if (!originalEntryForUpdate) {
             throw new Error(`Original time entry with ID ${entry_id} not found for update.`);
        }
        oldDuration = originalEntryForUpdate.billable_duration || 0;

        // Update existing entry
        const [updated] = await trx('time_entries')
          .where({ entry_id, tenant }) // Ensure tenant match
          .update(cleanedEntry)
          .returning('*');

        if (!updated) {
          throw new Error('Failed to update time entry');
        }

        resultingEntry = updated;
        console.log('Updated entry:', resultingEntry);

        // If this is a project task, update the actual_hours in the project_tasks table
        if (work_item_type === 'project_task') {
          // Get all time entries for this task to calculate total actual hours
          const timeEntries = await trx('time_entries')
            .where({
              work_item_id,
              work_item_type: 'project_task',
              tenant
            })
            .select('billable_duration');

          // Calculate total minutes from all time entries
          const totalMinutes = timeEntries.reduce((total, entry) => total + entry.billable_duration, 0);

          // Store actual_hours as minutes in the database (integer)
          await trx('project_tasks')
            .where({
              task_id: work_item_id,
              tenant
            })
            .update({
              actual_hours: totalMinutes,
              updated_at: new Date()
            });
        }
      } else {
        // Insert new entry
        const [inserted] = await trx('time_entries')
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

        // Add user to ticket_resources or task_resources when a new time entry is created
        // Also update actual_hours for project tasks
        if (work_item_type === 'project_task') {
          // Update actual_hours in project_tasks table
          // Get all time entries for this task to calculate total actual hours
          const timeEntries = await trx('time_entries')
            .where({
              work_item_id,
              work_item_type: 'project_task',
              tenant
            })
            .select('billable_duration');

          // Calculate total minutes from all time entries
          const totalMinutes = timeEntries.reduce((total, entry) => total + entry.billable_duration, 0);

          // Store actual_hours as minutes in the database (integer)
          await trx('project_tasks')
            .where({
              task_id: work_item_id,
              tenant
            })
            .update({
              actual_hours: totalMinutes,
              updated_at: new Date()
            });

          // Get current task to check if it already has an assignee
          const task = await trx('project_tasks')
            .where({
              task_id: work_item_id,
              tenant,
            })
            .first();

          if (task) {
            // Check if user is already in task_resources for this task
            const existingResource = await trx('task_resources')
              .where({
                task_id: work_item_id,
                tenant,
              })
              .where(function() {
                this.where('assigned_to', session.user.id)
                  .orWhere('additional_user_id', session.user.id);
              })
              .first();

            // If task already has an assignee and it's not the current user
            if (task.assigned_to && task.assigned_to !== session.user.id) {
              // Only add as additional user if not already in resources
              if (!existingResource) {
                await trx('task_resources').insert({
                  task_id: work_item_id,
                  assigned_to: task.assigned_to,
                  additional_user_id: session.user.id,
                  assigned_at: new Date(),
                  tenant,
                });
              }
            } else if (!task.assigned_to) {
              // If task has no assignee, only update the task's assigned_to field
              await trx('project_tasks')
                .where({
                  task_id: work_item_id,
                  tenant,
                })
                .update({
                  assigned_to: session.user.id,
                  updated_at: new Date(),
                });
              // No task_resources record is created when there's no additional user
            }
          }
        } else if (work_item_type === 'ticket') {
          // Check if user is already in ticket_resources for this ticket
          const existingResource = await trx('ticket_resources')
            .where({
              ticket_id: work_item_id,
              tenant,
            })
            .where(function() {
              this.where('assigned_to', session.user.id)
                .orWhere('additional_user_id', session.user.id);
            })
            .first();

          if (!existingResource) {
            // Get current ticket to check if it already has an assignee
            const ticket = await trx('tickets')
              .where({
                ticket_id: work_item_id,
                tenant,
              })
              .first();

            if (ticket) {
              // If ticket already has an assignee, add user as additional_user_id
              if (ticket.assigned_to && ticket.assigned_to !== session.user.id) {
                await trx('ticket_resources').insert({
                  ticket_id: work_item_id,
                  assigned_to: ticket.assigned_to,
                  additional_user_id: session.user.id,
                  assigned_at: new Date(),
                  tenant,
                });
              } else if (!ticket.assigned_to) {
                // If ticket has no assignee, update the ticket and add user as assigned_to
                await trx('tickets')
                  .where({
                    ticket_id: work_item_id,
                    tenant,
                  })
                  .update({
                    assigned_to: session.user.id,
                    updated_at: new Date().toISOString(),
                    updated_by: session.user.id,
                  });

                await trx('ticket_resources').insert({
                  ticket_id: work_item_id,
                  assigned_to: session.user.id,
                  assigned_at: new Date(),
                  tenant,
                });
              }
            }
          }
        }
      }
      // --- Bucket Usage Update Logic ---
      // Check if billable based on duration > 0
      if (resultingEntry && resultingEntry.service_id && (resultingEntry.billable_duration || 0) > 0) {
        // Ensure work_item_id and work_item_type exist and call helper
        let companyId: string | null = null;
        if (resultingEntry.work_item_id && resultingEntry.work_item_type) {
            // Now TypeScript knows both are strings here
            companyId = await getCompanyIdForWorkItem(trx, tenant, resultingEntry.work_item_id as string, resultingEntry.work_item_type as string);
        }
        const currentPlanId = resultingEntry.billing_plan_id; // Use the plan ID associated with the entry

        if (companyId && currentPlanId) {
          // Check if the plan is a 'Bucket' type plan
          // Correctly check plan_type by joining company_billing_plans with billing_plans
          const planInfo = await trx('company_billing_plans as cbp')
            .join('billing_plans as bp', function() {
                this.on('cbp.plan_id', '=', 'bp.plan_id')
                    .andOn('cbp.tenant', '=', 'bp.tenant');
            })
            .where('cbp.company_billing_plan_id', currentPlanId) // Use the ID from the time entry
            .andWhere('cbp.tenant', tenant)
            .first('bp.plan_type'); // Select plan_type from billing_plans table

          if (planInfo && planInfo.plan_type === 'Bucket') {
            console.log(`Time entry ${resultingEntry.entry_id} linked to Bucket plan ${currentPlanId}. Updating usage.`);

            const newDuration = resultingEntry.billable_duration || 0;
            // Calculate delta in MINUTES first
            const minutesDelta = newDuration - oldDuration; // oldDuration is 0 for inserts

            // Pass delta in MINUTES to bucket usage service
            if (minutesDelta !== 0) {
              try {
                const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
                  trx,
                  companyId,
                  resultingEntry.service_id,
                  resultingEntry.start_time // Use entry's start time to find the correct period
                );

                await updateBucketUsageMinutes(
                  trx,
                  bucketUsageRecord.usage_id,
                  minutesDelta // Pass the delta in minutes
                );
                console.log(`Successfully updated bucket usage for entry ${resultingEntry.entry_id}`);
              } catch (bucketError) {
                console.error(`Error updating bucket usage for time entry ${resultingEntry.entry_id}:`, bucketError);
                // Re-throwing ensures data consistency.
                throw new Error(`Failed to update bucket usage: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
              }
            } else {
               console.log(`No duration change for time entry ${resultingEntry.entry_id}, skipping bucket update.`);
            }
          } else {
             console.log(`Time entry ${resultingEntry.entry_id} service/plan is not a Bucket type or plan not found.`);
          }
        } else {
           console.log(`Could not determine company ID or billing plan for time entry ${resultingEntry.entry_id}, skipping bucket update.`);
        }
      } else {
         console.log(`Time entry ${resultingEntry?.entry_id} is not billable or missing service ID, skipping bucket update.`);
      }
      // --- End Bucket Usage Update Logic ---
    });

    if (!resultingEntry) {
      throw new Error('Failed to save time entry: No entry was created or updated');
    }

    // Ensure resultingEntry is treated as ITimeEntry
    const entry = resultingEntry as ITimeEntry;

    // Fetch work item details based on the saved entry
    let workItemDetails: IWorkItem;
    switch (entry.work_item_type) {
      case 'project_task': {
        const [task] = await db('project_tasks')
          .where({
            task_id: entry.work_item_id,
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
            entry_id: entry.work_item_id,
            tenant
          })
          .first();
        workItemDetails = {
          work_item_id: entry.work_item_id,
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
            ticket_id: entry.work_item_id,
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
          work_item_id: entry.work_item_id,
          name: entry.work_item_id,
          description: '',
          type: 'non_billable_category',
          is_billable: false
        };
        break;
      default:
        throw new Error(`Unknown work item type: ${entry.work_item_type}`);
    }

    // Return the complete time entry with work item details
    const result: ITimeEntryWithWorkItem = {
      ...entry,
      workItem: workItemDetails
    };
    return result;

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
    .where({ 'tp.tenant': tenant })
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

  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    await db.transaction(async (trx) => {
      // Get the time entry to be deleted
      const timeEntry = await trx('time_entries')
        .where({
          entry_id: entryId,
          tenant
        })
        .first();

      if (!timeEntry) {
        throw new Error('Time entry not found');
      }

      // --- Bucket Usage Update Logic (Before Delete) ---
      if (timeEntry.service_id && (timeEntry.billable_duration || 0) > 0) {
        let companyId: string | null = null;
        if (timeEntry.work_item_id && timeEntry.work_item_type) {
            companyId = await getCompanyIdForWorkItem(trx, tenant, timeEntry.work_item_id as string, timeEntry.work_item_type as string);
        }
        const currentPlanId = timeEntry.billing_plan_id;

        if (companyId && currentPlanId) {
          const planInfo = await trx('company_billing_plans as cbp')
            .join('billing_plans as bp', function() {
                this.on('cbp.plan_id', '=', 'bp.plan_id')
                    .andOn('cbp.tenant', '=', 'bp.tenant');
            })
            .where('cbp.company_billing_plan_id', currentPlanId)
            .andWhere('cbp.tenant', tenant)
            .first('bp.plan_type');

          if (planInfo && planInfo.plan_type === 'Bucket') {
            console.log(`Time entry ${entryId} linked to Bucket plan ${currentPlanId}. Decrementing usage.`);
            const minutesDelta = -(timeEntry.billable_duration || 0); // Negative delta

            if (minutesDelta !== 0) {
              try {
                const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
                  trx,
                  companyId,
                  timeEntry.service_id,
                  timeEntry.start_time // Use entry's start time to find the correct period
                );

                await updateBucketUsageMinutes(
                  trx,
                  bucketUsageRecord.usage_id,
                  minutesDelta // Pass negative delta
                );
                console.log(`Successfully decremented bucket usage for deleted entry ${entryId}`);
              } catch (bucketError) {
                console.error(`Error updating bucket usage for deleted time entry ${entryId}:`, bucketError);
                // Re-throwing ensures data consistency.
                throw new Error(`Failed to update bucket usage for delete: ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`);
              }
            }
          }
        }
      }
      // --- End Bucket Usage Update Logic ---

      // 2. Delete the time entry
      const deleteCount = await trx('time_entries')
        .where({ entry_id: entryId, tenant })
        .delete();

      if (deleteCount === 0) {
         // This shouldn't happen if the initial fetch succeeded, but handle defensively
         console.warn(`Attempted to delete time entry ${entryId}, but it was not found (possibly deleted concurrently).`);
      } else {
         console.log(`Successfully deleted time entry ${entryId}`);
      }

      // If this was a project task, update the actual_hours in the project_tasks table
      if (timeEntry.work_item_type === 'project_task') {
        // Get all remaining time entries for this task to calculate total actual hours
        const timeEntries = await trx('time_entries')
          .where({
            work_item_id: timeEntry.work_item_id,
            work_item_type: 'project_task',
            tenant
          })
          .select('billable_duration');

        // Calculate total minutes from all time entries
        const totalMinutes = timeEntries.reduce((total, entry) => total + entry.billable_duration, 0);

        // Store actual_hours as minutes in the database (integer)
        await trx('project_tasks')
          .where({
            task_id: timeEntry.work_item_id,
            tenant
          })
          .update({
            actual_hours: totalMinutes,
            updated_at: new Date()
          });
         console.log(`Updated actual_hours for project task ${timeEntry.work_item_id}`);
      }
    });
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

  let query = db('service_catalog as sc')
    .leftJoin('standard_service_types as sst', 'sc.standard_service_type_id', 'sst.id')
    .leftJoin('service_types as tst', function() {
      this.on('sc.custom_service_type_id', '=', 'tst.id')
          .andOn('sc.tenant', '=', 'tst.tenant_id');
    })
    .where({ 'sc.tenant': tenant })
    .select(
      'sc.service_id as id',
      'sc.service_name as name',
      'sc.billing_method as type', // Use billing_method as type
      'sc.is_taxable'
    );

  // For ad_hoc entries, only show Time-based services
  if (workItemType === 'ad_hoc') {
    // Assuming 'Time' service type maps to 'per_unit' billing method based on migrations
    query = query.where('sc.billing_method', 'per_unit');
  }

  const services = await query;
  return services;
}

/**
 * Fetches schedule entry information for a work item
 * @param workItemId The work item ID
 * @returns The schedule entry information or null if not found
 */
export async function fetchScheduleEntryForWorkItem(workItemId: string): Promise<{
  scheduled_start: string;
  scheduled_end: string
} | null> {
  try {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error("Tenant context not found");
    }

    const scheduleEntry = await knex('schedule_entries')
      .where('entry_id', workItemId)
      .select('scheduled_start', 'scheduled_end')
      .first();

    return scheduleEntry || null;
  } catch (error) {
    console.error('Error fetching schedule entry for work item:', error);
    return null;
  }
}

/**
 * Fetches a single time entry by its ID, including work item details.
 * @param entryId The ID of the time entry.
 * @returns The time entry with work item details, or null if not found.
 */
  export async function getTimeEntryById(entryId: string): Promise<ITimeEntryWithWorkItem | null> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant context not found");
    }

    try {
      const entry = await db('time_entries')
        .where({ entry_id: entryId, tenant })
        .first();

      if (!entry) {
        return null;
      }

      // Fetch work item details based on the saved entry
      let workItemDetails: IWorkItem;
      switch (entry.work_item_type) {
        case 'project_task': {
          const [task] = await db('project_tasks')
            .where({
              task_id: entry.work_item_id,
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
              entry_id: entry.work_item_id,
              tenant
            })
            .first();
          workItemDetails = {
            work_item_id: entry.work_item_id,
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
              ticket_id: entry.work_item_id,
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
            work_item_id: entry.work_item_id,
            name: entry.work_item_id,
            description: '',
            type: 'non_billable_category',
            is_billable: false
          };
          break;
        default:
          throw new Error(`Unknown work item type: ${entry.work_item_type}`);
      }

      // Return the complete time entry with work item details
      const result: ITimeEntryWithWorkItem = {
        ...entry,
        workItem: workItemDetails
      };
      return result;

    } catch (error) {
      console.error(`Error fetching time entry by ID ${entryId}:`, error);
      throw new Error(`Failed to fetch time entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }