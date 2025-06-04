'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getCurrentUser, getUserCompanyId } from 'server/src/lib/actions/user-actions/userActions';
import { IProject } from 'server/src/interfaces/project.interfaces';
import ProjectModel from 'server/src/lib/models/project';

/**
 * Fetch all projects for a client company with basic details
 */
export async function getClientProjects(options: {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  status?: string;
  search?: string;
} = {}): Promise<{
  projects: IProject[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  
  // Get current user and company
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  const companyId = await getUserCompanyId(user.user_id);
  if (!companyId) {
    throw new Error('Company not found');
  }
  
  // Set up query with pagination, sorting, filtering
  const query = knex('projects')
    .select([
      'projects.project_id',
      'projects.project_name',
      'projects.wbs_code',
      'projects.description',
      'projects.start_date',
      'projects.end_date',
      'statuses.name as status_name',
      'statuses.is_closed',
      'projects.created_at',
      'projects.updated_at'
    ])
    .leftJoin('statuses', function() {
      this.on('projects.status', '=', 'statuses.status_id')
         .andOn('projects.tenant', '=', 'statuses.tenant')
    })
    .where('projects.company_id', companyId)
    .where('projects.tenant', tenant)
    .where('projects.is_inactive', false);
  
  // Apply filters if provided
  if (options.status) {
    if (options.status === 'open') {
      query.where('statuses.is_closed', false);
    } else if (options.status === 'closed') {
      query.where('statuses.is_closed', true);
    } else if (options.status !== 'all') {
      query.where('statuses.name', 'ilike', `%${options.status}%`);
    }
  }
  
  if (options.search) {
    query.where(function() {
      this.where('projects.project_name', 'ilike', `%${options.search}%`)
          .orWhere('projects.wbs_code', 'ilike', `%${options.search}%`)
          .orWhere('projects.description', 'ilike', `%${options.search}%`);
    });
  }
  
  // Create a separate count query without the selected columns
  const countQuery = knex('projects')
    .count('* as count')
    .leftJoin('statuses', function() {
      this.on('projects.status', '=', 'statuses.status_id')
         .andOn('projects.tenant', '=', 'statuses.tenant')
    })
    .where('projects.company_id', companyId)
    .where('projects.tenant', tenant)
    .where('projects.is_inactive', false);
  
  // Apply the same filters to the count query
  if (options.status) {
    if (options.status === 'open') {
      countQuery.where('statuses.is_closed', false);
    } else if (options.status === 'closed') {
      countQuery.where('statuses.is_closed', true);
    } else if (options.status !== 'all') {
      countQuery.where('statuses.name', 'ilike', `%${options.status}%`);
    }
  }
  
  if (options.search) {
    countQuery.where(function() {
      this.where('projects.project_name', 'ilike', `%${options.search}%`)
          .orWhere('projects.wbs_code', 'ilike', `%${options.search}%`)
          .orWhere('projects.description', 'ilike', `%${options.search}%`);
    });
  }
  
  // Apply pagination
  const page = options.page || 1;
  const pageSize = options.pageSize || 10;
  query.offset((page - 1) * pageSize).limit(pageSize);
  
  // Apply sorting
  const sortBy = options.sortBy || 'created_at';
  const sortDirection = options.sortDirection || 'desc';
  query.orderBy(sortBy, sortDirection);
  
  // Execute queries
  const [projects, countResult] = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return Promise.all([
      query.transacting(trx),
      countQuery.first().transacting(trx)
    ]);
  });
  
  return {
    projects,
    total: parseInt(countResult?.count as string) || 0,
    page,
    pageSize
  };
}

/**
 * Calculate project progress without exposing internal details
 */
export async function getProjectProgress(projectId: string): Promise<{
  completionPercentage: number;
  timelineStatus: 'on_track' | 'delayed' | 'at_risk';
  daysRemaining: number;
}> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  
  // Get current user and company
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  // Get project to verify access
  const project = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('projects')
      .select('company_id', 'start_date', 'end_date')
      .where('project_id', projectId)
      .where('tenant', tenant)
      .first();
  });
  
  if (!project) {
    throw new Error('Project not found');
  }
  
  // Verify user has access to this project's company
  const userCompanyId = await getUserCompanyId(user.user_id);
  if (userCompanyId !== project.company_id) {
    throw new Error('Access denied');
  }
  
  // Calculate completion percentage based on tasks with closed status
  const tasksQuery = knex('project_tasks')
    .join('project_phases', function() {
      this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
         .andOn('project_tasks.tenant', '=', 'project_phases.tenant')
    })
    .join('project_status_mappings', function() {
      this.on('project_tasks.project_status_mapping_id', '=', 'project_status_mappings.project_status_mapping_id')
         .andOn('project_tasks.tenant', '=', 'project_status_mappings.tenant')
    })
    .leftJoin('statuses', function() {
      this.on('project_status_mappings.status_id', '=', 'statuses.status_id')
         .andOn('project_tasks.tenant', '=', 'statuses.tenant')
    })
    .leftJoin('standard_statuses', function() {
      this.on('project_status_mappings.standard_status_id', '=', 'standard_statuses.standard_status_id')
         .andOn('project_tasks.tenant', '=', 'standard_statuses.tenant')
    })
    .where('project_phases.project_id', projectId)
    .where('project_tasks.tenant', tenant)
    .count('* as total_tasks');
    
  const closedTasksQuery = knex('project_tasks')
    .join('project_phases', function() {
      this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
         .andOn('project_tasks.tenant', '=', 'project_phases.tenant')
    })
    .join('project_status_mappings', function() {
      this.on('project_tasks.project_status_mapping_id', '=', 'project_status_mappings.project_status_mapping_id')
         .andOn('project_tasks.tenant', '=', 'project_status_mappings.tenant')
    })
    .leftJoin('statuses', function() {
      this.on('project_status_mappings.status_id', '=', 'statuses.status_id')
         .andOn('project_tasks.tenant', '=', 'statuses.tenant')
    })
    .leftJoin('standard_statuses', function() {
      this.on('project_status_mappings.standard_status_id', '=', 'standard_statuses.standard_status_id')
         .andOn('project_tasks.tenant', '=', 'standard_statuses.tenant')
    })
    .where('project_phases.project_id', projectId)
    .where('project_tasks.tenant', tenant)
    .where(function() {
      this.where('statuses.is_closed', true)
          .orWhere('standard_statuses.is_closed', true)
    })
    .count('* as closed_tasks');
    
  const [totalTasksResult, closedTasksResult] = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return Promise.all([
      tasksQuery.first().transacting(trx),
      closedTasksQuery.first().transacting(trx)
    ]);
  });
  
  const totalTasks = parseInt(totalTasksResult?.total_tasks as string) || 0;
  const closedTasks = parseInt(closedTasksResult?.closed_tasks as string) || 0;
  
  // Calculate completion percentage
  const completionPercentage = totalTasks > 0 
    ? Math.round((closedTasks / totalTasks) * 100) 
    : 0;
  
  // Calculate days remaining and timeline status
  const today = new Date();
  const estimatedCompletionDate = new Date(project.end_date);
  const startDate = new Date(project.start_date);
  
  const totalDays = Math.max(1, Math.ceil((estimatedCompletionDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.ceil((estimatedCompletionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  // Expected progress based on timeline
  const expectedProgress = Math.min(100, Math.round((daysElapsed / totalDays) * 100));
  
  // Determine timeline status
  let timelineStatus: 'on_track' | 'delayed' | 'at_risk' = 'on_track';
  if (daysRemaining < 0) {
    timelineStatus = 'at_risk';
  } else if (completionPercentage < expectedProgress - 10) {
    timelineStatus = 'delayed';
  }
  
  return {
    completionPercentage,
    timelineStatus,
    daysRemaining: Math.max(0, daysRemaining)
  };
}

/**
 * Get project manager details for a project
 */
export async function getProjectManager(projectId: string): Promise<{
  userId: string | null;
  name: string;
  email: string | null;
  phone?: string;
}> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  
  // Get current user
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  // Get project to verify access
  const project = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('projects')
      .select('company_id', 'assigned_to')
      .where('project_id', projectId)
      .where('tenant', tenant)
      .first();
  });
  
  if (!project) {
    throw new Error('Project not found');
  }
  
  // Verify user has access to this project's company
  const userCompanyId = await getUserCompanyId(user.user_id);
  if (userCompanyId !== project.company_id) {
    throw new Error('Access denied');
  }
  
  // Get project manager details
  if (!project.assigned_to) {
    return {
      userId: null,
      name: 'Not Assigned',
      email: null
    };
  }
  
  const manager = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('users')
      .select('user_id', 'first_name', 'last_name', 'email', 'phone')
      .where('user_id', project.assigned_to)
      .where('tenant', tenant)
      .first();
  });
  
  if (!manager) {
    return {
      userId: null,
      name: 'Not Assigned',
      email: null
    };
  }
  
  return {
    userId: manager.user_id,
    name: `${manager.first_name} ${manager.last_name}`,
    email: manager.email,
    phone: manager.phone
  };
}
