'use server';
import { createTenantKnex } from '@/lib/db';
import { IWorkItem, IExtendedWorkItem, WorkItemType } from '@/interfaces/workItem.interfaces';

interface SearchOptions {
  searchTerm?: string;
  type?: WorkItemType | 'all';
  sortBy?: 'name' | 'type';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

interface SearchResult {
  items: Omit<IExtendedWorkItem, "tenant">[];
  total: number;
}

export async function searchWorkItems(options: SearchOptions): Promise<SearchResult> {
  try {
    const {knex: db} = await createTenantKnex();
    const searchTerm = options.searchTerm || '';
    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const offset = (page - 1) * pageSize;

    // Build base queries using proper parameter binding
    let ticketsQuery = db('tickets')
      .whereILike('title', db.raw('?', [`%${searchTerm}%`]))
      .select(
        'ticket_id as work_item_id',
        'title as name',
        'url as description',
        db.raw("'ticket' as type"),
        'ticket_number',
        'title',
        db.raw('NULL as project_name'),
        db.raw('NULL as phase_name'),
        db.raw('NULL as task_name')
      );

    let projectTasksQuery = db('project_tasks as pt')
      .join('project_phases as pp', 'pt.phase_id', 'pp.phase_id')
      .join('projects as p', 'pp.project_id', 'p.project_id')
      .whereILike('pt.task_name', db.raw('?', [`%${searchTerm}%`]))
      .select(
        'pt.task_id as work_item_id',
        'pt.task_name as name',
        'pt.description',
        db.raw("'project_task' as type"),
        db.raw('NULL as ticket_number'),
        db.raw('NULL as title'),
        'p.project_name',
        'pp.phase_name',
        'pt.task_name'
      );

    // Apply type filter if specified
    if (options.type && options.type !== 'all') {
      if (options.type === 'ticket') {
        projectTasksQuery = projectTasksQuery.whereRaw('1 = 0');
      } else if (options.type === 'project_task') {
        ticketsQuery = ticketsQuery.whereRaw('1 = 0');
      }
    }

    // Combine queries
    let query = db.union([ticketsQuery, projectTasksQuery]);

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
    const workItems = results.map((item: any): Omit<IExtendedWorkItem, "tenant"> => ({
      work_item_id: item.work_item_id,
      type: item.type,
      name: item.name,
      description: item.description,
      is_billable: true, // You may need to adjust this based on your business logic
      ticket_number: item.ticket_number,
      title: item.title,
      project_name: item.project_name,
      phase_name: item.phase_name,
      task_name: item.task_name
    }));

    return {
      items: workItems,
      total
    };
  } catch (error) {
    console.error('Error searching work items:', error);
    throw new Error('Failed to search work items');
  }
}

export async function getWorkItemById(workItemId: string, workItemType: WorkItemType): Promise<Omit<IExtendedWorkItem, "tenant"> | null> {
  try {
    const {knex: db} = await createTenantKnex();
    let workItem;

    if (workItemType === 'ticket') {
      workItem = await db('tickets')
        .where('ticket_id', workItemId)
        .select(
          'ticket_id as work_item_id',
          'title as name',
          'url as description',
          db.raw("'ticket' as type"),
          'ticket_number',
          'title',
          db.raw('NULL as project_name'),
          db.raw('NULL as phase_name'),
          db.raw('NULL as task_name')
        )
        .first();
    } else if (workItemType === 'project_task') {
      workItem = await db('project_tasks as pt')
        .join('project_phases as pp', 'pt.phase_id', 'pp.phase_id')
        .join('projects as p', 'pp.project_id', 'p.project_id')
        .where('pt.task_id', workItemId)
        .select(
          'pt.task_id as work_item_id',
          'pt.task_name as name',
          'pt.description',
          db.raw("'project_task' as type"),
          db.raw('NULL as ticket_number'),
          db.raw('NULL as title'),
          'p.project_name',
          'pp.phase_name',
          'pt.task_name'
        )
        .first();
    }

    if (workItem) {
      return {
        work_item_id: workItem.work_item_id,
        type: workItem.type,
        name: workItem.name,
        description: workItem.description,
        is_billable: true, // Adjust this based on your business logic
        ticket_number: workItem.ticket_number,
        title: workItem.title,
        project_name: workItem.project_name,
        phase_name: workItem.phase_name,
        task_name: workItem.task_name
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching work item by ID:', error);
    throw new Error('Failed to fetch work item by ID');
  }
}
