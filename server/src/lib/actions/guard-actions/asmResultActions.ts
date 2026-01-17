'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardAsmResult,
  IGuardAsmResultListParams,
  IGuardAsmPaginatedResponse,
  GuardAsmResultType,
  ISubdomainData,
  IIpAddressData,
  IOpenPortData,
  ICveData,
  IDnsRecordData,
  IHttpHeaderData,
  ICloudStorageData,
  IEmailSecurityData,
} from '../../../interfaces/guard/asm.interfaces';

/**
 * Get all ASM results with pagination
 */
export async function getAsmResults(
  params: IGuardAsmResultListParams = {}
): Promise<IGuardAsmPaginatedResponse<IGuardAsmResult>> {
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
    sort_by = 'found_at',
    sort_order = 'desc',
    job_id,
    domain_id,
    result_type,
    severity,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_asm_results')
      .where({ tenant });

    // Apply filters
    if (job_id) {
      query = query.where('job_id', job_id);
    }

    if (domain_id) {
      query = query.where('domain_id', domain_id);
    }

    if (result_type) {
      query = query.where('result_type', result_type);
    }

    if (severity) {
      query = query.where('severity', severity);
    }

    // Get total count
    const countResult = await query.clone()
      .count('id as count')
      .first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination and sorting
    const offset = (page - 1) * page_size;
    const results = await query
      .orderBy(sort_by, sort_order)
      .limit(page_size)
      .offset(offset);

    return {
      data: results as IGuardAsmResult[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get a single ASM result by ID
 */
export async function getAsmResult(id: string): Promise<IGuardAsmResult | null> {
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
    const result = await trx('guard_asm_results')
      .where({ tenant, id })
      .first();

    return result || null;
  });
}

/**
 * Get ASM results by job
 */
export async function getAsmResultsByJob(
  jobId: string,
  params: { page?: number; page_size?: number; result_type?: GuardAsmResultType } = {}
): Promise<IGuardAsmPaginatedResponse<IGuardAsmResult>> {
  return getAsmResults({ ...params, job_id: jobId });
}

/**
 * Get ASM results by domain
 */
export async function getAsmResultsByDomain(
  domainId: string,
  params: { page?: number; page_size?: number; result_type?: GuardAsmResultType } = {}
): Promise<IGuardAsmPaginatedResponse<IGuardAsmResult>> {
  return getAsmResults({ ...params, domain_id: domainId });
}

/**
 * Get subdomains for a domain
 */
export async function getAsmSubdomains(
  domainId: string
): Promise<Array<IGuardAsmResult & { data: ISubdomainData }>> {
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
    return trx('guard_asm_results')
      .where({ tenant, domain_id: domainId, result_type: 'subdomain' })
      .orderBy('found_at', 'desc');
  });
}

/**
 * Get IP addresses for a domain
 */
export async function getAsmIpAddresses(
  domainId: string
): Promise<Array<IGuardAsmResult & { data: IIpAddressData }>> {
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
    return trx('guard_asm_results')
      .where({ tenant, domain_id: domainId, result_type: 'ip_address' })
      .orderBy('found_at', 'desc');
  });
}

/**
 * Get open ports for a domain
 */
export async function getAsmOpenPorts(
  domainId: string
): Promise<Array<IGuardAsmResult & { data: IOpenPortData }>> {
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
    return trx('guard_asm_results')
      .where({ tenant, domain_id: domainId, result_type: 'open_port' })
      .orderBy('found_at', 'desc');
  });
}

/**
 * Get CVEs for a domain
 */
export async function getAsmCves(
  domainId: string,
  minSeverity?: 'low' | 'medium' | 'high' | 'critical'
): Promise<Array<IGuardAsmResult & { data: ICveData }>> {
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
    let query = trx('guard_asm_results')
      .where({ tenant, domain_id: domainId, result_type: 'cve' });

    if (minSeverity) {
      const severityOrder = ['low', 'medium', 'high', 'critical'];
      const minIndex = severityOrder.indexOf(minSeverity);
      const allowedSeverities = severityOrder.slice(minIndex);
      query = query.whereIn('severity', allowedSeverities);
    }

    return query.orderBy('severity', 'desc').orderBy('found_at', 'desc');
  });
}

/**
 * Get DNS records for a domain
 */
export async function getAsmDnsRecords(
  domainId: string
): Promise<Array<IGuardAsmResult & { data: IDnsRecordData }>> {
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
    return trx('guard_asm_results')
      .where({ tenant, domain_id: domainId, result_type: 'dns_record' })
      .orderBy('found_at', 'desc');
  });
}

/**
 * Get HTTP headers analysis for a domain
 */
export async function getAsmHttpHeaders(
  domainId: string
): Promise<Array<IGuardAsmResult & { data: IHttpHeaderData }>> {
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
    return trx('guard_asm_results')
      .where({ tenant, domain_id: domainId, result_type: 'http_header' })
      .orderBy('found_at', 'desc');
  });
}

/**
 * Get cloud storage findings for a domain
 */
export async function getAsmCloudStorage(
  domainId: string
): Promise<Array<IGuardAsmResult & { data: ICloudStorageData }>> {
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
    return trx('guard_asm_results')
      .where({ tenant, domain_id: domainId, result_type: 'cloud_storage' })
      .orderBy('found_at', 'desc');
  });
}

/**
 * Get email security findings for a domain
 */
export async function getAsmEmailSecurity(
  domainId: string
): Promise<Array<IGuardAsmResult & { data: IEmailSecurityData }>> {
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
    return trx('guard_asm_results')
      .where({ tenant, domain_id: domainId, result_type: 'email_security' })
      .orderBy('found_at', 'desc');
  });
}

/**
 * Create ASM result (internal use by scanner)
 */
export async function createAsmResult(
  data: {
    job_id: string;
    domain_id: string;
    result_type: GuardAsmResultType;
    data: Record<string, unknown>;
    severity?: string;
  }
): Promise<IGuardAsmResult> {
  const { knex: db, tenant } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [result] = await trx('guard_asm_results')
      .insert({
        tenant,
        job_id: data.job_id,
        domain_id: data.domain_id,
        result_type: data.result_type,
        data: JSON.stringify(data.data),
        severity: data.severity || null,
        found_at: new Date(),
      })
      .returning('*');

    return result;
  });
}

/**
 * Create multiple ASM results at once (batch insert)
 */
export async function createAsmResultsBatch(
  jobId: string,
  domainId: string,
  results: Array<{
    result_type: GuardAsmResultType;
    data: Record<string, unknown>;
    severity?: string;
  }>
): Promise<number> {
  const { knex: db, tenant } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const insertData = results.map(r => ({
      tenant,
      job_id: jobId,
      domain_id: domainId,
      result_type: r.result_type,
      data: JSON.stringify(r.data),
      severity: r.severity || null,
      found_at: new Date(),
    }));

    await trx('guard_asm_results').insert(insertData);
    return insertData.length;
  });
}

/**
 * Get result type summary for a job
 */
export async function getAsmResultTypeSummary(
  jobId: string
): Promise<Record<GuardAsmResultType, number>> {
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
    const counts = await trx('guard_asm_results')
      .where({ tenant, job_id: jobId })
      .select('result_type')
      .count('* as count')
      .groupBy('result_type');

    const summary: Record<string, number> = {};
    for (const row of counts) {
      summary[row.result_type] = parseInt(row.count as string, 10);
    }

    return summary as Record<GuardAsmResultType, number>;
  });
}

/**
 * Get severity summary for a domain
 */
export async function getAsmSeveritySummary(
  domainId: string
): Promise<{ critical: number; high: number; medium: number; low: number; info: number }> {
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
    const counts = await trx('guard_asm_results')
      .where({ tenant, domain_id: domainId })
      .whereNotNull('severity')
      .select('severity')
      .count('* as count')
      .groupBy('severity');

    const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const row of counts) {
      const sev = row.severity as keyof typeof summary;
      if (sev in summary) {
        summary[sev] = parseInt(row.count as string, 10);
      }
    }

    return summary;
  });
}

/**
 * Delete all ASM results for a job
 */
export async function deleteAsmResultsByJob(jobId: string): Promise<number> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:asm', 'manage_domains');
  if (!canManage) {
    throw new Error('Permission denied: guard:asm:manage_domains');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const deletedCount = await trx('guard_asm_results')
      .where({ tenant, job_id: jobId })
      .delete();

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'asm_results_purged',
      resource_type: 'asm_job',
      resource_id: jobId,
      details: JSON.stringify({ deleted_count: deletedCount }),
      created_at: new Date(),
    });

    return deletedCount;
  });
}
