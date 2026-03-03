'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { IProject } from '@alga-psa/types';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

/**
 * Get clientId from user's contact - avoids nested withAuth calls
 */
async function getClientIdFromUser(
  knex: Knex | Knex.Transaction,
  user: IUserWithRoles,
  tenant: string
): Promise<string | null> {
  if (!user.contact_id) return null;

  const contact = await knex('contacts')
    .where({
      contact_name_id: user.contact_id,
      tenant
    })
    .select('client_id')
    .first();

  return contact?.client_id || null;
}

/**
 * Fetch a single project by ID for the client portal
 * Verifies client access and returns project with client_portal_config
 */
export const getClientProjectDetails = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  projectId: string
): Promise<IProject | null> => {
  const { knex } = await createTenantKnex();

  const clientId = await getClientIdFromUser(knex, user, tenant);
  if (!clientId) {
    throw new Error('Client not found');
  }

  // Fetch project with client access verification
  const project = await knex('projects')
    .select([
      'projects.project_id',
      'projects.project_name',
      'projects.project_number',
      'projects.wbs_code',
      'projects.description',
      'projects.start_date',
      'projects.end_date',
      'projects.status',
      'statuses.name as status_name',
      'statuses.is_closed',
      'projects.created_at',
      'projects.updated_at',
      'projects.client_portal_config'
    ])
    .leftJoin('statuses', function() {
      this.on('projects.status', '=', 'statuses.status_id')
         .andOn('projects.tenant', '=', 'statuses.tenant');
    })
    .where('projects.project_id', projectId)
    .where('projects.client_id', clientId)
    .where('projects.tenant', tenant)
    .where('projects.is_inactive', false)
    .first();

  return project || null;
});

/**
 * Fetch all projects for a client client with basic details
 */
export const getClientProjects = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  options: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    status?: string;
    search?: string;
  } = {}
): Promise<{
  projects: IProject[];
  total: number;
  page: number;
  pageSize: number;
}> => {
  const { knex } = await createTenantKnex();

  const clientId = await getClientIdFromUser(knex, user, tenant);
  if (!clientId) {
    throw new Error('Client not found');
  }

  // Set up query with pagination, sorting, filtering
  const query = knex('projects')
    .select([
      'projects.project_id',
      'projects.project_name',
      'projects.project_number',
      'projects.wbs_code',
      'projects.description',
      'projects.start_date',
      'projects.end_date',
      'statuses.name as status_name',
      'statuses.is_closed',
      'projects.created_at',
      'projects.updated_at',
      'projects.client_portal_config'
    ])
    .leftJoin('statuses', function() {
      this.on('projects.status', '=', 'statuses.status_id')
         .andOn('projects.tenant', '=', 'statuses.tenant')
    })
    .where('projects.client_id', clientId)
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
    .where('projects.client_id', clientId)
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
});

