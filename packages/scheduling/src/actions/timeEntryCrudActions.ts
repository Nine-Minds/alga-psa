'use server'

import { Knex } from 'knex'; // Import Knex type
import { createTenantKnex } from '@alga-psa/db';
import { determineDefaultContractLine } from '../lib/contractLineDisambiguation';
import { findOrCreateCurrentBucketUsageRecord, updateBucketUsageMinutes } from '../services/bucketUsageService'; // Import bucket service functions
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
  SaveTimeEntryParams
} from './timeEntrySchemas'; // Import schemas
import { getClientIdForWorkItem } from './timeEntryHelpers'; // Import helper
import { computeWorkDateFields, resolveUserTimeZone } from '@alga-psa/db';

function captureAnalytics(_event: string, _properties?: Record<string, any>, _userId?: string): void {
  // Intentionally no-op: avoid pulling analytics (and its tenancy/client-portal deps) into scheduling.
}

export const fetchTimeEntriesForTimeSheet = withAuth(async (
  user,
  { tenant },
  timeSheetId: string
): Promise<ITimeEntryWithWorkItem[]> => {
  const {knex: db} = await createTenantKnex();

  // Check permission for time entry reading
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read time entries');
  }

  // Validate input
  const validatedParams = validateData<FetchTimeEntriesParams>(fetchTimeEntriesParamsSchema, { timeSheetId });

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
      case 'interaction':
        [workItem] = await db('interactions')
          .where({
            'interactions.interaction_id': entry.work_item_id,
            'interactions.tenant': tenant
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

    // Fetch service information with new schema (using billing_method instead of service_type)
    const [service] = await db('service_catalog as sc')
      .leftJoin('service_types as st', function() {
        this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
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
      is_billable: entry.billable_duration > 0,
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
    // work_date is a DATE column - convert to ISO string (YYYY-MM-DD)
    work_date: entry.work_date instanceof Date
      ? entry.work_date.toISOString().slice(0, 10)
      : (typeof entry.work_date === 'string' ? entry.work_date.slice(0, 10) : undefined),
    workItem: workItemMap.get(entry.work_item_id),
  }));
});

export const saveTimeEntry = withAuth(async (
  user,
  { tenant },
  timeEntry: Omit<ITimeEntry, 'tenant'>
): Promise<ITimeEntryWithWorkItem> => {
  const {knex: db} = await createTenantKnex();

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

  const actorUserId = user.user_id;
  let timeEntryUserId = validatedTimeEntry.user_id;

  try {
    if (validatedTimeEntry.entry_id) {
      const existing = await db('time_entries')
        .where({ entry_id: validatedTimeEntry.entry_id, tenant })
        .select('user_id')
        .first();

      if (!existing) {
        throw new Error(`Original time entry with ID ${validatedTimeEntry.entry_id} not found for update.`);
      }

      timeEntryUserId = existing.user_id;
    }

    if (validatedTimeEntry.work_item_type === 'ticket') {
      const ticket = await db('tickets')
        .select('ticket_id', 'master_ticket_id')
        .where({ tenant, ticket_id: validatedTimeEntry.work_item_id })
        .first();
      if (ticket?.master_ticket_id) {
        throw new Error('This ticket is bundled; time entries must be added on the master ticket.');
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
    } = timeEntry;

    const userTimeZone = await resolveUserTimeZone(db, tenant, timeEntryUserId);
    const { work_date, work_timezone } = computeWorkDateFields(start_time, userTimeZone);

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
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
      start_time,
      end_time,
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
      tenant: tenant as string,
      updated_at: new Date().toISOString()
    };

    // Log the cleaned entry for debugging
    console.log('Cleaned entry data:', cleanedEntry);

    let resultingEntry: ITimeEntry | null = null;

    // If no contract line ID is provided, try to determine the default one
    if (!contract_line_id && service_id) {
      try {
        const defaultPlanId = await determineDefaultContractLine(
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
              .first('projects.client_id')).client_id
            : work_item_type === 'ticket' ?
              (await db('tickets')
                .where({ ticket_id: work_item_id, tenant })
                .first('client_id')).client_id
              : work_item_type === 'interaction' ?
                (await db('interactions')
                  .where({ 
                    interaction_id: work_item_id, 
                    tenant
                  })
                  .first('client_id'))?.client_id
                : null,
          service_id
        );

        if (defaultPlanId) {
          cleanedEntry.contract_line_id = defaultPlanId;
        }
      } catch (error) {
        console.error('Error determining default contract line:', error);
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

        // Update existing entry - exclude tenant from SET clause (partition key cannot be modified)
        const { tenant: _tenant, user_id: _user_id, ...updateData } = cleanedEntry;
        const [updated] = await trx('time_entries')
          .where({ entry_id, tenant }) // Ensure tenant match
          .update(updateData)
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
                this.where('assigned_to', timeEntryUserId)
                  .orWhere('additional_user_id', timeEntryUserId);
              })
              .first();

            // If task already has an assignee and it's not the current user
            if (task.assigned_to && task.assigned_to !== timeEntryUserId) {
              // Only add as additional user if not already in resources
              if (!existingResource) {
                await trx('task_resources').insert({
                  task_id: work_item_id,
                  assigned_to: task.assigned_to,
                  additional_user_id: timeEntryUserId,
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
                  assigned_to: timeEntryUserId,
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
              this.where('assigned_to', timeEntryUserId)
                .orWhere('additional_user_id', timeEntryUserId);
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
              if (ticket.assigned_to && ticket.assigned_to !== timeEntryUserId) {
                await trx('ticket_resources').insert({
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
                await trx('tickets')
                  .where({
                    ticket_id: work_item_id,
                    tenant,
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
      // Check if billable based on duration > 0
      if (resultingEntry && resultingEntry.service_id && (resultingEntry.billable_duration || 0) > 0) {
        // Ensure work_item_id and work_item_type exist and call helper
        let clientId: string | null = null;
        if (resultingEntry.work_item_id && resultingEntry.work_item_type) {
            // Now TypeScript knows both are strings here
            clientId = await getClientIdForWorkItem(trx, tenant, resultingEntry.work_item_id as string, resultingEntry.work_item_type as string);
        }
        const currentPlanId = resultingEntry.contract_line_id; // Use the plan ID associated with the entry

        if (clientId && currentPlanId && resultingEntry.service_id) {
          const overlayConfig = await trx('contract_line_service_configuration')
            .where({
              tenant,
              contract_line_id: currentPlanId,
              service_id: resultingEntry.service_id,
              configuration_type: 'Bucket'
            })
            .first('config_id');

          if (overlayConfig) {
            console.log(`Time entry ${resultingEntry.entry_id} linked to bucket overlay on contract line ${currentPlanId}. Updating usage.`);

            const newDuration = resultingEntry.billable_duration || 0;
            // Calculate delta in MINUTES first
            const minutesDelta = newDuration - oldDuration; // oldDuration is 0 for inserts

            // Pass delta in MINUTES to bucket usage service
            if (minutesDelta !== 0) {
              try {
                const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
                  trx,
                  clientId,
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
             console.log(`Time entry ${resultingEntry.entry_id} service/plan has no bucket overlay or plan not found.`);
          }
        } else {
           console.log(`Could not determine client ID or contract line for time entry ${resultingEntry.entry_id}, skipping bucket update.`);
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
          is_billable: entry.billable_duration > 0,
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
          is_billable: entry.billable_duration > 0
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
        const [interaction] = await db('interactions')
          .where({
            'interactions.interaction_id': entry.work_item_id,
            'interactions.tenant': tenant
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
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to save time entry');
  }
});

export const deleteTimeEntry = withAuth(async (
  user,
  { tenant },
  entryId: string
): Promise<void> => {
  const {knex: db} = await createTenantKnex();

  // Check permission for time entry deletion
  if (!await hasPermission(user, 'timeentry', 'delete', db)) {
    throw new Error('Permission denied: Cannot delete time entries');
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
        let clientId: string | null = null;
        if (timeEntry.work_item_id && timeEntry.work_item_type) {
            clientId = await getClientIdForWorkItem(trx, tenant, timeEntry.work_item_id as string, timeEntry.work_item_type as string);
        }
        const currentPlanId = timeEntry.contract_line_id;

        if (clientId && currentPlanId && timeEntry.service_id) {
          const overlayConfig = await trx('contract_line_service_configuration')
            .where({
              tenant,
              contract_line_id: currentPlanId,
              service_id: timeEntry.service_id,
              configuration_type: 'Bucket'
            })
            .first('config_id');

          if (overlayConfig) {
            console.log(`Time entry ${entryId} linked to bucket overlay on contract line ${currentPlanId}. Decrementing usage.`);
            const minutesDelta = -(timeEntry.billable_duration || 0); // Negative delta

            if (minutesDelta !== 0) {
              try {
                const bucketUsageRecord = await findOrCreateCurrentBucketUsageRecord(
                  trx,
                  clientId,
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
): Promise<ITimeEntryWithWorkItem | null> => {
  const { knex: db } = await createTenantKnex();

  // Check permission for time entry reading
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read time entries');
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
            is_billable: entry.billable_duration > 0,
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
            is_billable: entry.billable_duration > 0
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
          const [interaction] = await db('interactions')
            .where({
              'interactions.interaction_id': entry.work_item_id,
              'interactions.tenant': tenant
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
});
