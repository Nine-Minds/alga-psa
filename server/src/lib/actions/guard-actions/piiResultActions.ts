'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardPiiResult,
  IGuardPiiResultWithDetails,
  IGuardPiiResultListParams,
  IGuardPaginatedResponse,
  GuardPiiType,
} from '../../../interfaces/guard/pii.interfaces';

/**
 * Get all PII results with pagination
 */
export async function getPiiResults(
  params: IGuardPiiResultListParams = {}
): Promise<IGuardPaginatedResponse<IGuardPiiResultWithDetails>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:pii', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:pii:view');
  }

  const {
    page = 1,
    page_size = 20,
    sort_by = 'found_at',
    sort_order = 'desc',
    job_id,
    profile_id,
    company_id,
    pii_type,
    date_from,
    date_to,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_pii_results as r')
      .select(
        'r.*',
        'c.company_name',
        'p.name as profile_name'
      )
      .join('companies as c', function() {
        this.on('r.company_id', '=', 'c.company_id')
          .andOn('r.tenant', '=', 'c.tenant');
      })
      .join('guard_pii_profiles as p', function() {
        this.on('r.profile_id', '=', 'p.id')
          .andOn('r.tenant', '=', 'p.tenant');
      })
      .where('r.tenant', tenant);

    // Apply filters
    if (job_id) {
      query = query.where('r.job_id', job_id);
    }

    if (profile_id) {
      query = query.where('r.profile_id', profile_id);
    }

    if (company_id) {
      query = query.where('r.company_id', company_id);
    }

    if (pii_type) {
      query = query.where('r.pii_type', pii_type);
    }

    if (date_from) {
      query = query.where('r.found_at', '>=', date_from);
    }

    if (date_to) {
      query = query.where('r.found_at', '<=', date_to);
    }

    // Get total count
    const countResult = await query.clone()
      .clearSelect()
      .count('r.id as count')
      .first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination and sorting
    const offset = (page - 1) * page_size;
    const sortColumn = sort_by === 'company_name' ? 'c.company_name' : `r.${sort_by}`;
    const results = await query
      .orderBy(sortColumn, sort_order)
      .limit(page_size)
      .offset(offset);

    return {
      data: results as IGuardPiiResultWithDetails[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get a single PII result by ID
 */
export async function getPiiResult(id: string): Promise<IGuardPiiResultWithDetails | null> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:pii', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:pii:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const result = await trx('guard_pii_results as r')
      .select(
        'r.*',
        'c.company_name',
        'p.name as profile_name'
      )
      .join('companies as c', function() {
        this.on('r.company_id', '=', 'c.company_id')
          .andOn('r.tenant', '=', 'c.tenant');
      })
      .join('guard_pii_profiles as p', function() {
        this.on('r.profile_id', '=', 'p.id')
          .andOn('r.tenant', '=', 'p.tenant');
      })
      .where('r.tenant', tenant)
      .where('r.id', id)
      .first();

    return result || null;
  });
}

/**
 * Get PII results for a specific job
 */
export async function getPiiResultsByJob(
  jobId: string,
  params: { page?: number; page_size?: number } = {}
): Promise<IGuardPaginatedResponse<IGuardPiiResultWithDetails>> {
  return getPiiResults({ ...params, job_id: jobId });
}

/**
 * Get PII results by company
 */
export async function getPiiResultsByCompany(
  companyId: string,
  params: { page?: number; page_size?: number } = {}
): Promise<IGuardPaginatedResponse<IGuardPiiResultWithDetails>> {
  return getPiiResults({ ...params, company_id: companyId });
}

/**
 * Delete a single PII result (purge)
 */
export async function deletePiiResult(id: string): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canPurge = await hasPermission(currentUser, 'guard:pii', 'purge_results');
  if (!canPurge) {
    throw new Error('Permission denied: guard:pii:purge_results');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const result = await trx('guard_pii_results')
      .where({ tenant, id })
      .first();

    if (!result) {
      throw new Error(`PII result ${id} not found`);
    }

    await trx('guard_pii_results')
      .where({ tenant, id })
      .delete();

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'result_purged',
      resource_type: 'pii_result',
      resource_id: id,
      details: JSON.stringify({
        pii_type: result.pii_type,
        file_path: result.file_path,
        company_id: result.company_id,
      }),
      created_at: new Date(),
    });

    return true;
  });
}

/**
 * Delete all PII results for a job
 */
export async function deletePiiResultsByJob(jobId: string): Promise<number> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canPurgeAll = await hasPermission(currentUser, 'guard:pii', 'purge_all');
  if (!canPurgeAll) {
    throw new Error('Permission denied: guard:pii:purge_all');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const deletedCount = await trx('guard_pii_results')
      .where({ tenant, job_id: jobId })
      .delete();

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'results_bulk_purged',
      resource_type: 'pii_job',
      resource_id: jobId,
      details: JSON.stringify({ deleted_count: deletedCount }),
      created_at: new Date(),
    });

    return deletedCount;
  });
}

/**
 * Create PII result (internal use by scanner)
 */
export async function createPiiResult(
  data: {
    job_id: string;
    profile_id: string;
    company_id: string;
    asset_id?: string;
    agent_id?: string;
    pii_type: GuardPiiType;
    file_path: string;
    line_numbers: number[];
    page_numbers?: number[];
    confidence: number;
  }
): Promise<IGuardPiiResult> {
  const { knex: db, tenant } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [result] = await trx('guard_pii_results')
      .insert({
        tenant,
        job_id: data.job_id,
        profile_id: data.profile_id,
        company_id: data.company_id,
        asset_id: data.asset_id || null,
        agent_id: data.agent_id || null,
        pii_type: data.pii_type,
        file_path: data.file_path,
        line_numbers: JSON.stringify(data.line_numbers),
        page_numbers: data.page_numbers ? JSON.stringify(data.page_numbers) : null,
        confidence: data.confidence,
        found_at: new Date(),
      })
      .returning('*');

    return result;
  });
}

/**
 * Create multiple PII results at once (batch insert)
 */
export async function createPiiResultsBatch(
  jobId: string,
  results: Array<{
    profile_id: string;
    company_id: string;
    asset_id?: string;
    agent_id?: string;
    pii_type: GuardPiiType;
    file_path: string;
    line_numbers: number[];
    page_numbers?: number[];
    confidence: number;
  }>
): Promise<number> {
  const { knex: db, tenant } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const insertData = results.map(r => ({
      tenant,
      job_id: jobId,
      profile_id: r.profile_id,
      company_id: r.company_id,
      asset_id: r.asset_id || null,
      agent_id: r.agent_id || null,
      pii_type: r.pii_type,
      file_path: r.file_path,
      line_numbers: JSON.stringify(r.line_numbers),
      page_numbers: r.page_numbers ? JSON.stringify(r.page_numbers) : null,
      confidence: r.confidence,
      found_at: new Date(),
    }));

    await trx('guard_pii_results').insert(insertData);
    return insertData.length;
  });
}

/**
 * Get PII type summary for a job
 */
export async function getPiiTypeSummary(
  jobId: string
): Promise<Record<GuardPiiType, number>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:pii', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:pii:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const counts = await trx('guard_pii_results')
      .where({ tenant, job_id: jobId })
      .select('pii_type')
      .count('* as count')
      .groupBy('pii_type');

    const summary: Record<string, number> = {};
    for (const row of counts) {
      summary[row.pii_type] = parseInt(row.count as string, 10);
    }

    return summary as Record<GuardPiiType, number>;
  });
}

/**
 * Delete ALL PII results (admin-only purge all)
 */
export async function deleteAllPiiResults(): Promise<number> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canPurgeAll = await hasPermission(currentUser, 'guard:pii', 'purge_all');
  if (!canPurgeAll) {
    throw new Error('Permission denied: guard:pii:purge_all');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const deletedCount = await trx('guard_pii_results')
      .where({ tenant })
      .delete();

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'results_all_purged',
      resource_type: 'pii_results',
      resource_id: null,
      details: JSON.stringify({ deleted_count: deletedCount }),
      created_at: new Date(),
    });

    return deletedCount;
  });
}
