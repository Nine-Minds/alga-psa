'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardAsmJob,
  IGuardAsmJobWithDomain,
  IGuardAsmJobListParams,
  IGuardAsmPaginatedResponse,
} from '../../../interfaces/guard/asm.interfaces';
import { GuardJobStatus } from '../../../interfaces/guard/pii.interfaces';

/**
 * Get all ASM jobs with pagination
 */
export async function getAsmJobs(
  params: IGuardAsmJobListParams = {}
): Promise<IGuardAsmPaginatedResponse<IGuardAsmJobWithDomain>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  const {
    page = 1,
    page_size = 20,
    sort_by = 'started_at',
    sort_order = 'desc',
    domain_id,
    status,
    date_from,
    date_to,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_asm_jobs as j')
      .select(
        'j.*',
        'd.domain_name',
        'd.company_id',
        'c.company_name'
      )
      .join('guard_asm_domains as d', function() {
        this.on('j.domain_id', '=', 'd.id')
          .andOn('j.tenant', '=', 'd.tenant');
      })
      .join('companies as c', function() {
        this.on('d.company_id', '=', 'c.company_id')
          .andOn('d.tenant', '=', 'c.tenant');
      })
      .where('j.tenant', tenant);

    // Apply filters
    if (domain_id) {
      query = query.where('j.domain_id', domain_id);
    }

    if (status) {
      query = query.where('j.status', status);
    }

    if (date_from) {
      query = query.where('j.started_at', '>=', date_from);
    }

    if (date_to) {
      query = query.where('j.started_at', '<=', date_to);
    }

    // Get total count
    const countResult = await query.clone()
      .clearSelect()
      .count('j.id as count')
      .first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination and sorting
    const offset = (page - 1) * page_size;
    const sortColumn = sort_by === 'domain_name' ? 'd.domain_name' : `j.${sort_by}`;
    const jobs = await query
      .orderBy(sortColumn, sort_order)
      .limit(page_size)
      .offset(offset);

    return {
      data: jobs as IGuardAsmJobWithDomain[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get a single ASM job by ID
 */
export async function getAsmJob(id: string): Promise<IGuardAsmJobWithDomain | null> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const job = await trx('guard_asm_jobs as j')
      .select(
        'j.*',
        'd.domain_name',
        'd.company_id',
        'c.company_name'
      )
      .join('guard_asm_domains as d', function() {
        this.on('j.domain_id', '=', 'd.id')
          .andOn('j.tenant', '=', 'd.tenant');
      })
      .join('companies as c', function() {
        this.on('d.company_id', '=', 'c.company_id')
          .andOn('d.tenant', '=', 'c.tenant');
      })
      .where('j.tenant', tenant)
      .where('j.id', id)
      .first();

    return job || null;
  });
}

/**
 * Trigger a new ASM scan for a domain
 */
export async function triggerAsmScan(domainId: string): Promise<IGuardAsmJob> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canExecute = await hasPermission(currentUser, 'guard:asm', 'execute_scan');
  if (!canExecute) {
    throw new Error('Permission denied: guard:asm:execute_scan');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Check domain exists and is enabled
    const domain = await trx('guard_asm_domains')
      .where({ tenant, id: domainId })
      .first();

    if (!domain) {
      throw new Error(`ASM domain ${domainId} not found`);
    }

    if (!domain.enabled) {
      throw new Error('Cannot trigger scan on disabled domain');
    }

    // Check for existing queued/running jobs
    const activeJob = await trx('guard_asm_jobs')
      .where({ tenant, domain_id: domainId })
      .whereIn('status', ['queued', 'running'])
      .first();

    if (activeJob) {
      throw new Error('A scan is already in progress for this domain');
    }

    // Create the job
    const [job] = await trx('guard_asm_jobs')
      .insert({
        tenant,
        domain_id: domainId,
        status: 'queued',
        summary: JSON.stringify({
          triggered_by: currentUser.user_id,
        }),
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'asm_scan_triggered',
      resource_type: 'asm_job',
      resource_id: job.id,
      details: JSON.stringify({
        domain_id: domainId,
        domain_name: domain.domain_name,
      }),
      created_at: new Date(),
    });

    // TODO: Enqueue the scan job to the ASM scanner
    // The ASM scanner runs as a separate Kubernetes service
    // For now, we just create the job record and it will be
    // picked up by the scanner service polling for queued jobs

    return job;
  });
}

/**
 * Cancel a running ASM scan
 */
export async function cancelAsmScan(jobId: string): Promise<IGuardAsmJob> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canExecute = await hasPermission(currentUser, 'guard:asm', 'execute_scan');
  if (!canExecute) {
    throw new Error('Permission denied: guard:asm:execute_scan');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const job = await trx('guard_asm_jobs')
      .where({ tenant, id: jobId })
      .first();

    if (!job) {
      throw new Error(`ASM job ${jobId} not found`);
    }

    if (job.status !== 'queued' && job.status !== 'running') {
      throw new Error(`Cannot cancel job in ${job.status} status`);
    }

    const [updatedJob] = await trx('guard_asm_jobs')
      .where({ tenant, id: jobId })
      .update({
        status: 'cancelled',
        completed_at: new Date(),
        error_message: 'Cancelled by user',
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'asm_scan_cancelled',
      resource_type: 'asm_job',
      resource_id: jobId,
      created_at: new Date(),
    });

    return updatedJob;
  });
}

/**
 * Update job status (internal use by scanner service)
 */
export async function updateAsmJobStatus(
  jobId: string,
  status: GuardJobStatus,
  updates: {
    scanner_pod_id?: string;
    error_message?: string;
    summary?: Record<string, unknown>;
  } = {}
): Promise<IGuardAsmJob> {
  const { knex: db, tenant } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const updateData: Record<string, unknown> = { status };

    if (status === 'running') {
      updateData.started_at = new Date();
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateData.completed_at = new Date();
    }

    if (updates.scanner_pod_id !== undefined) {
      updateData.scanner_pod_id = updates.scanner_pod_id;
    }
    if (updates.error_message !== undefined) {
      updateData.error_message = updates.error_message;
    }
    if (updates.summary !== undefined) {
      updateData.summary = JSON.stringify(updates.summary);
    }

    const [job] = await trx('guard_asm_jobs')
      .where({ tenant, id: jobId })
      .update(updateData)
      .returning('*');

    if (!job) {
      throw new Error(`ASM job ${jobId} not found`);
    }

    // Update domain's last_scanned_at if completed
    if (status === 'completed') {
      await trx('guard_asm_domains')
        .where({ tenant, id: job.domain_id })
        .update({ last_scanned_at: new Date() });
    }

    return job;
  });
}

/**
 * Get recent jobs for a domain
 */
export async function getRecentAsmJobs(
  domainId: string,
  limit: number = 5
): Promise<IGuardAsmJob[]> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    return trx('guard_asm_jobs')
      .where({ tenant, domain_id: domainId })
      .orderBy('started_at', 'desc')
      .limit(limit);
  });
}
