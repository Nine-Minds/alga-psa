'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardPiiProfile,
  ICreatePiiProfileRequest,
  IUpdatePiiProfileRequest,
  IGuardPiiProfileListParams,
  IGuardPaginatedResponse,
  GuardPiiType,
} from '../../../interfaces/guard/pii.interfaces';

// Valid PII types for validation
const VALID_PII_TYPES: GuardPiiType[] = [
  'ssn', 'credit_card', 'bank_account', 'dob', 'drivers_license',
  'passport', 'email', 'phone', 'ip_address', 'mac_address'
];

// Default file extensions
const DEFAULT_FILE_EXTENSIONS = ['txt', 'pdf', 'xls', 'xlsx', 'doc', 'docx', 'zip'];

/**
 * Validate PII types array
 */
function validatePiiTypes(piiTypes: string[]): piiTypes is GuardPiiType[] {
  return piiTypes.every(type => VALID_PII_TYPES.includes(type as GuardPiiType));
}

/**
 * Get all PII profiles with pagination
 */
export async function getPiiProfiles(
  params: IGuardPiiProfileListParams = {}
): Promise<IGuardPaginatedResponse<IGuardPiiProfile>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission
  const canView = await hasPermission(currentUser, 'guard:pii', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:pii:view');
  }

  const {
    page = 1,
    page_size = 20,
    sort_by = 'created_at',
    sort_order = 'desc',
    enabled,
    search,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_pii_profiles')
      .where({ tenant });

    // Apply filters
    if (enabled !== undefined) {
      query = query.where({ enabled });
    }

    if (search) {
      query = query.where(function() {
        this.whereILike('name', `%${search}%`)
          .orWhereILike('description', `%${search}%`);
      });
    }

    // Get total count
    const countResult = await query.clone().count('* as count').first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination and sorting
    const offset = (page - 1) * page_size;
    const profiles = await query
      .orderBy(sort_by, sort_order)
      .limit(page_size)
      .offset(offset);

    return {
      data: profiles as IGuardPiiProfile[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get a single PII profile by ID
 */
export async function getPiiProfile(id: string): Promise<IGuardPiiProfile | null> {
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
    const profile = await trx('guard_pii_profiles')
      .where({ tenant, id })
      .first();

    return profile || null;
  });
}

/**
 * Create a new PII profile
 */
export async function createPiiProfile(
  data: ICreatePiiProfileRequest
): Promise<IGuardPiiProfile> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:pii', 'manage_profiles');
  if (!canManage) {
    throw new Error('Permission denied: guard:pii:manage_profiles');
  }

  // Validate PII types
  if (!data.pii_types || data.pii_types.length === 0) {
    throw new Error('At least one PII type must be selected');
  }

  if (!validatePiiTypes(data.pii_types)) {
    throw new Error('Invalid PII type(s) specified');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [profile] = await trx('guard_pii_profiles')
      .insert({
        tenant,
        name: data.name,
        description: data.description || null,
        pii_types: JSON.stringify(data.pii_types),
        file_extensions: JSON.stringify(data.file_extensions || DEFAULT_FILE_EXTENSIONS),
        target_companies: data.target_companies ? JSON.stringify(data.target_companies) : null,
        target_agents: data.target_agents ? JSON.stringify(data.target_agents) : null,
        include_paths: JSON.stringify(data.include_paths || []),
        exclude_paths: JSON.stringify(data.exclude_paths || []),
        max_file_size_mb: data.max_file_size_mb || 50,
        enabled: data.enabled !== false,
        created_by: currentUser.user_id,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'profile_created',
      resource_type: 'pii_profile',
      resource_id: profile.id,
      details: JSON.stringify({ profile_name: data.name }),
      created_at: new Date(),
    });

    return profile;
  });
}

/**
 * Update an existing PII profile
 */
export async function updatePiiProfile(
  id: string,
  data: IUpdatePiiProfileRequest
): Promise<IGuardPiiProfile> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:pii', 'manage_profiles');
  if (!canManage) {
    throw new Error('Permission denied: guard:pii:manage_profiles');
  }

  // Validate PII types if provided
  if (data.pii_types) {
    if (data.pii_types.length === 0) {
      throw new Error('At least one PII type must be selected');
    }
    if (!validatePiiTypes(data.pii_types)) {
      throw new Error('Invalid PII type(s) specified');
    }
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Check profile exists
    const existing = await trx('guard_pii_profiles')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error(`PII profile ${id} not found`);
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.pii_types !== undefined) updateData.pii_types = JSON.stringify(data.pii_types);
    if (data.file_extensions !== undefined) updateData.file_extensions = JSON.stringify(data.file_extensions);
    if (data.target_companies !== undefined) {
      updateData.target_companies = data.target_companies ? JSON.stringify(data.target_companies) : null;
    }
    if (data.target_agents !== undefined) {
      updateData.target_agents = data.target_agents ? JSON.stringify(data.target_agents) : null;
    }
    if (data.include_paths !== undefined) updateData.include_paths = JSON.stringify(data.include_paths);
    if (data.exclude_paths !== undefined) updateData.exclude_paths = JSON.stringify(data.exclude_paths);
    if (data.max_file_size_mb !== undefined) updateData.max_file_size_mb = data.max_file_size_mb;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    const [profile] = await trx('guard_pii_profiles')
      .where({ tenant, id })
      .update(updateData)
      .returning('*');

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'profile_updated',
      resource_type: 'pii_profile',
      resource_id: id,
      details: JSON.stringify({ changes: Object.keys(updateData) }),
      created_at: new Date(),
    });

    return profile;
  });
}

/**
 * Delete a PII profile
 */
export async function deletePiiProfile(id: string): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:pii', 'manage_profiles');
  if (!canManage) {
    throw new Error('Permission denied: guard:pii:manage_profiles');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Check profile exists
    const existing = await trx('guard_pii_profiles')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error(`PII profile ${id} not found`);
    }

    // Check for associated jobs
    const jobCount = await trx('guard_pii_jobs')
      .where({ tenant, profile_id: id })
      .count('* as count')
      .first();

    if (parseInt(jobCount?.count as string || '0', 10) > 0) {
      throw new Error('Cannot delete profile with associated scan jobs');
    }

    await trx('guard_pii_profiles')
      .where({ tenant, id })
      .delete();

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser.user_id,
      action: 'profile_deleted',
      resource_type: 'pii_profile',
      resource_id: id,
      details: JSON.stringify({ profile_name: existing.name }),
      created_at: new Date(),
    });

    return true;
  });
}

/**
 * Toggle profile enabled status
 */
export async function togglePiiProfileEnabled(id: string): Promise<IGuardPiiProfile> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canManage = await hasPermission(currentUser, 'guard:pii', 'manage_profiles');
  if (!canManage) {
    throw new Error('Permission denied: guard:pii:manage_profiles');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const existing = await trx('guard_pii_profiles')
      .where({ tenant, id })
      .first();

    if (!existing) {
      throw new Error(`PII profile ${id} not found`);
    }

    const [profile] = await trx('guard_pii_profiles')
      .where({ tenant, id })
      .update({
        enabled: !existing.enabled,
        updated_at: new Date(),
      })
      .returning('*');

    return profile;
  });
}
