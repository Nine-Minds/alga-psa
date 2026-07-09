// @ts-nocheck
// TODO: Model argument count issues
'use server';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { IWorkItem, IExtendedWorkItem, WorkItemType } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import User from '@alga-psa/db/models/user';
import { parseWorkItemStatusNameFilterValue } from '@alga-psa/reference-data/actions';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export interface BaseSearchOptions {
  searchTerm?: string;
  type?: WorkItemType | 'all';
  sortBy?: 'name' | 'type';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
  assignedTo?: string;
  assignedToMe?: boolean;
  clientId?: string;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
  availableWorkItemIds?: string[];
  workItemId?: string;
  statusFilter?: string;
}

export interface DispatchSearchOptions extends BaseSearchOptions {
  filterUnscheduled?: boolean;
}

export interface PickerSearchOptions extends BaseSearchOptions {}

interface SearchResult {
  items: Omit<IExtendedWorkItem, "tenant">[];
  total: number;
}

export type WorkItemActionError = ActionMessageError | ActionPermissionError;
type WorkItemActionResult<T> = T | WorkItemActionError;

const supportedWorkItemTypes = new Set<WorkItemType>([
  'ticket',
  'project_task',
  'ad_hoc',
  'interaction',
  'appointment_request',
]);

function workItemActionErrorFrom(error: unknown): WorkItemActionError | null {
  if (isActionMessageError(error) || isActionPermissionError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message;

    if (
      message.includes('Permission denied:') ||
      message.includes('Access denied:') ||
      message.includes('User not authenticated')
    ) {
      return permissionError(message);
    }

    if (message === 'Start time and end time are required for ad-hoc entries') {
      return actionError('Start time and end time are required for ad-hoc entries.');
    }

    if (message.startsWith('Unsupported work item type:')) {
      return actionError('That work item type is not supported for scheduling.');
    }

    if (message.includes('not found in tenant')) {
      return actionError('The selected schedule entry or user is no longer available. Please refresh and try again.');
    }

    if (message.includes('Validation failed')) {
      return actionError(message.replace(/^Validation failed:\s*/, ''));
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected work item is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required schedule field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected work item, schedule entry, or assignee is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('That schedule entry already exists. Please refresh and try again.');
  }

  return null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeWorkItemIdsForUuidColumns(workItemIds?: string[]): string[] {
  return (workItemIds ?? []).filter((workItemId) => UUID_PATTERN.test(workItemId));
}

// ==================================
// Function for Technician Dispatch
// ==================================
export const searchDispatchWorkItems = withAuth(async (
  user,
  { tenant },
  options: DispatchSearchOptions
): Promise<WorkItemActionResult<SearchResult>> => {
  try {
    const {knex: db} = await createTenantKnex();
    const tenantScopedDb = tenantDb(db, tenant);
    const searchTerm = options.searchTerm || '';
    const statusFilter = options.statusFilter || 'all_open';
    const filterUnscheduledOption = options.filterUnscheduled;
    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const offset = (page - 1) * pageSize;

    let ticketsQuery = tenantScopedDb.table('tickets as t')
      .whereNotIn('t.ticket_id', options.availableWorkItemIds || [])
      .leftJoin(
        tenantScopedDb.table('ticket_resources')
          .select('ticket_id')
          .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
          .groupBy('ticket_id', 'tenant')
          .as('tr'),
        function() {
          this.on('t.ticket_id', '=', 'tr.ticket_id');
        }
      )
       .whereILike('t.title', db.raw('?', [`%${searchTerm}%`]))
       .distinctOn('t.ticket_id')
       .modify((queryBuilder) => {
         if (statusFilter === 'all_open') {
           queryBuilder.where('s.is_closed', false);
         } else if (statusFilter === 'all_closed') {
           queryBuilder.where('s.is_closed', true);
         } else if (statusFilter && statusFilter !== 'all_open' && statusFilter !== 'all_closed') {
           const statusName = parseWorkItemStatusNameFilterValue(statusFilter);
           if (statusName !== null) {
             queryBuilder.where('s.name', statusName);
           } else {
             queryBuilder.where('t.status_id', statusFilter);
           }
         }

         if (filterUnscheduledOption === true) {
           queryBuilder.whereNull('se_ticket.entry_id');
         } else if (filterUnscheduledOption === false) {
           queryBuilder.whereNotNull('se_ticket.entry_id');
         }

         if (options.assignedTo) {
           queryBuilder.where(function() {
             this.where('t.assigned_to', options.assignedTo)
                 .orWhereRaw('? = ANY(tr.additional_user_ids)', [options.assignedTo]);
           });
         }

         if (options.clientId) {
           queryBuilder.where('t.client_id', options.clientId);
         }

         const startDate = options.dateRange?.start;
         const endDate = options.dateRange?.end;
         if (startDate) {
           queryBuilder.where(function() {
             this.whereNull('t.closed_at')
                 .orWhere('t.closed_at', '>=', db.raw('?', [startDate]));
           });
         }
         if (endDate) {
           queryBuilder.where(function() {
             this.whereNull('t.closed_at')
                 .orWhere('t.closed_at', '<=', db.raw('?', [endDate]));
           });
         }

         if (options.workItemId) {
           queryBuilder.where('t.ticket_id', options.workItemId);
         }
       })
       .select(
         't.ticket_id as work_item_id',
         't.title as name',
         db.raw("t.attributes ->> 'description' as description"),
         db.raw("'ticket' as type"),
         't.ticket_number',
         't.title',
         db.raw('NULL::text as project_name'),
         db.raw('NULL::text as phase_name'),
         db.raw('NULL::text as task_name'),
         't.client_id',
         'c.client_name as client_name',
         db.raw('NULL::timestamp with time zone as scheduled_start'),
         db.raw('NULL::timestamp with time zone as scheduled_end'),
         db.raw('t.closed_at::timestamp with time zone as due_date'),
         db.raw("u_assignee.first_name || ' ' || u_assignee.last_name as assigned_to_name"),
         db.raw('ARRAY[t.assigned_to] as assigned_user_ids'),
         'tr.additional_user_ids as additional_user_ids'
       );
    tenantScopedDb.tenantJoin(ticketsQuery, 'clients as c', 't.client_id', 'c.client_id');
    tenantScopedDb.tenantJoin(ticketsQuery, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
    tenantScopedDb.tenantJoin(ticketsQuery, 'users as u_assignee', 't.assigned_to', 'u_assignee.user_id', { type: 'left' });
    tenantScopedDb.tenantJoin(ticketsQuery, 'schedule_entries as se_ticket', 't.ticket_id', 'se_ticket.work_item_id', {
      type: 'left',
      on(join) {
        join.andOn('se_ticket.work_item_type', '=', db.raw("'ticket'"));
      },
    });

    const countQuery = ticketsQuery.clone().clearSelect().clearOrder().count('* as count').first();
    const countResult = await countQuery;
    const total = parseInt(countResult?.count as string || '0');
    if (options.sortBy === 'name') {
      ticketsQuery = ticketsQuery.orderBy([
        { column: 't.ticket_id', order: options.sortOrder || 'asc' },
        { column: 'name', order: options.sortOrder || 'asc' }
      ]);
    } else {
       ticketsQuery = ticketsQuery.orderBy('t.ticket_id', options.sortOrder || 'asc');
    }

    ticketsQuery = ticketsQuery.limit(pageSize).offset(offset);

    const results = await ticketsQuery;

    const ticketIds = results.map((item: any) => item.work_item_id);
    let allAssignedAgentIds = new Set<string>();
    results.forEach((item: any) => {
      (item.assigned_user_ids || []).forEach((id: string) => id && allAssignedAgentIds.add(id));
      (item.additional_user_ids || []).forEach((id: string) => id && allAssignedAgentIds.add(id));
    });

    const scheduledEntriesMap = new Map<string, Set<string>>();
    if (ticketIds.length > 0 && allAssignedAgentIds.size > 0) {
      const scheduledEntriesQuery = tenantScopedDb.table('schedule_entries')
        .where('work_item_type', 'ticket')
        .whereIn('work_item_id', ticketIds)
        .whereIn('sea.user_id', Array.from(allAssignedAgentIds))
        .select('schedule_entries.work_item_id', 'sea.user_id');
      tenantScopedDb.tenantJoin(
        scheduledEntriesQuery,
        'schedule_entry_assignees as sea',
        'schedule_entries.entry_id',
        'sea.entry_id',
      );
      const scheduledEntries = await scheduledEntriesQuery;

      scheduledEntries.forEach(entry => {
        if (!scheduledEntriesMap.has(entry.work_item_id)) {
          scheduledEntriesMap.set(entry.work_item_id, new Set<string>());
        }
        scheduledEntriesMap.get(entry.work_item_id)!.add(entry.user_id);
      });
    }

    const agentIdsNeedingDetails = new Set<string>();
    let workItems: Omit<IExtendedWorkItem, "tenant">[] = results.map((item: any) => {
      const assignedIds = new Set<string>([
        ...(item.assigned_user_ids || []).filter((id: string | null) => id),
        ...(item.additional_user_ids || []).filter((id: string | null) => id)
      ]);
      const scheduledAgentIds = scheduledEntriesMap.get(item.work_item_id) || new Set<string>();
      let needsDispatch = false;
      const agentsNeedingDispatchIds: string[] = [];

      for (const agentId of assignedIds) {
        if (!scheduledAgentIds.has(agentId)) {
          needsDispatch = true;
          agentsNeedingDispatchIds.push(agentId);
          agentIdsNeedingDetails.add(agentId);
        }
      }

      return {
        work_item_id: item.work_item_id,
        type: item.type,
        name: item.name,
        description: item.description,
        is_billable: true,
        ticket_number: item.ticket_number,
        title: item.title,
        project_name: item.project_name,
        phase_name: item.phase_name,
        task_name: item.task_name,
        client_name: item.client_name,
        due_date: item.due_date,
        additional_user_ids: item.additional_user_ids || [],
        assigned_user_ids: item.assigned_user_ids || [],
        needsDispatch: needsDispatch,
        agentsNeedingDispatch: needsDispatch ? agentsNeedingDispatchIds.map(id => ({ user_id: id, first_name: null, last_name: null })) : []
      };
    });

    const userDetailsMap = new Map<string, { first_name: string | null; last_name: string | null }>();
    if (agentIdsNeedingDetails.size > 0) {
      const users = await User.getMultiple(db, Array.from(agentIdsNeedingDetails));

      users.forEach((user: IUser) => {
        userDetailsMap.set(user.user_id, { first_name: user.first_name ?? null, last_name: user.last_name ?? null });
      });

      workItems = workItems.map(item => {
        if (item.needsDispatch && item.agentsNeedingDispatch) {
          item.agentsNeedingDispatch = item.agentsNeedingDispatch.map(agent => {
            const details = userDetailsMap.get(agent.user_id);
            return {
              ...agent,
              first_name: details?.first_name || null,
              last_name: details?.last_name || null,
            };
          });
        }
        return item;
      });
    }

    return {
      items: workItems,
      total
    };
  } catch (error) {
    console.error('Error searching dispatch work items:', error);
    const expected = workItemActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});


// ==================================
// Function for Work Item Picker
// ==================================
export const searchPickerWorkItems = withAuth(async (
  user,
  { tenant },
  options: PickerSearchOptions
): Promise<WorkItemActionResult<SearchResult>> => {
  try {
    const {knex: db} = await createTenantKnex();
    const tenantScopedDb = tenantDb(db, tenant);
    const searchTerm = options.searchTerm || '';
    const statusFilter = options.statusFilter || 'all_open';
    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const offset = (page - 1) * pageSize;
    const availableWorkItemIds = sanitizeWorkItemIdsForUuidColumns(options.availableWorkItemIds);

    let ticketsQuery = tenantScopedDb.table('tickets as t')
      .whereNotIn('t.ticket_id', availableWorkItemIds)
      .leftJoin(
        tenantScopedDb.table('ticket_resources')
          .select('ticket_id')
          .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
          .groupBy('ticket_id', 'tenant')
          .as('tr'),
        function() {
          this.on('t.ticket_id', '=', 'tr.ticket_id');
        }
      )
       .whereILike('t.title', db.raw('?', [`%${searchTerm}%`]))
       .distinctOn('t.ticket_id')
       .modify((queryBuilder) => {
         if (statusFilter === 'all_open') {
           queryBuilder.where('s.is_closed', false);
         } else if (statusFilter === 'all_closed') {
           queryBuilder.where('s.is_closed', true);
         } else if (statusFilter && statusFilter !== 'all_open' && statusFilter !== 'all_closed') {
           queryBuilder.where('t.status_id', statusFilter);
         }

         if (options.assignedTo) {
           queryBuilder.where(function() {
             this.where('t.assigned_to', options.assignedTo)
                 .orWhereRaw('? = ANY(tr.additional_user_ids)', [options.assignedTo]);
           });
         }

         if (options.clientId) {
           queryBuilder.where('t.client_id', options.clientId);
         }

         const startDate = options.dateRange?.start;
         const endDate = options.dateRange?.end;
         if (startDate) {
           queryBuilder.where(function() {
             this.whereNull('t.closed_at')
                 .orWhere('t.closed_at', '>=', db.raw('?', [startDate]));
           });
         }
         if (endDate) {
           queryBuilder.where(function() {
             this.whereNull('t.closed_at')
                 .orWhere('t.closed_at', '<=', db.raw('?', [endDate]));
           });
         }

         if (options.workItemId) {
           queryBuilder.where('t.ticket_id', options.workItemId);
         }
       })
       .select(
         't.ticket_id as work_item_id',
         't.title as name',
         db.raw("t.attributes ->> 'description' as description"),
         db.raw("'ticket' as type"),
         't.ticket_number',
         't.master_ticket_id as master_ticket_id',
         'mt.ticket_number as master_ticket_number',
         't.title',
         db.raw('NULL::text as project_name'),
         db.raw('NULL::text as phase_name'),
         db.raw('NULL::text as task_name'),
         't.client_id',
         'c.client_name as client_name',
         db.raw('NULL::timestamp with time zone as scheduled_start'),
         db.raw('NULL::timestamp with time zone as scheduled_end'),
         db.raw('t.closed_at::timestamp with time zone as due_date'),
         db.raw("u_assignee.first_name || ' ' || u_assignee.last_name as assigned_to_name"),
         db.raw('ARRAY[t.assigned_to] as assigned_user_ids'),
         'tr.additional_user_ids as additional_user_ids',
         db.raw('NULL::uuid as service_id')
       );
      tenantScopedDb.tenantJoin(ticketsQuery, 'clients as c', 't.client_id', 'c.client_id');
      tenantScopedDb.tenantJoin(ticketsQuery, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
      tenantScopedDb.tenantJoin(ticketsQuery, 'tickets as mt', 't.master_ticket_id', 'mt.ticket_id', { type: 'left' });
      tenantScopedDb.tenantJoin(ticketsQuery, 'users as u_assignee', 't.assigned_to', 'u_assignee.user_id', { type: 'left' });

      let projectTasksQuery = tenantScopedDb.table('project_tasks as pt')
      .whereNotIn('pt.task_id', availableWorkItemIds)
      .leftJoin(
        tenantScopedDb.table('task_resources')
          .select('task_id')
          .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
          .groupBy('task_id', 'tenant')
          .as('tr'),
        function() {
          this.on('pt.task_id', '=', 'tr.task_id');
        }
      )
       .whereILike('pt.task_name', db.raw('?', [`%${searchTerm}%`]))
       .distinctOn('pt.task_id')
       .modify((queryBuilder) => {
         if (statusFilter === 'all_open') {
            queryBuilder.where(function() {
             this.where(function() {
               this.where('psm.is_standard', false).andWhere('s_custom.is_closed', false);
             }).orWhere(function() {
               this.where('psm.is_standard', true).andWhere('s_standard.is_closed', false);
             });
           });
         } else if (statusFilter === 'all_closed') {
            queryBuilder.where(function() {
             this.where(function() {
               this.where('psm.is_standard', false).andWhere('s_custom.is_closed', true);
             }).orWhere(function() {
               this.where('psm.is_standard', true).andWhere('s_standard.is_closed', true);
             });
           });
         } else if (statusFilter && statusFilter !== 'all_open' && statusFilter !== 'all_closed') {
            queryBuilder.where(function() {
                this.where(function() {
                    this.where('psm.is_standard', false).andWhere('psm.status_id', statusFilter);
                }).orWhere(function() {
                    this.where('psm.is_standard', true).andWhere('psm.standard_status_id', statusFilter);
                });
            });
         }

         if (!options.includeInactive) {
          queryBuilder.where('p.is_inactive', false);
        }

         if (options.assignedTo) {
           queryBuilder.where(function() {
             this.where('pt.assigned_to', options.assignedTo)
                 .orWhereRaw('? = ANY(tr.additional_user_ids)', [options.assignedTo]);
           });
         }

         if (options.clientId) {
           queryBuilder.where('p.client_id', options.clientId);
         }

         const startDate = options.dateRange?.start;
         const endDate = options.dateRange?.end;
         if (startDate) {
           queryBuilder.where(function() {
             this.whereNull('pt.due_date')
                 .orWhere('pt.due_date', '>=', db.raw('?', [startDate]));
           });
         }
         if (endDate) {
           queryBuilder.where(function() {
             this.whereNull('pt.due_date')
                 .orWhere('pt.due_date', '<=', db.raw('?', [endDate]));
           });
         }

         if (options.workItemId) {
           queryBuilder.whereRaw('1 = 0');
         }
       })
       .select(
         'pt.task_id as work_item_id',
         'pt.task_name as name',
         'pt.description',
         db.raw("'project_task' as type"),
         db.raw('NULL::text as ticket_number'),
         db.raw('NULL::uuid as master_ticket_id'),
         db.raw('NULL::text as master_ticket_number'),
         db.raw('NULL::text as title'),
         'p.project_name',
         'pp.phase_name',
         'pt.task_name',
         'p.client_id',
         'c.client_name as client_name',
         db.raw('NULL::timestamp with time zone as scheduled_start'),
         db.raw('NULL::timestamp with time zone as scheduled_end'),
         db.raw('pt.due_date::timestamp with time zone as due_date'),
         db.raw("u_assignee.first_name || ' ' || u_assignee.last_name as assigned_to_name"),
         db.raw('ARRAY[pt.assigned_to] as assigned_user_ids'),
         'tr.additional_user_ids as additional_user_ids',
         'pt.service_id'
       );
      tenantScopedDb.tenantJoin(projectTasksQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
      tenantScopedDb.tenantJoin(projectTasksQuery, 'projects as p', 'pp.project_id', 'p.project_id');
      tenantScopedDb.tenantJoin(projectTasksQuery, 'clients as c', 'p.client_id', 'c.client_id');
      tenantScopedDb.tenantJoin(projectTasksQuery, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id', { type: 'left' });
      tenantScopedDb.tenantJoin(projectTasksQuery, 'statuses as s_custom', 'psm.status_id', 's_custom.status_id', {
        type: 'left',
        on(join) {
          join.andOn('psm.is_standard', '=', db.raw('false'));
        },
      });
      tenantScopedDb.tenantJoin(projectTasksQuery, 'standard_statuses as s_standard', 'psm.standard_status_id', 's_standard.standard_status_id', {
        type: 'left',
        on(join) {
          join.andOn('psm.is_standard', '=', db.raw('true'));
        },
      });
      tenantScopedDb.tenantJoin(projectTasksQuery, 'users as u_assignee', 'pt.assigned_to', 'u_assignee.user_id', { type: 'left' });


    let adHocQuery;
    if (!options.type || options.type === 'all' || options.type === 'ad_hoc') {
      adHocQuery = tenantScopedDb.table('schedule_entries as se')
        .whereNotIn('se.entry_id', availableWorkItemIds)
        .where('work_item_type', 'ad_hoc')
        .whereILike('title', db.raw('?', [`%${searchTerm}%`]))
        .leftJoin(
          tenantScopedDb.table('schedule_entry_assignees')
            .select('entry_id')
            .select(db.raw('array_agg(distinct user_id ORDER BY user_id) as assigned_user_ids'))
            .select(db.raw('(array_agg(distinct user_id ORDER BY user_id))[1] as first_assigned_user_id'))
            .groupBy('entry_id', 'tenant')
            .as('sea'),
          function() {
            this.on('se.entry_id', '=', 'sea.entry_id');
          }
        )
        .distinctOn('se.entry_id')
        .modify((queryBuilder) => {
          if (options.assignedTo) {
            queryBuilder.whereRaw('? = ANY(sea.assigned_user_ids)', [options.assignedTo]);
          }

          // Filter by date range if provided
          const startDate = options.dateRange?.start;
          const endDate = options.dateRange?.end;
          if (startDate) {
            queryBuilder.where('se.scheduled_start', '>=', db.raw('?', [startDate]));
          }
          if (endDate) {
            queryBuilder.where('se.scheduled_end', '<=', db.raw('?', [endDate]));
          }

          if (options.workItemId) {
            queryBuilder.whereRaw('1 = 0');
          }
        })
        .select(
          'se.entry_id as work_item_id',
          'se.title as name',
          'se.notes as description',
          db.raw("'ad_hoc' as type"),
          db.raw('NULL::text as ticket_number'),
          db.raw('NULL::uuid as master_ticket_id'),
          db.raw('NULL::text as master_ticket_number'),
          'se.title',
          db.raw('NULL::text as project_name'),
          db.raw('NULL::text as phase_name'),
          db.raw('NULL::text as task_name'),
          db.raw('NULL::uuid as client_id'),
          db.raw('NULL::text as client_name'),
          'se.scheduled_start',
          'se.scheduled_end',
          db.raw('NULL::timestamp with time zone as due_date'),
          db.raw("u_adhoc_assignee.first_name || ' ' || u_adhoc_assignee.last_name as assigned_to_name"),
          'sea.assigned_user_ids as assigned_user_ids',
          db.raw('NULL::uuid[] as additional_user_ids'),
          db.raw('NULL::uuid as service_id')
        );
      tenantScopedDb.tenantJoin(adHocQuery, 'users as u_adhoc_assignee', 'sea.first_assigned_user_id', 'u_adhoc_assignee.user_id', {
        type: 'left',
        rootTenantColumn: 'se.tenant',
      });
    }

    // Add interactions query
    let interactionsQuery;
    if (!options.type || options.type === 'all' || options.type === 'interaction') {
      interactionsQuery = tenantScopedDb.table('interactions as i')
        .whereNotIn('i.interaction_id', availableWorkItemIds)
        .whereILike('i.title', db.raw('?', [`%${searchTerm}%`]))
        .select(
          'i.interaction_id as work_item_id',
          'i.title as name',
          db.raw("'' as description"), // Don't copy interaction notes to time entry
          db.raw("'interaction' as type"),
          db.raw('NULL::text as ticket_number'),
          db.raw('NULL::uuid as master_ticket_id'),
          db.raw('NULL::text as master_ticket_number'),
          'i.title',
          db.raw('NULL::text as project_name'),
          db.raw('NULL::text as phase_name'),
          db.raw('NULL::text as task_name'),
          'i.client_id',
          'c.client_name',
          db.raw('NULL::timestamp with time zone as scheduled_start'),
          db.raw('NULL::timestamp with time zone as scheduled_end'),
          db.raw('NULL::timestamp with time zone as due_date'),
          db.raw("u_interaction_assignee.first_name || ' ' || u_interaction_assignee.last_name as assigned_to_name"),
          db.raw('ARRAY[i.user_id] as assigned_user_ids'),
          db.raw('ARRAY[]::uuid[] as additional_user_ids'),
          db.raw('NULL::uuid as service_id')
        );
      tenantScopedDb.tenantJoin(interactionsQuery, 'clients as c', 'i.client_id', 'c.client_id', { type: 'left' });
      tenantScopedDb.tenantJoin(interactionsQuery, 'interaction_types as it', 'i.type_id', 'it.type_id', { type: 'left' });
      tenantScopedDb.tenantJoin(interactionsQuery, 'users as u_interaction_assignee', 'i.user_id', 'u_interaction_assignee.user_id', { type: 'left' });

      // Apply filters
      if (options.assignedTo) {
        interactionsQuery.where('i.user_id', options.assignedTo);
      }

      if (options.clientId) {
        interactionsQuery.where('c.client_id', options.clientId);
      }

      if (options.dateRange?.start || options.dateRange?.end) {
        if (options.dateRange.start) {
          interactionsQuery.where('i.interaction_date', '>=', options.dateRange.start);
        }
        if (options.dateRange.end) {
          interactionsQuery.where('i.interaction_date', '<=', options.dateRange.end);
        }
      }
    }

    let queriesToUnion: any[] = [];
    if (!options.type || options.type === 'all' || options.type === 'ticket') {
        queriesToUnion.push(ticketsQuery);
    }
    if (!options.type || options.type === 'all' || options.type === 'project_task') {
        queriesToUnion.push(projectTasksQuery);
    }
    if (adHocQuery && (!options.type || options.type === 'all' || options.type === 'ad_hoc')) {
        queriesToUnion.push(adHocQuery);
    }
    if (interactionsQuery && (!options.type || options.type === 'all' || options.type === 'interaction')) {
        queriesToUnion.push(interactionsQuery);
    }

    let query = db.union(queriesToUnion, true);

    const countPromises: Array<Promise<any>> = [];
    if (!options.type || options.type === 'all' || options.type === 'ticket') {
        countPromises.push(ticketsQuery.clone().clearSelect().clearOrder().count('* as count').first());
    }
    if (!options.type || options.type === 'all' || options.type === 'project_task') {
        countPromises.push(projectTasksQuery.clone().clearSelect().clearOrder().count('* as count').first());
    }
    if (adHocQuery && (!options.type || options.type === 'all' || options.type === 'ad_hoc')) {
        countPromises.push(adHocQuery.clone().clearSelect().clearOrder().count('* as count').first());
    }
    if (interactionsQuery && (!options.type || options.type === 'all' || options.type === 'interaction')) {
        countPromises.push(interactionsQuery.clone().clearSelect().clearOrder().count('* as count').first());
    }

    const countResults = await Promise.all(countPromises);
    let total = countResults.reduce((sum: number, result: any) => sum + parseInt(result?.count as string || '0'), 0);


    // Apply sorting to the main query
    if (options.sortBy) {
      const sortColumn = options.sortBy === 'name' ? 'name' : 'type';
      query = db.from(query.as('combined_items'))
                .orderBy(sortColumn, options.sortOrder || 'asc');
    }

    // Apply pagination
    query = query.limit(pageSize).offset(offset);

    // Execute query for items
    const results = await query;

    // Fetch interaction types for interactions
    const interactionIds = results
      .filter((item: any) => item.type === 'interaction')
      .map((item: any) => item.work_item_id);

    let interactionTypesMap = new Map<string, string>();
    if (interactionIds.length > 0) {
      const interactionTypesQuery = tenantScopedDb.table('interactions as i')
        .whereIn('i.interaction_id', interactionIds)
        .select('i.interaction_id', 'it.type_name');
      tenantScopedDb.tenantJoin(interactionTypesQuery, 'interaction_types as it', 'i.type_id', 'it.type_id', { type: 'left' });
      const interactionTypes = await interactionTypesQuery;

      interactionTypes.forEach((item: any) => {
        interactionTypesMap.set(item.interaction_id, item.type_name);
      });
    }


    // Format results
    const workItems = results.map((item: any): Omit<IExtendedWorkItem, "tenant"> => {

      const result: Omit<IExtendedWorkItem, "tenant"> = {
        work_item_id: item.work_item_id,
        type: item.type,
        name: item.name,
        description: item.description,
        is_billable: true,
        ticket_number: item.ticket_number,
        master_ticket_id: item.master_ticket_id,
        master_ticket_number: item.master_ticket_number,
        title: item.title,
        project_name: item.project_name,
        phase_name: item.phase_name,
        task_name: item.task_name,
        client_name: item.client_name,
        assigned_to_name: item.assigned_to_name,
        due_date: item.due_date,
        additional_user_ids: item.additional_user_ids || [],
        assigned_user_ids: item.assigned_user_ids || [],
        scheduled_start: item.scheduled_start,
        scheduled_end: item.scheduled_end,
        service_id: item.service_id
      };

      // Add interaction type if it's an interaction
      if (item.type === 'interaction' && interactionTypesMap.has(item.work_item_id)) {
        result.interaction_type = interactionTypesMap.get(item.work_item_id);
      }

      return result;
    });

    return {
      items: workItems,
      total
    };
  } catch (error) {
    console.error('Error searching picker work items:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Error message:', error instanceof Error ? error.message : error);
    const expected = workItemActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const createWorkItem = withAuth(async (
  user,
  { tenant },
  item: Omit<IWorkItem, "work_item_id">
): Promise<WorkItemActionResult<Omit<IExtendedWorkItem, "tenant">>> => {
  try {
    const {knex: db} = await createTenantKnex();

    if (!item.startTime || !item.endTime) {
      throw new Error('Start time and end time are required for ad-hoc entries');
    }

    // Create schedule entry with current user assigned
    const scheduleEntry = await ScheduleEntry.create(db, tenant, {
      title: item.title || 'Ad-hoc Entry',
      notes: item.description,
      scheduled_start: item.startTime,
      scheduled_end: item.endTime,
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      work_item_id: null,
      assigned_user_ids: []  // This will be populated by the model
    }, {
      assignedUserIds: [user.user_id],
      assignedByUserId: user.user_id
    });

    // For ad-hoc entries, use title as name if provided, otherwise use a default name
    const name = item.title || 'Ad-hoc Entry';

    return {
      work_item_id: scheduleEntry.entry_id,
      type: 'ad_hoc',
      name: name,
      title: item.title,
      description: item.description,
      is_billable: item.is_billable !== undefined ? item.is_billable : true,
      scheduled_start: item.startTime.toISOString(),
      scheduled_end: item.endTime.toISOString()
    };
  } catch (error) {
    console.error('Error creating work item:', error);
    const expected = workItemActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const getWorkItemById = withAuth(async (
  user,
  { tenant },
  workItemId: string,
  workItemType: WorkItemType
): Promise<WorkItemActionResult<Omit<IExtendedWorkItem, "tenant"> | null>> => {
  try {
    if (!supportedWorkItemTypes.has(workItemType)) {
      throw new Error(`Unsupported work item type: ${workItemType}`);
    }

    const {knex: db} = await createTenantKnex();
    const tenantScopedDb = tenantDb(db, tenant);
    let workItem;

    if (workItemType === 'ticket') {
      const ticketQuery = tenantScopedDb.table('tickets as t')
        .where({
          't.ticket_id': workItemId,
        })
        .leftJoin(
          tenantScopedDb.table('ticket_resources')
            .select('ticket_id')
            .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
            .groupBy('ticket_id', 'tenant')
            .as('tr'),
          function() {
            this.on('t.ticket_id', '=', 'tr.ticket_id');
          }
        )
        .select(
          't.ticket_id as work_item_id',
          't.title as name',
          't.url as description',
          db.raw("'ticket' as type"),
          't.ticket_number',
          't.title',
          't.client_id',
          'co.client_name',
          's.name as status_name',
          'ch.board_name as board_name',
          db.raw("u_assignee.first_name || ' ' || u_assignee.last_name as assigned_to_name"),
          'ct.full_name as contact_name',
          db.raw('NULL::text as project_name'),
          db.raw('NULL::text as phase_name'),
          db.raw('NULL::text as task_name'),
          db.raw('ARRAY[t.assigned_to] as assigned_user_ids'),
          'tr.additional_user_ids as additional_user_ids'
        );
      tenantScopedDb.tenantJoin(ticketQuery, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
      tenantScopedDb.tenantJoin(ticketQuery, 'boards as ch', 't.board_id', 'ch.board_id', { type: 'left' });
      tenantScopedDb.tenantJoin(ticketQuery, 'users as u_assignee', 't.assigned_to', 'u_assignee.user_id', { type: 'left' });
      tenantScopedDb.tenantJoin(ticketQuery, 'contacts as ct', 't.contact_name_id', 'ct.contact_name_id', { type: 'left' });
      tenantScopedDb.tenantJoin(ticketQuery, 'clients as co', 't.client_id', 'co.client_id', { type: 'left' });
      workItem = await ticketQuery.first();
    } else if (workItemType === 'project_task') {
      const projectTaskQuery = tenantScopedDb.table('project_tasks as pt')
        .where({
          'pt.task_id': workItemId,
        })
        .leftJoin(
          tenantScopedDb.table('task_resources')
            .select('task_id')
            .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
            .groupBy('task_id', 'tenant')
            .as('tr'),
          function() {
            this.on('pt.task_id', '=', 'tr.task_id');
          }
        )
        // Removed groupBy for project tasks as well
        .select(
          'pt.task_id as work_item_id',
          'pt.task_name as name',
          'pt.description',
          db.raw("'project_task' as type"),
          db.raw('NULL::text as ticket_number'),
          db.raw('NULL::text as title'),
          'p.project_name',
          'pp.phase_name',
          'pt.task_name',
          db.raw('ARRAY[pt.assigned_to] as assigned_user_ids'),
          'tr.additional_user_ids as additional_user_ids'
        );
      tenantScopedDb.tenantJoin(projectTaskQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
      tenantScopedDb.tenantJoin(projectTaskQuery, 'projects as p', 'pp.project_id', 'p.project_id');
      workItem = await projectTaskQuery.first();
    } else if (workItemType === 'ad_hoc') {
      workItem = await tenantScopedDb.table('schedule_entries as se')
        .where({
          'se.entry_id': workItemId,
        })
        .leftJoin(
          tenantScopedDb.table('schedule_entry_assignees')
            .select('entry_id')
            .select(db.raw('array_agg(distinct user_id) as assigned_user_ids'))
            .groupBy('entry_id', 'tenant')
            .as('sea'),
          function() {
            this.on('se.entry_id', '=', 'sea.entry_id');
          }
        )
        .groupBy('se.entry_id', 'se.title', 'se.notes', 'se.scheduled_start', 'se.scheduled_end', 'sea.assigned_user_ids', 'se.tenant')
        .select(
          'se.entry_id as work_item_id',
          'se.title as name',
          'se.notes as description',
          db.raw("'ad_hoc' as type"),
          db.raw('NULL::text as ticket_number'),
          'se.title',
          db.raw('NULL::text as project_name'),
          db.raw('NULL::text as phase_name'),
          db.raw('NULL::text as task_name'),
          'se.scheduled_start',
          'se.scheduled_end',
          'sea.assigned_user_ids',
          db.raw('NULL::uuid[] as additional_user_ids')
        )
        .first();
    } else if (workItemType === 'interaction') {
      const interactionQuery = tenantScopedDb.table('interactions as i')
        .where({
          'i.interaction_id': workItemId,
        })
        .select(
          'i.interaction_id as work_item_id',
          'i.title as name',
          db.raw("'' as description"), // Don't copy interaction notes to time entry
          db.raw("'interaction' as type"),
          db.raw('NULL::text as ticket_number'),
          'i.title',
          db.raw('NULL::text as project_name'),
          db.raw('NULL::text as phase_name'),
          db.raw('NULL::text as task_name'),
          'i.client_id',
          'c.client_name',
          's.name as status_name',
          'it.type_name as interaction_type',
          'ct.full_name as contact_name',
          db.raw('ARRAY[]::uuid[] as assigned_user_ids'),
          db.raw('ARRAY[]::uuid[] as additional_user_ids')
        );
      tenantScopedDb.tenantJoin(interactionQuery, 'clients as c', 'i.client_id', 'c.client_id', { type: 'left' });
      tenantScopedDb.tenantJoin(interactionQuery, 'interaction_types as it', 'i.type_id', 'it.type_id', { type: 'left' });
      tenantScopedDb.tenantJoin(interactionQuery, 'statuses as s', 'i.status_id', 's.status_id', { type: 'left' });
      tenantScopedDb.tenantJoin(interactionQuery, 'contacts as ct', 'i.contact_name_id', 'ct.contact_name_id', { type: 'left' });
      workItem = await interactionQuery.first();
    } else if (workItemType === 'appointment_request') {
      const appointmentRequestQuery = tenantScopedDb.table('appointment_requests as ar')
        .where({
          'ar.appointment_request_id': workItemId,
        })
        .select(
          'ar.appointment_request_id as work_item_id',
          db.raw("COALESCE(sc.service_name, 'Appointment Request') as name"),
          'ar.description',
          db.raw("'appointment_request' as type"),
          db.raw('NULL::text as ticket_number'),
          db.raw("COALESCE(sc.service_name, 'Appointment Request') as title"),
          db.raw('NULL::text as project_name'),
          db.raw('NULL::text as phase_name'),
          db.raw('NULL::text as task_name'),
          'ar.client_id',
          'c.client_name',
          db.raw("ar.status as status_name"),
          db.raw('NULL::text as board_name'),
          db.raw('NULL::text as assigned_to_name'),
          'ct.full_name as contact_name',
          db.raw('ARRAY[]::uuid[] as assigned_user_ids'),
          db.raw('ARRAY[]::uuid[] as additional_user_ids')
        );
      tenantScopedDb.tenantJoin(appointmentRequestQuery, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
      tenantScopedDb.tenantJoin(appointmentRequestQuery, 'clients as c', 'ar.client_id', 'c.client_id', { type: 'left' });
      tenantScopedDb.tenantJoin(appointmentRequestQuery, 'contacts as ct', 'ar.contact_id', 'ct.contact_name_id', { type: 'left' });
      workItem = await appointmentRequestQuery.first();
    }

    if (workItem) {
      const result: Omit<IExtendedWorkItem, "tenant"> = {
        work_item_id: workItem.work_item_id,
        type: workItem.type,
        name: workItem.name,
        description: workItem.description,
        is_billable: true,
        ticket_number: workItem.ticket_number,
        title: workItem.title,
        project_name: workItem.project_name,
        phase_name: workItem.phase_name,
        task_name: workItem.task_name,
        client_id: workItem.client_id,
        client_name: workItem.client_name,
        status_name: workItem.status_name,
        board_name: workItem.board_name,
        assigned_to_name: workItem.assigned_to_name,
        contact_name: workItem.contact_name,
        additional_user_ids: workItem.additional_user_ids || [],
        assigned_user_ids: workItem.assigned_user_ids || []
      };

      // Add scheduled times for ad-hoc items
      if (workItem.type === 'ad_hoc' && workItem.scheduled_start && workItem.scheduled_end) {
        result.scheduled_start = workItem.scheduled_start;
        result.scheduled_end = workItem.scheduled_end;
      }

      // Add interaction type for interactions
      if (workItem.type === 'interaction' && workItem.interaction_type) {
        result.interaction_type = workItem.interaction_type;
      }

      return result;
    }

    return null;
  } catch (error) {
    console.error('Error fetching work item by ID:', error);
    const expected = workItemActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
