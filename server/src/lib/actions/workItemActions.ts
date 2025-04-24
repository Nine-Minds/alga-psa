'use server';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { IWorkItem, IExtendedWorkItem, WorkItemType } from 'server/src/interfaces/workItem.interfaces';
import ScheduleEntry from 'server/src/lib/models/scheduleEntry';

interface SearchOptions {
  searchTerm?: string;
  type?: WorkItemType | 'all';
  sortBy?: 'name' | 'type';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
  assignedTo?: string;
  assignedToMe?: boolean;
  companyId?: string;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
  availableWorkItemIds?: string[];
  workItemId?: string;
  statusFilter?: string;
  filterUnscheduled?: boolean;
  context?: 'dispatch' | 'picker';
}

interface SearchResult {
  items: Omit<IExtendedWorkItem, "tenant">[];
  total: number;
}

export async function searchWorkItems(options: SearchOptions): Promise<SearchResult> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    const searchTerm = options.searchTerm || '';
    const statusFilter = options.statusFilter || 'all_open';
    const filterUnscheduled = options.filterUnscheduled ?? false;
    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const offset = (page - 1) * pageSize;

    // Build base queries using proper parameter binding
    let ticketsQuery = db('tickets as t')
      .whereNotIn('t.ticket_id', options.availableWorkItemIds || [])
      .where('t.tenant', tenant)
      .innerJoin('companies as c', function() {
        this.on('t.company_id', '=', 'c.company_id')
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

         if (filterUnscheduled) {
           queryBuilder.whereNull('se_ticket.entry_id');
         } else {
           queryBuilder.whereNotNull('se_ticket.entry_id');
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
        't.company_id',
        'c.company_name as company_name',
        db.raw('NULL::timestamp with time zone as scheduled_start'),
        db.raw('NULL::timestamp with time zone as scheduled_end'),
        db.raw('t.closed_at::timestamp with time zone as due_date'),
        db.raw('ARRAY[t.assigned_to] as assigned_user_ids'),
        'tr.additional_user_ids as additional_user_ids'
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
      .innerJoin('companies as c', function() {
        this.on('p.company_id', '=', 'c.company_id')
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
       .leftJoin('schedule_entries as se_task', function() {
         this.on('pt.task_id', '=', 'se_task.work_item_id')
             .andOn('pt.tenant', '=', 'se_task.tenant')
             .andOn('se_task.work_item_type', '=', db.raw("'project_task'"));
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

         if (filterUnscheduled) {
           queryBuilder.whereNull('se_task.entry_id');
         } else {
           queryBuilder.whereNotNull('se_task.entry_id');
         }

         if (!options.includeInactive) {
          queryBuilder.where('p.is_inactive', false);
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
        'p.company_id',
        'c.company_name as company_name',
        db.raw('NULL::timestamp with time zone as scheduled_start'),
        db.raw('NULL::timestamp with time zone as scheduled_end'),
        db.raw('pt.due_date::timestamp with time zone as due_date'),
        db.raw('ARRAY[pt.assigned_to] as assigned_user_ids'),
        'tr.additional_user_ids as additional_user_ids'
      );


    // Apply filters
    if (options.type && options.type !== 'all') {
      if (options.type === 'ticket') {
        projectTasksQuery = projectTasksQuery.whereRaw('1 = 0');
      } else if (options.type === 'project_task') {
        ticketsQuery = ticketsQuery.whereRaw('1 = 0');
      }
    }

    // Filter by assigned user
    if (options.assignedToMe && options.assignedTo) {
      // "Assigned to me" filter
      ticketsQuery = ticketsQuery.where(function() {
        this.where('t.assigned_to', options.assignedTo)
            .orWhereRaw('? = ANY(tr.additional_user_ids)', [options.assignedTo]);
      });
      projectTasksQuery = projectTasksQuery.where(function() {
        this.where('pt.assigned_to', options.assignedTo)
            .orWhereRaw('? = ANY(tr.additional_user_ids)', [options.assignedTo]);
      });
    } else if (options.assignedTo) {
      // Regular "Assigned to" filter
      ticketsQuery = ticketsQuery.where(function() {
        this.where('t.assigned_to', options.assignedTo)
            .orWhereRaw('? = ANY(tr.additional_user_ids)', [options.assignedTo]);
      });
      projectTasksQuery = projectTasksQuery.where(function() {
        this.where('pt.assigned_to', options.assignedTo)
            .orWhereRaw('? = ANY(tr.additional_user_ids)', [options.assignedTo]);
      });
    }

    // Filter by company
    if (options.companyId) {
      ticketsQuery = ticketsQuery.where('t.company_id', options.companyId);
      projectTasksQuery = projectTasksQuery.where('p.company_id', options.companyId);
    }

    // Apply date filtering if dateRange is provided
    const startDate = options.dateRange?.start;
    const endDate = options.dateRange?.end;

    if (startDate) {
      // For tickets, filter on closed_at if it exists
      ticketsQuery = ticketsQuery.where(function() {
        this.whereNull('t.closed_at')
            .orWhere('t.closed_at', '>=', db.raw('?', [startDate]));
      });
      
      // For project tasks, filter on due_date if it exists
      projectTasksQuery = projectTasksQuery.where(function() {
        this.whereNull('pt.due_date')
            .orWhere('pt.due_date', '>=', db.raw('?', [startDate]));
      });
      
    }
    
    if (endDate) {
      // For tickets, filter on closed_at if it exists
      ticketsQuery = ticketsQuery.where(function() {
        this.whereNull('t.closed_at')
            .orWhere('t.closed_at', '<=', db.raw('?', [endDate]));
      });
      
      // For project tasks, filter on due_date if it exists
      projectTasksQuery = projectTasksQuery.where(function() {
        this.whereNull('pt.due_date')
            .orWhere('pt.due_date', '<=', db.raw('?', [endDate]));
      });
      
    }

    // Filter by specific work item ID if provided
    if (options.workItemId) {
      ticketsQuery = ticketsQuery.where('t.ticket_id', options.workItemId);
      // Exclude other types when filtering by specific ticket ID
      projectTasksQuery = projectTasksQuery.whereRaw('1 = 0');
    }

    // Combine queries based on context
    let combinedQueries;
    if (options.context === 'dispatch') {
      // Dispatch only needs tickets
      combinedQueries = [ticketsQuery];
      // Ensure projectTasksQuery doesn't interfere if filters were applied
      projectTasksQuery = projectTasksQuery.whereRaw('1 = 0'); 
    } else {
      // Picker needs both
      combinedQueries = [ticketsQuery, projectTasksQuery];
    }

    let query = db.union(combinedQueries, true);

    // Get total count before applying pagination
    const countResult = await db.from(query.as('combined')).count('* as count').first();
    const total = parseInt(countResult?.count as string || '0');

    // Apply sorting
    if (options.sortBy) {
      const sortColumn = options.sortBy === 'name' ? 'name' : 'type';
      query = db.from(query.as('combined'))
        .orderBy(sortColumn, options.sortOrder || 'asc');
    }

    // Apply pagination
    query = query.limit(pageSize).offset(offset);

    // Execute query
    const results = await query;

    // Format results
    const workItems = results.map((item: any): Omit<IExtendedWorkItem, "tenant"> => {
      const workItem: Omit<IExtendedWorkItem, "tenant"> = {
        work_item_id: item.work_item_id,
        type: item.type,
        name: item.name,
        description: item.description,
        is_billable: true, // You may need to adjust this based on your business logic
        ticket_number: item.ticket_number,
        title: item.title,
        project_name: item.project_name,
        phase_name: item.phase_name,
        task_name: item.task_name,
        company_name: item.company_name,
        due_date: item.due_date,
        additional_user_ids: item.additional_user_ids || [],
        assigned_user_ids: item.assigned_user_ids || []
      };

      // Add scheduled times for ad-hoc items
      if (item.type === 'ad_hoc' && item.scheduled_start && item.scheduled_end) {
        workItem.scheduled_start = item.scheduled_start;
        workItem.scheduled_end = item.scheduled_end;
      }

      return workItem;
    });

    return {
      items: workItems,
      total
    };
  } catch (error) {
    console.error('Error searching work items:', error);
    throw new Error('Failed to search work items');
  }
}

export async function createWorkItem(item: Omit<IWorkItem, "work_item_id">): Promise<Omit<IExtendedWorkItem, "tenant">> {
  try {
    const {tenant} = await createTenantKnex();
    const currentUser = await getCurrentUser();
    
    if (!currentUser) {
      throw new Error('User not authenticated');
    }
    
    if (!item.startTime || !item.endTime) {
      throw new Error('Start time and end time are required for ad-hoc entries');
    }

    // Create schedule entry with current user assigned
    const scheduleEntry = await ScheduleEntry.create({
      title: item.title || 'Ad-hoc Entry',
      notes: item.description,
      scheduled_start: item.startTime,
      scheduled_end: item.endTime,
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      work_item_id: null,
      assigned_user_ids: []  // This will be populated by the model
    }, {
      assignedUserIds: [currentUser.user_id]
    });

    // For ad-hoc entries, use title as name if provided, otherwise use a default name
    const name = item.title || 'Ad-hoc Entry';
    
    return {
      work_item_id: scheduleEntry.entry_id,
      type: 'ad_hoc',
      name: name,
      title: item.title,
      description: item.description,
      is_billable: item.is_billable,
      scheduled_start: item.startTime.toISOString(),
      scheduled_end: item.endTime.toISOString()
    };
  } catch (error) {
    console.error('Error creating work item:', error);
    throw new Error('Failed to create work item');
  }
}

export async function getWorkItemById(workItemId: string, workItemType: WorkItemType): Promise<Omit<IExtendedWorkItem, "tenant"> | null> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
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
        .leftJoin('channels as ch', function() {
          this.on('t.channel_id', '=', 'ch.channel_id')
              .andOn('t.tenant', '=', 'ch.tenant');
        })
        .leftJoin('users as u_assignee', function() {
          this.on('t.assigned_to', '=', 'u_assignee.user_id')
              .andOn('t.tenant', '=', 'u_assignee.tenant');
        })
        .leftJoin('contacts as ct', function() {
          this.on('t.contact_name_id', '=', 'ct.contact_id')
              .andOn('t.tenant', '=', 'ct.tenant');
        })
        .leftJoin('companies as co', function() {
          this.on('t.company_id', '=', 'co.company_id')
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
          't.company_id',
          'co.company_name',
          's.name as status_name',
          'ch.name as channel_name',
          'u_assignee.full_name as assigned_to_name',
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
    }

    if (workItem) {
      const result: Omit<IExtendedWorkItem, "tenant"> = {
        work_item_id: workItem.work_item_id,
        type: workItem.type,
        name: workItem.name,
        description: workItem.description,
        is_billable: true, // Adjust this based on your business logic
        ticket_number: workItem.ticket_number,
        title: workItem.title,
        project_name: workItem.project_name,
        phase_name: workItem.phase_name,
        task_name: workItem.task_name,
        company_id: workItem.company_id,
        company_name: workItem.company_name,
        status_name: workItem.status_name,
        channel_name: workItem.channel_name,
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

      return result;
    }

    return null;
  } catch (error) {
    console.error('Error fetching work item by ID:', error);
    throw new Error('Failed to fetch work item by ID');
  }
}
