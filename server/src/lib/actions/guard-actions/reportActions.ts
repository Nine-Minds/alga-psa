'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardReportJob,
  IGuardReportJobWithCompany,
  ICreateReportRequest,
  IGuardReportListParams,
  IGuardReportPaginatedResponse,
  GuardReportType,
  GuardReportFormat,
  REPORT_EXTENSIONS,
} from '../../../interfaces/guard/report.interfaces';
import type { GuardJobStatus } from '../../../interfaces/guard/pii.interfaces';

/**
 * Get all report jobs with pagination
 */
export async function getReportJobs(
  params: IGuardReportListParams = {}
): Promise<IGuardReportPaginatedResponse<IGuardReportJobWithCompany>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // User needs to have at least one view permission
  const canViewPii = await hasPermission(currentUser, 'guard:pii', 'view');
  const canViewAsm = await hasPermission(currentUser, 'guard:asm', 'view');
  const canViewScore = await hasPermission(currentUser, 'guard:score', 'view');

  if (!canViewPii && !canViewAsm && !canViewScore) {
    throw new Error('Permission denied: No guard view permissions');
  }

  const {
    page = 1,
    page_size = 20,
    sort_by = 'created_at',
    sort_order = 'desc',
    report_type,
    status,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_report_jobs as r')
      .select(
        'r.*',
        'c.company_name'
      )
      .leftJoin('companies as c', function() {
        this.on('r.company_id', '=', 'c.company_id')
          .andOn('r.tenant', '=', 'c.tenant');
      })
      .where('r.tenant', tenant);

    // Apply filters
    if (report_type) {
      query = query.where('r.report_type', report_type);
    }

    if (status) {
      query = query.where('r.status', status);
    }

    // Get total count
    const countResult = await query.clone()
      .clearSelect()
      .count('r.id as count')
      .first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination and sorting
    const offset = (page - 1) * page_size;
    const reports = await query
      .orderBy(`r.${sort_by}`, sort_order)
      .limit(page_size)
      .offset(offset);

    return {
      data: reports as IGuardReportJobWithCompany[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get a single report job by ID
 */
export async function getReportJob(id: string): Promise<IGuardReportJobWithCompany | null> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const report = await trx('guard_report_jobs as r')
      .select(
        'r.*',
        'c.company_name'
      )
      .leftJoin('companies as c', function() {
        this.on('r.company_id', '=', 'c.company_id')
          .andOn('r.tenant', '=', 'c.tenant');
      })
      .where('r.tenant', tenant)
      .where('r.id', id)
      .first();

    return report || null;
  });
}

/**
 * Create a new report job (queues the report for generation)
 */
export async function createReportJob(
  data: ICreateReportRequest
): Promise<IGuardReportJob> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check appropriate permission based on report type
  let hasRequiredPermission = false;
  switch (data.report_type) {
    case 'pii':
      hasRequiredPermission = await hasPermission(currentUser, 'guard:pii', 'view');
      break;
    case 'asm':
      hasRequiredPermission = await hasPermission(currentUser, 'guard:asm', 'view');
      break;
    case 'security_score':
      hasRequiredPermission = await hasPermission(currentUser, 'guard:score', 'view');
      break;
    case 'combined':
      const canViewPii = await hasPermission(currentUser, 'guard:pii', 'view');
      const canViewAsm = await hasPermission(currentUser, 'guard:asm', 'view');
      const canViewScore = await hasPermission(currentUser, 'guard:score', 'view');
      hasRequiredPermission = canViewPii && canViewAsm && canViewScore;
      break;
  }

  if (!hasRequiredPermission) {
    throw new Error(`Permission denied: Cannot generate ${data.report_type} reports`);
  }

  // Validate company exists if specified
  if (data.company_id) {
    const { knex: db2 } = await createTenantKnex();
    const company = await db2('companies')
      .where({ tenant, company_id: data.company_id })
      .first();
    if (!company) {
      throw new Error('Company not found');
    }
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [report] = await trx('guard_report_jobs')
      .insert({
        tenant,
        name: data.name,
        report_type: data.report_type,
        format: data.format,
        status: 'queued' as GuardJobStatus,
        company_id: data.company_id || null,
        date_from: data.date_from ? new Date(data.date_from) : null,
        date_to: data.date_to ? new Date(data.date_to) : null,
        created_at: new Date(),
        created_by: currentUser.user_id,
      })
      .returning('*');

    // Queue report generation job
    // Note: In production, this would use PG Boss to queue the job
    // await scheduleImmediateJob('guard:report:generate', { reportId: report.id });

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'report_created',
      resource_type: 'guard_report',
      resource_id: report.id,
      details: JSON.stringify({
        name: data.name,
        report_type: data.report_type,
        format: data.format,
        company_id: data.company_id,
      }),
      created_at: new Date(),
    });

    return report;
  });
}

/**
 * Update report job status (internal use by report generator)
 */
export async function updateReportJobStatus(
  reportId: string,
  status: GuardJobStatus,
  updates?: {
    file_path?: string;
    file_size?: number;
    error_message?: string;
    started_at?: Date;
    completed_at?: Date;
  }
): Promise<IGuardReportJob> {
  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context required');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const updateData: Record<string, unknown> = {
      status,
    };

    if (updates?.file_path !== undefined) updateData.file_path = updates.file_path;
    if (updates?.file_size !== undefined) updateData.file_size = updates.file_size;
    if (updates?.error_message !== undefined) updateData.error_message = updates.error_message;
    if (updates?.started_at !== undefined) updateData.started_at = updates.started_at;
    if (updates?.completed_at !== undefined) updateData.completed_at = updates.completed_at;

    const [report] = await trx('guard_report_jobs')
      .where({ tenant, id: reportId })
      .update(updateData)
      .returning('*');

    return report;
  });
}

/**
 * Get report download info
 */
export async function getReportDownloadInfo(id: string): Promise<{
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
} | null> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const report = await trx('guard_report_jobs')
      .where({ tenant, id })
      .first();

    if (!report) {
      return null;
    }

    if (report.status !== 'completed' || !report.file_path) {
      return null;
    }

    const mimeTypes: Record<GuardReportFormat, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    };

    const extension = REPORT_EXTENSIONS[report.format as GuardReportFormat];
    const fileName = `${report.name.replace(/[^a-zA-Z0-9-_]/g, '_')}${extension}`;

    return {
      file_path: report.file_path,
      file_name: fileName,
      mime_type: mimeTypes[report.format as GuardReportFormat],
      file_size: report.file_size || 0,
    };
  });
}

/**
 * Delete a report job
 */
export async function deleteReportJob(id: string): Promise<void> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const existing = await trx('guard_report_jobs')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error('Report not found');
    }

    // Don't allow deleting running jobs
    if (existing.status === 'running') {
      throw new Error('Cannot delete a running report job');
    }

    // TODO: Delete the file from storage if it exists
    // if (existing.file_path) {
    //   await deleteFile(existing.file_path);
    // }

    await trx('guard_report_jobs')
      .where({ tenant, id })
      .delete();

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'report_deleted',
      resource_type: 'guard_report',
      resource_id: id,
      details: JSON.stringify({
        name: existing.name,
        report_type: existing.report_type,
      }),
      created_at: new Date(),
    });
  });
}

/**
 * Get recent reports for a company
 */
export async function getRecentReportsForCompany(
  companyId: string,
  limit: number = 5
): Promise<IGuardReportJob[]> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    return trx('guard_report_jobs')
      .where({ tenant, company_id: companyId })
      .orderBy('created_at', 'desc')
      .limit(limit);
  });
}

/**
 * Cancel a queued report job
 */
export async function cancelReportJob(id: string): Promise<IGuardReportJob> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const existing = await trx('guard_report_jobs')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error('Report not found');
    }

    if (existing.status !== 'queued') {
      throw new Error('Only queued reports can be cancelled');
    }

    const [report] = await trx('guard_report_jobs')
      .where({ tenant, id })
      .update({
        status: 'cancelled' as GuardJobStatus,
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'report_cancelled',
      resource_type: 'guard_report',
      resource_id: id,
      details: JSON.stringify({
        name: existing.name,
      }),
      created_at: new Date(),
    });

    return report;
  });
}
