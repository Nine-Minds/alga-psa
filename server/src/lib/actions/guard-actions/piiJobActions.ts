'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardPiiJob,
  IGuardPiiJobWithProfile,
  IGuardPiiJobListParams,
  IGuardPaginatedResponse,
  GuardJobStatus,
} from '../../../interfaces/guard/pii.interfaces';
import { scheduleImmediateJob } from '../../jobs';
import type { GuardPiiScanJobData } from '../../jobs/handlers/guardPiiScanHandler';

/**
 * Get all PII jobs with pagination
 */
export async function getPiiJobs(
  params: IGuardPiiJobListParams = {}
): Promise<IGuardPaginatedResponse<IGuardPiiJobWithProfile>> {
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
    sort_by = 'created_at',
    sort_order = 'desc',
    profile_id,
    status,
    date_from,
    date_to,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_pii_jobs as j')
      .select(
        'j.*',
        'p.name as profile_name'
      )
      .join('guard_pii_profiles as p', function() {
        this.on('j.profile_id', '=', 'p.id')
          .andOn('j.tenant', '=', 'p.tenant');
      })
      .where('j.tenant', tenant);

    // Apply filters
    if (profile_id) {
      query = query.where('j.profile_id', profile_id);
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
    const sortColumn = sort_by === 'profile_name' ? 'p.name' : `j.${sort_by}`;
    const jobs = await query
      .orderBy(sortColumn, sort_order)
      .limit(page_size)
      .offset(offset);

    return {
      data: jobs as IGuardPiiJobWithProfile[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get a single PII job by ID
 */
export async function getPiiJob(id: string): Promise<IGuardPiiJobWithProfile | null> {
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
    const job = await trx('guard_pii_jobs as j')
      .select(
        'j.*',
        'p.name as profile_name'
      )
      .join('guard_pii_profiles as p', function() {
        this.on('j.profile_id', '=', 'p.id')
          .andOn('j.tenant', '=', 'p.tenant');
      })
      .where('j.tenant', tenant)
      .where('j.id', id)
      .first();

    return job || null;
  });
}

/**
 * Trigger a new PII scan
 */
export async function triggerPiiScan(
  profileId: string,
  targetAgents?: string[]
): Promise<IGuardPiiJob> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canExecute = await hasPermission(currentUser, 'guard:pii', 'execute_scan');
  if (!canExecute) {
    throw new Error('Permission denied: guard:pii:execute_scan');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Check profile exists and is enabled
    const profile = await trx('guard_pii_profiles')
      .where({ tenant, id: profileId })
      .first();

    if (!profile) {
      throw new Error(`PII profile ${profileId} not found`);
    }

    if (!profile.enabled) {
      throw new Error('Cannot trigger scan on disabled profile');
    }

    // Create the job
    const [job] = await trx('guard_pii_jobs')
      .insert({
        tenant,
        profile_id: profileId,
        status: 'queued',
        total_files_scanned: 0,
        total_matches: 0,
        progress_percent: 0,
        metadata: JSON.stringify({
          target_agents: targetAgents || profile.target_agents,
          triggered_by: currentUser.user_id,
        }),
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'scan_triggered',
      resource_type: 'pii_job',
      resource_id: job.id,
      details: JSON.stringify({
        profile_id: profileId,
        profile_name: profile.name,
      }),
      created_at: new Date(),
    });

    // Enqueue the scan job to PG Boss
    try {
      if (!tenant) {
        throw new Error('Tenant ID is required');
      }
      await scheduleImmediateJob<GuardPiiScanJobData>('guard:pii:scan', {
        tenantId: tenant,
        jobId: job.id,
        profileId,
      });
    } catch (enqueueError) {
      // If job enqueueing fails, update job status to failed
      await trx('guard_pii_jobs')
        .where({ tenant, id: job.id })
        .update({
          status: 'failed',
          error_message: `Failed to enqueue job: ${enqueueError instanceof Error ? enqueueError.message : String(enqueueError)}`,
          completed_at: new Date(),
        });
      throw new Error(`Failed to enqueue PII scan job: ${enqueueError instanceof Error ? enqueueError.message : String(enqueueError)}`);
    }

    return job;
  });
}

/**
 * Cancel a running PII scan
 */
export async function cancelPiiScan(jobId: string): Promise<IGuardPiiJob> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canExecute = await hasPermission(currentUser, 'guard:pii', 'execute_scan');
  if (!canExecute) {
    throw new Error('Permission denied: guard:pii:execute_scan');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const job = await trx('guard_pii_jobs')
      .where({ tenant, id: jobId })
      .first();

    if (!job) {
      throw new Error(`PII job ${jobId} not found`);
    }

    if (job.status !== 'queued' && job.status !== 'running') {
      throw new Error(`Cannot cancel job in ${job.status} status`);
    }

    const [updatedJob] = await trx('guard_pii_jobs')
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
      action: 'scan_cancelled',
      resource_type: 'pii_job',
      resource_id: jobId,
      created_at: new Date(),
    });

    return updatedJob;
  });
}

/**
 * Update job status (internal use)
 */
export async function updatePiiJobStatus(
  jobId: string,
  status: GuardJobStatus,
  updates: {
    total_files_scanned?: number;
    total_matches?: number;
    progress_percent?: number;
    error_message?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<IGuardPiiJob> {
  const { knex: db, tenant } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const updateData: Record<string, unknown> = { status };

    if (status === 'running' && !updates.error_message) {
      updateData.started_at = new Date();
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateData.completed_at = new Date();
    }

    if (updates.total_files_scanned !== undefined) {
      updateData.total_files_scanned = updates.total_files_scanned;
    }
    if (updates.total_matches !== undefined) {
      updateData.total_matches = updates.total_matches;
    }
    if (updates.progress_percent !== undefined) {
      updateData.progress_percent = updates.progress_percent;
    }
    if (updates.error_message !== undefined) {
      updateData.error_message = updates.error_message;
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = JSON.stringify(updates.metadata);
    }

    const [job] = await trx('guard_pii_jobs')
      .where({ tenant, id: jobId })
      .update(updateData)
      .returning('*');

    if (!job) {
      throw new Error(`PII job ${jobId} not found`);
    }

    return job;
  });
}

/**
 * Get job logs (from metadata and results)
 */
export async function getPiiJobLogs(jobId: string): Promise<string[]> {
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
    const job = await trx('guard_pii_jobs')
      .where({ tenant, id: jobId })
      .first();

    if (!job) {
      throw new Error(`PII job ${jobId} not found`);
    }

    const logs: string[] = [];
    const metadata = typeof job.metadata === 'string'
      ? JSON.parse(job.metadata)
      : job.metadata;

    // Add basic job info
    logs.push(`Job ID: ${job.id}`);
    logs.push(`Status: ${job.status}`);
    logs.push(`Profile ID: ${job.profile_id}`);

    if (job.started_at) {
      logs.push(`Started: ${job.started_at}`);
    }
    if (job.completed_at) {
      logs.push(`Completed: ${job.completed_at}`);
    }

    logs.push(`Files Scanned: ${job.total_files_scanned}`);
    logs.push(`Matches Found: ${job.total_matches}`);
    logs.push(`Progress: ${job.progress_percent}%`);

    if (job.error_message) {
      logs.push(`Error: ${job.error_message}`);
    }

    // Add metadata logs if present
    if (metadata?.logs && Array.isArray(metadata.logs)) {
      logs.push('--- Agent Logs ---');
      logs.push(...metadata.logs);
    }

    return logs;
  });
}

/**
 * Get recent jobs for a profile
 */
export async function getRecentPiiJobs(
  profileId: string,
  limit: number = 5
): Promise<IGuardPiiJob[]> {
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
    return trx('guard_pii_jobs')
      .where({ tenant, profile_id: profileId })
      .orderBy('started_at', 'desc')
      .limit(limit);
  });
}
