// @ts-nocheck
// TODO: Model argument count issues
'use server';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { IWorkItem, IExtendedWorkItem, WorkItemType } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import ScheduleEntry from '../models/scheduleEntry';
import User from '@alga-psa/db/models/user';

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

export interface PickerSearchOptions extends BaseSearchOptions {
  isTimesheet?: boolean;
}

interface SearchResult {
  items: Omit<IExtendedWorkItem, "tenant">[];
  total: number;
}

// ==================================
// Function for Technician Dispatch
// ==================================
export const searchDispatchWorkItems = withAuth(async (
  user,
  { tenant },
  options: DispatchSearchOptions
): Promise<SearchResult> => {
  try {
    const {knex: db} = await createTenantKnex();
    const searchTerm = options.searchTerm || '';
    const statusFilter = options.statusFilter || 'all_open';
    const filterUnscheduledOption = options.filterUnscheduled;
    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const offset = (page - 1) * pageSize;

    let ticketsQuery = db('tickets as t')
      .whereNotIn('t.ticket_id', options.availableWorkItemIds || [])
      .where('t.tenant', tenant)
      .innerJoin('clients as c', function() {
        this.on('t.client_id', '=', 'c.client_id')
            .andOn('t.tenant', '=', 'c.tenant');
      })
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', '=', 's.status_id')
            .andOn('t.tenant', '=', 's.tenant');
      })
      .leftJoin(
        db('ticket_resources')
          .where('tenant', tenant)
          .select('ticket_id')
          .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
          .groupBy('ticket_id', 'tenant')
          .as('tr'),
        function() {
          this.on('t.ticket_id', '=', 'tr.ticket_id')
              .andOn('t.tenant', '=', db.raw('?', [tenant]));
        }
      )
      .leftJoin('users as u_assignee', function() {
        this.on('t.assigned_to', '=', 'u_assignee.user_id')
            .andOn('t.tenant', '=', 'u_assignee.tenant');
      })
       .leftJoin('schedule_entries as se_ticket', function() {
         this.on('t.ticket_id', '=', 'se_ticket.work_item_id')
             .andOn('t.tenant', '=', 'se_ticket.tenant')
             .andOn('se_ticket.work_item_type', '=', db.raw("'ticket'"));
       })
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
      const scheduledEntries = await db('schedule_entries')
        .where('schedule_entries.tenant', tenant)
        .where('work_item_type', 'ticket')
        .whereIn('work_item_id', ticketIds)
        .join('schedule_entry_assignees as sea', function() {
          this.on('schedule_entries.entry_id', '=', 'sea.entry_id')
              .andOn('schedule_entries.tenant', '=', 'sea.tenant');
        })
        .whereIn('sea.user_id', Array.from(allAssignedAgentIds))
        .select('schedule_entries.work_item_id', 'sea.user_id');

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
    throw new Error('Failed to search dispatch work items');
  }
});


// ==================================
// Function for Work Item Picker
// ==================================
export const searchPickerWorkItems = withAuth(async (
  user,
  { tenant },
  options: PickerSearchOptions
): Promise<SearchResult> => {
  try {
    const {knex: db} = await createTenantKnex();
    const searchTerm = options.searchTerm || '';
    const statusFilter = options.statusFilter || 'all_open';
    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const offset = (page - 1) * pageSize;
    const isTimesheet = options.isTimesheet || false;

    let ticketsQuery = db('tickets as t')
      .whereNotIn('t.ticket_id', options.availableWorkItemIds || [])
      .where('t.tenant', tenant)
      .innerJoin('clients as c', function() {
        this.on('t.client_id', '=', 'c.client_id')
            .andOn('t.tenant', '=', 'c.tenant');
      })
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', '=', 's.status_id')
            .andOn('t.tenant', '=', 's.tenant');
      })
      .leftJoin(
        db('ticket_resources')
          .where('tenant', tenant)
          .select('ticket_id')
          .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
          .groupBy('ticket_id', 'tenant')
          .as('tr'),
        function() {
          this.on('t.ticket_id', '=', 'tr.ticket_id')
              .andOn('t.tenant', '=', db.raw('?', [tenant]));
        }
      )
      .leftJoin('users as u_assignee', function() {
        this.on('t.assigned_to', '=', 'u_assignee.user_id')
            .andOn('t.tenant', '=', 'u_assignee.tenant');
      })
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

      let projectTasksQuery = db('project_tasks as pt')
      .whereNotIn('pt.task_id', options.availableWorkItemIds || [])
      .where('pt.tenant', tenant)
      .innerJoin('project_phases as pp', function() {
        this.on('pt.phase_id', '=', 'pp.phase_id')
            .andOn('pt.tenant', '=', 'pp.tenant');
      })
      .innerJoin('projects as p', function() {
        this.on('pp.project_id', '=', 'p.project_id')
            .andOn('pp.tenant', '=', 'p.tenant');
      })
      .innerJoin('clients as c', function() {
        this.on('p.client_id', '=', 'c.client_id')
            .andOn('p.tenant', '=', 'c.tenant');
      })
      .leftJoin('project_status_mappings as psm', function() {
        this.on('pt.project_status_mapping_id', '=', 'psm.project_status_mapping_id')
            .andOn('pt.tenant', '=', 'psm.tenant');
      })
      .leftJoin('statuses as s_custom', function() {
        this.on('psm.status_id', '=', 's_custom.status_id')
            .andOn('psm.tenant', '=', 's_custom.tenant')
            .andOn('psm.is_standard', '=', db.raw('false'));
      })
      .leftJoin('standard_statuses as s_standard', function() {
        this.on('psm.standard_status_id', '=', 's_standard.standard_status_id')
            .andOn('psm.tenant', '=', 's_standard.tenant')
            .andOn('psm.is_standard', '=', db.raw('true'));
      })
      .leftJoin(
        db('task_resources')
          .where('tenant', tenant)
          .select('task_id')
          .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
          .groupBy('task_id', 'tenant')
          .as('tr'),
        function() {
          this.on('pt.task_id', '=', 'tr.task_id')
              .andOn('pt.tenant', '=', db.raw('?', [tenant]));
        }
      )
      .leftJoin('users as u_assignee', function() {
        this.on('pt.assigned_to', '=', 'u_assignee.user_id')
            .andOn('pt.tenant', '=', 'u_assignee.tenant');
      })
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


    let adHocQuery;
    if (!options.type || options.type === 'all' || options.type === 'ad_hoc') {
      adHocQuery = db('schedule_entries as se')
        .whereNotIn('se.entry_id', options.availableWorkItemIds || [])
        .where('se.tenant', tenant)
        .where('work_item_type', 'ad_hoc')
        .whereILike('title', db.raw('?', [`%${searchTerm}%`]))
        .leftJoin(
          db('schedule_entry_assignees')
            .where('tenant', tenant)
            .select('entry_id')
            .select(db.raw('array_agg(distinct user_id ORDER BY user_id) as assigned_user_ids'))
            .select(db.raw('(array_agg(distinct user_id ORDER BY user_id))[1] as first_assigned_user_id'))
            .groupBy('entry_id', 'tenant')
            .as('sea'),
          function() {
            this.on('se.entry_id', '=', 'sea.entry_id')
                .andOn('se.tenant', '=', db.raw('?', [tenant]));
          }
        )
        .leftJoin('users as u_adhoc_assignee', function() {
          this.on('sea.first_assigned_user_id', '=', 'u_adhoc_assignee.user_id')
              .andOn('se.tenant', '=', 'u_adhoc_assignee.tenant');
        })
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
    }

    // Add interactions query
    let interactionsQuery;
    if (!options.type || options.type === 'all' || options.type === 'interaction') {
      interactionsQuery = db('interactions as i')
        .whereNotIn('i.interaction_id', options.availableWorkItemIds || [])
        .where('i.tenant', tenant)
        .leftJoin('clients as c', function() {
          this.on('i.client_id', '=', 'c.client_id')
              .andOn('i.tenant', '=', 'c.tenant');
        })
        .leftJoin('interaction_types as it', function() {
          this.on('i.type_id', '=', 'it.type_id')
              .andOn('i.tenant', '=', 'it.tenant');
        })
        .leftJoin('users as u_interaction_assignee', function() {
          this.on('i.user_id', '=', 'u_interaction_assignee.user_id')
              .andOn('i.tenant', '=', 'u_interaction_assignee.tenant');
        })
        .whereILike('i.title', db.raw('?', [`%${searchTerm}%`]))
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
          db.raw('NULL::timestamp with time zone as scheduled_start'),
          db.raw('NULL::timestamp with time zone as scheduled_end'),
          db.raw('NULL::timestamp with time zone as due_date'),
          db.raw("u_interaction_assignee.first_name || ' ' || u_interaction_assignee.last_name as assigned_to_name"),
          db.raw('ARRAY[i.user_id] as assigned_user_ids'),
          db.raw('ARRAY[]::uuid[] as additional_user_ids'),
          db.raw('NULL::uuid as service_id')
        );

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
      const interactionTypes = await db('interactions as i')
        .whereIn('i.interaction_id', interactionIds)
        .where('i.tenant', tenant)
        .leftJoin('interaction_types as it', function() {
          this.on('i.type_id', '=', 'it.type_id')
              .andOn('i.tenant', '=', 'it.tenant');
        })
        .select('i.interaction_id', 'it.type_name');

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
    throw new Error('Failed to search picker work items: ' + (error instanceof Error ? error.message : error));
  }
});

export const createWorkItem = withAuth(async (
  user,
  { tenant },
  item: Omit<IWorkItem, "work_item_id">
): Promise<Omit<IExtendedWorkItem, "tenant">> => {
  try {
    const {knex: db} = await createTenantKnex();

    if (!item.startTime || !item.endTime) {
      throw new Error('Start time and end time are required for ad-hoc entries');
    }

    // Create schedule entry with current user assigned
    const scheduleEntry = await ScheduleEntry.create(db, {
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
    throw new Error('Failed to create work item');
  }
});

export const getWorkItemById = withAuth(async (
  user,
  { tenant },
  workItemId: string,
  workItemType: WorkItemType
): Promise<Omit<IExtendedWorkItem, "tenant"> | null> => {
  try {
    const {knex: db} = await createTenantKnex();
    let workItem;

    if (workItemType === 'ticket') {
      workItem = await db('tickets as t')
        .where({
          't.ticket_id': workItemId,
          't.tenant': tenant
        })
        .leftJoin('statuses as s', function() {
          this.on('t.status_id', '=', 's.status_id')
              .andOn('t.tenant', '=', 's.tenant');
        })
        .leftJoin('boards as ch', function() {
          this.on('t.board_id', '=', 'ch.board_id')
              .andOn('t.tenant', '=', 'ch.tenant');
        })
        .leftJoin('users as u_assignee', function() {
          this.on('t.assigned_to', '=', 'u_assignee.user_id')
              .andOn('t.tenant', '=', 'u_assignee.tenant');
        })
        .leftJoin('contacts as ct', function() {
          this.on('t.contact_name_id', '=', 'ct.contact_name_id')
              .andOn('t.tenant', '=', 'ct.tenant');
        })
        .leftJoin('clients as co', function() {
          this.on('t.client_id', '=', 'co.client_id')
              .andOn('t.tenant', '=', 'co.tenant');
        })
        .leftJoin(
          db('ticket_resources')
            .where('tenant', tenant)
            .select('ticket_id')
            .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
            .groupBy('ticket_id', 'tenant')
            .as('tr'),
          function() {
            this.on('t.ticket_id', '=', 'tr.ticket_id')
                .andOn('t.tenant', '=', db.raw('?', [tenant]));
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
        )
        .first();
    } else if (workItemType === 'project_task') {
      workItem = await db('project_tasks as pt')
        .where({
          'pt.task_id': workItemId,
          'pt.tenant': tenant
        })
        .innerJoin('project_phases as pp', function() {
          this.on('pt.phase_id', '=', 'pp.phase_id')
              .andOn('pt.tenant', '=', 'pp.tenant');
        })
        .innerJoin('projects as p', function() {
          this.on('pp.project_id', '=', 'p.project_id')
              .andOn('pp.tenant', '=', 'p.tenant');
        })
        .leftJoin(
          db('task_resources')
            .where('tenant', tenant)
            .select('task_id')
            .select(db.raw('array_agg(distinct additional_user_id) as additional_user_ids'))
            .groupBy('task_id', 'tenant')
            .as('tr'),
          function() {
            this.on('pt.task_id', '=', 'tr.task_id')
                .andOn('pt.tenant', '=', db.raw('?', [tenant]));
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
        )
        .first();
    } else if (workItemType === 'ad_hoc') {
      workItem = await db('schedule_entries as se')
        .where({
          'se.entry_id': workItemId,
          'se.tenant': tenant
        })
        .leftJoin(
          db('schedule_entry_assignees')
            .where('tenant', tenant)
            .select('entry_id')
            .select(db.raw('array_agg(distinct user_id) as assigned_user_ids'))
            .groupBy('entry_id', 'tenant')
            .as('sea'),
          function() {
            this.on('se.entry_id', '=', 'sea.entry_id')
                .andOn('se.tenant', '=', db.raw('?', [tenant]));
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
      workItem = await db('interactions as i')
        .where({
          'i.interaction_id': workItemId,
          'i.tenant': tenant
        })
        .leftJoin('clients as c', function() {
          this.on('i.client_id', '=', 'c.client_id')
              .andOn('i.tenant', '=', 'c.tenant');
        })
        .leftJoin('interaction_types as it', function() {
          this.on('i.type_id', '=', 'it.type_id')
              .andOn('i.tenant', '=', 'it.tenant');
        })
        .leftJoin('statuses as s', function() {
          this.on('i.status_id', '=', 's.status_id')
              .andOn('i.tenant', '=', 's.tenant');
        })
        .leftJoin('contacts as ct', function() {
          this.on('i.contact_name_id', '=', 'ct.contact_name_id')
              .andOn('i.tenant', '=', 'ct.tenant');
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
        )
        .first();
    } else if (workItemType === 'appointment_request') {
      workItem = await db('appointment_requests as ar')
        .where({
          'ar.appointment_request_id': workItemId,
          'ar.tenant': tenant
        })
        .leftJoin('service_catalog as sc', function() {
          this.on('ar.service_id', '=', 'sc.service_id')
              .andOn('ar.tenant', '=', 'sc.tenant');
        })
        .leftJoin('clients as c', function() {
          this.on('ar.client_id', '=', 'c.client_id')
              .andOn('ar.tenant', '=', 'c.tenant');
        })
        .leftJoin('contacts as ct', function() {
          this.on('ar.contact_id', '=', 'ct.contact_name_id')
              .andOn('ar.tenant', '=', 'ct.tenant');
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
        )
        .first();
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
    throw new Error('Failed to fetch work item by ID');
  }
});
