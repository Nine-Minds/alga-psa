'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { IProject } from '@alga-psa/types';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import { applyProjectVisibilityFilter, type ContactVisibilityContext } from '@alga-psa/authorization/portal/visibility';
import { getPortalVisibilityForUser } from '../../lib/clientAuth';
import { clientPortalActionErrorFrom, type ClientPortalActionError } from './clientPortalActionErrors';
import { hasClientProjectReadPermission } from './clientProjectPermissions';

/**
 * The portal user's visibility context, from the shared resolver - avoids nested
 * withAuth calls and hand-rolled contact -> client lookups. Project reads are
 * narrowed by the group's project scope via applyProjectVisibilityFilter.
 */
async function getVisibilityFromUser(
  knex: Knex,
  user: IUserWithRoles,
  tenant: string
): Promise<ContactVisibilityContext | null> {
  return withTransaction(knex, (trx: Knex.Transaction) => getPortalVisibilityForUser(trx, user, tenant));
}

/**
 * Fetch a single project by ID for the client portal
 * Verifies client access and returns project with client_portal_config
 */
export const getClientProjectDetails = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  projectId: string
): Promise<IProject | null | ClientPortalActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const scopedDb = tenantDb(knex, tenant);

    const canRead = await hasClientProjectReadPermission(knex, user, tenant);
    if (!canRead) {
      return permissionError(
        'Insufficient permissions to view project details',
        'common:errors.permissions.projects.readDetails'
      );
    }

    const visibility = await getVisibilityFromUser(knex, user, tenant);
    if (!visibility) {
      throw new Error('Client not found');
    }

    // Fetch project with client access verification
    const projectQuery = applyProjectVisibilityFilter(scopedDb.table('projects'), visibility, {
      clientColumn: 'projects.client_id',
      contactColumn: 'projects.contact_name_id',
    })
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
      .where('projects.project_id', projectId)
      .where('projects.is_inactive', false)
      .first();
    scopedDb.tenantJoin(projectQuery, 'statuses', 'projects.status', 'statuses.status_id', { type: 'left' });
    const project = await projectQuery as IProject | undefined;

    return project || null;
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
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
} | ClientPortalActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const scopedDb = tenantDb(knex, tenant);

    const canRead = await hasClientProjectReadPermission(knex, user, tenant);
    if (!canRead) {
      return permissionError(
        'Insufficient permissions to view projects',
        'common:errors.permissions.projects.read'
      );
    }

    const visibility = await getVisibilityFromUser(knex, user, tenant);
    if (!visibility) {
      throw new Error('Client not found');
    }
    const projectScope = { clientColumn: 'projects.client_id', contactColumn: 'projects.contact_name_id' };

  // Set up query with pagination, sorting, filtering
  const query = applyProjectVisibilityFilter(scopedDb.table('projects'), visibility, projectScope)
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
    .where('projects.is_inactive', false);
  scopedDb.tenantJoin(query, 'statuses', 'projects.status', 'statuses.status_id', { type: 'left' });
  
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
  const countQuery = applyProjectVisibilityFilter(scopedDb.table('projects'), visibility, projectScope)
    .count('* as count')
    .where('projects.is_inactive', false);
  scopedDb.tenantJoin(countQuery, 'statuses', 'projects.status', 'statuses.status_id', { type: 'left' });
  
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
      projects: projects as IProject[],
      total: parseInt(countResult?.count as string) || 0,
      page,
      pageSize
    };
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
