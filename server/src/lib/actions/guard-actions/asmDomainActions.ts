'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardAsmDomain,
  IGuardAsmDomainWithCompany,
  ICreateAsmDomainRequest,
  IUpdateAsmDomainRequest,
  IGuardAsmDomainListParams,
  IGuardAsmPaginatedResponse,
} from '../../../interfaces/guard/asm.interfaces';

/**
 * Domain name validation regex
 * Matches valid domain names like example.com, sub.example.co.uk
 */
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

/**
 * Validate domain name format
 */
export function validateDomainName(domain: string): boolean {
  if (!domain || typeof domain !== 'string') {
    return false;
  }

  const trimmed = domain.trim().toLowerCase();

  // Check length
  if (trimmed.length < 4 || trimmed.length > 253) {
    return false;
  }

  // Check format
  return DOMAIN_REGEX.test(trimmed);
}

/**
 * Normalize domain name (lowercase, trim)
 */
function normalizeDomainName(domain: string): string {
  return domain.trim().toLowerCase();
}

/**
 * Get all ASM domains with pagination
 */
export async function getAsmDomains(
  params: IGuardAsmDomainListParams = {}
): Promise<IGuardAsmPaginatedResponse<IGuardAsmDomainWithCompany>> {
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
    sort_by = 'created_at',
    sort_order = 'desc',
    company_id,
    enabled,
    search,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_asm_domains as d')
      .select(
        'd.*',
        'c.company_name as company_name'
      )
      .join('companies as c', function() {
        this.on('d.company_id', '=', 'c.company_id')
          .andOn('d.tenant', '=', 'c.tenant');
      })
      .where('d.tenant', tenant);

    // Apply filters
    if (company_id) {
      query = query.where('d.company_id', company_id);
    }

    if (enabled !== undefined) {
      query = query.where('d.enabled', enabled);
    }

    if (search) {
      query = query.where(function() {
        this.whereILike('d.domain_name', `%${search}%`)
          .orWhereILike('c.company_name', `%${search}%`);
      });
    }

    // Get total count
    const countResult = await query.clone()
      .clearSelect()
      .count('d.id as count')
      .first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination and sorting
    const offset = (page - 1) * page_size;
    const sortColumn = sort_by === 'company_name' ? 'c.company_name' : `d.${sort_by}`;
    const domains = await query
      .orderBy(sortColumn, sort_order)
      .limit(page_size)
      .offset(offset);

    return {
      data: domains as IGuardAsmDomainWithCompany[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get a single ASM domain by ID
 */
export async function getAsmDomain(id: string): Promise<IGuardAsmDomainWithCompany | null> {
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
    const domain = await trx('guard_asm_domains as d')
      .select(
        'd.*',
        'c.company_name as company_name'
      )
      .join('companies as c', function() {
        this.on('d.company_id', '=', 'c.company_id')
          .andOn('d.tenant', '=', 'c.tenant');
      })
      .where('d.tenant', tenant)
      .where('d.id', id)
      .first();

    return domain || null;
  });
}

/**
 * Create a new ASM domain
 */
export async function createAsmDomain(
  data: ICreateAsmDomainRequest
): Promise<IGuardAsmDomain> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:asm', 'manage_domains');
  if (!canManage) {
    throw new Error('Permission denied: guard:asm:manage_domains');
  }

  // Validate domain name
  if (!validateDomainName(data.domain_name)) {
    throw new Error('Invalid domain name format');
  }

  const normalizedDomain = normalizeDomainName(data.domain_name);

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Check if company exists
    const company = await trx('companies')
      .where({ tenant, company_id: data.company_id })
      .first();

    if (!company) {
      throw new Error(`Company ${data.company_id} not found`);
    }

    // Check for duplicate domain
    const existing = await trx('guard_asm_domains')
      .where({ tenant, domain_name: normalizedDomain })
      .first();

    if (existing) {
      throw new Error(`Domain ${normalizedDomain} already exists`);
    }

    // Insert domain
    const [domain] = await trx('guard_asm_domains')
      .insert({
        tenant,
        company_id: data.company_id,
        domain_name: normalizedDomain,
        ownership_verified: data.ownership_verified ?? false,
        enabled: data.enabled ?? true,
        created_by: currentUser.user_id,
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'domain_created',
      resource_type: 'asm_domain',
      resource_id: domain.id,
      details: JSON.stringify({
        domain_name: normalizedDomain,
        company_id: data.company_id,
      }),
      created_at: new Date(),
    });

    return domain;
  });
}

/**
 * Update an ASM domain
 */
export async function updateAsmDomain(
  id: string,
  data: IUpdateAsmDomainRequest
): Promise<IGuardAsmDomain> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:asm', 'manage_domains');
  if (!canManage) {
    throw new Error('Permission denied: guard:asm:manage_domains');
  }

  // Validate domain name if provided
  if (data.domain_name !== undefined) {
    if (!validateDomainName(data.domain_name)) {
      throw new Error('Invalid domain name format');
    }
    data.domain_name = normalizeDomainName(data.domain_name);
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Check domain exists
    const existing = await trx('guard_asm_domains')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error(`ASM domain ${id} not found`);
    }

    // Check for duplicate if domain name is being changed
    if (data.domain_name && data.domain_name !== existing.domain_name) {
      const duplicate = await trx('guard_asm_domains')
        .where({ tenant, domain_name: data.domain_name })
        .whereNot({ id })
        .first();

      if (duplicate) {
        throw new Error(`Domain ${data.domain_name} already exists`);
      }
    }

    // Build update object
    const updateData: Partial<IGuardAsmDomain> = {
      updated_at: new Date() as any,
    };

    if (data.domain_name !== undefined) {
      updateData.domain_name = data.domain_name;
    }
    if (data.ownership_verified !== undefined) {
      updateData.ownership_verified = data.ownership_verified;
    }
    if (data.enabled !== undefined) {
      updateData.enabled = data.enabled;
    }

    // Update domain
    const [domain] = await trx('guard_asm_domains')
      .where({ tenant, id })
      .update(updateData)
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'domain_updated',
      resource_type: 'asm_domain',
      resource_id: id,
      details: JSON.stringify({
        changes: data,
      }),
      created_at: new Date(),
    });

    return domain;
  });
}

/**
 * Delete an ASM domain
 */
export async function deleteAsmDomain(id: string): Promise<void> {
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
    // Check domain exists
    const existing = await trx('guard_asm_domains')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error(`ASM domain ${id} not found`);
    }

    // Check for active jobs
    const activeJobs = await trx('guard_asm_jobs')
      .where({ tenant, domain_id: id })
      .whereIn('status', ['queued', 'running'])
      .first();

    if (activeJobs) {
      throw new Error('Cannot delete domain with active scan jobs');
    }

    // Delete results first (cascade)
    await trx('guard_asm_results')
      .where({ tenant, domain_id: id })
      .delete();

    // Delete jobs
    await trx('guard_asm_jobs')
      .where({ tenant, domain_id: id })
      .delete();

    // Delete domain
    await trx('guard_asm_domains')
      .where({ tenant, id })
      .delete();

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'domain_deleted',
      resource_type: 'asm_domain',
      resource_id: id,
      details: JSON.stringify({
        domain_name: existing.domain_name,
      }),
      created_at: new Date(),
    });
  });
}

/**
 * Toggle domain enabled status
 */
export async function toggleAsmDomainEnabled(id: string): Promise<IGuardAsmDomain> {
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
    const existing = await trx('guard_asm_domains')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error(`ASM domain ${id} not found`);
    }

    const [domain] = await trx('guard_asm_domains')
      .where({ tenant, id })
      .update({
        enabled: !existing.enabled,
        updated_at: new Date(),
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: domain.enabled ? 'domain_enabled' : 'domain_disabled',
      resource_type: 'asm_domain',
      resource_id: id,
      created_at: new Date(),
    });

    return domain;
  });
}

/**
 * Get domains for a specific company
 */
export async function getAsmDomainsForCompany(
  companyId: string
): Promise<IGuardAsmDomain[]> {
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
    return trx('guard_asm_domains')
      .where({ tenant, company_id: companyId })
      .orderBy('domain_name', 'asc');
  });
}
