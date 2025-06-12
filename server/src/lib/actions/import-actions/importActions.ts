'use server';

import { getServerSession } from 'next-auth';
import { options } from '../../../app/api/auth/[...nextauth]/options';
import { createTenantKnex } from '../../db';
import { hasPermission } from '../../auth/rbac';
import { IUser } from '../../../interfaces/auth.interfaces';
import { ImportManager } from '../../import/ImportManager';
import { SourceRegistry } from '../../import/registry';
import logger from '@shared/core/logger';

export interface ImportSource {
  sourceId: string;
  displayName: string;
  enabled: boolean;
  supportsImport: boolean;
  supportsExport: boolean;
}

export interface ImportJob {
  job_id: string;
  source_id: string;
  artifact_type: 'company' | 'contact';
  state: string;
  metadata?: any;
  started_at: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
  requested_by?: string;
  workflow_execution_id?: string;
}

export interface ImportJobSummary extends ImportJob {
  totalCount?: number;
  successCount?: number;
  errorCount?: number;
  duration?: number;
}

/**
 * Get available import sources from the database
 */
export async function getImportSources(): Promise<ImportSource[]> {
  const session = await getServerSession(options);
  if (!session?.user || !session.user.tenant) {
    throw new Error('Unauthorized');
  }

  // Check permissions
  const userObj: IUser = {
    user_id: session.user.id,
    username: session.user.username || '',
    email: session.user.email || '',
    hashed_password: '',
    is_inactive: false,
    tenant: session.user.tenant,
    user_type: session.user.user_type
  };

  const canRead = await hasPermission(userObj, 'settings.import_export', 'read');
  if (!canRead) {
    throw new Error('Forbidden');
  }

  const { knex } = await createTenantKnex();
  
  try {
    // Get sources from database
    logger.info('Fetching import sources from database');
    const dbSources = await knex('import_sources')
      .where({
        enabled: true,
        supports_import: true
      })
      .select('source_id', 'display_name', 'enabled', 'supports_import', 'supports_export');

    logger.info(`Found ${dbSources.length} import sources`, { sources: dbSources });

    // Map database sources to the expected format
    return dbSources.map(source => ({
      sourceId: source.source_id,
      displayName: source.display_name,
      enabled: source.enabled,
      supportsImport: source.supports_import,
      supportsExport: source.supports_export
    }));
  } catch (error) {
    logger.error('Error fetching import sources:', error);
    throw new Error('Failed to fetch import sources');
  }
}

/**
 * Create a new import job
 */
export async function createImportJob(
  sourceId: string,
  artifactType: 'company' | 'contact'
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  const session = await getServerSession(options);
  if (!session?.user || !session.user.tenant) {
    return { success: false, error: 'Unauthorized' };
  }

  // Check permissions
  const userObj: IUser = {
    user_id: session.user.id,
    username: session.user.username || '',
    email: session.user.email || '',
    hashed_password: '',
    is_inactive: false,
    tenant: session.user.tenant,
    user_type: session.user.user_type
  };

  const canManage = await hasPermission(userObj, 'settings.import_export', 'manage');
  if (!canManage) {
    return { success: false, error: 'Forbidden' };
  }

  const { knex, tenant } = await createTenantKnex();
  const importManager = new ImportManager(knex, tenant || session.user.tenant);

  try {
    const jobId = await importManager.startJob(
      sourceId,
      artifactType,
      session.user.id
    );

    return { success: true, jobId };
  } catch (error: any) {
    logger.error('Error creating import job:', error);
    return { success: false, error: error.message || 'Failed to create import job' };
  }
}

/**
 * Get import jobs with optional filtering
 */
export async function getImportJobs(params?: {
  state?: string;
  source_id?: string;
  artifact_type?: 'company' | 'contact';
  limit?: number;
  offset?: number;
}): Promise<{ jobs: ImportJob[]; total: number }> {
  const session = await getServerSession(options);
  if (!session?.user || !session.user.tenant) {
    throw new Error('Unauthorized');
  }

  // Check permissions
  const userObj: IUser = {
    user_id: session.user.id,
    username: session.user.username || '',
    email: session.user.email || '',
    hashed_password: '',
    is_inactive: false,
    tenant: session.user.tenant,
    user_type: session.user.user_type
  };

  const canRead = await hasPermission(userObj, 'settings.import_export', 'read');
  if (!canRead) {
    throw new Error('Forbidden');
  }

  const { knex, tenant } = await createTenantKnex();
  const importManager = new ImportManager(knex, tenant || session.user.tenant);

  try {
    const jobs = await importManager.listJobs({
      state: params?.state,
      source_id: params?.source_id,
      artifact_type: params?.artifact_type,
      limit: params?.limit || 20,
      offset: params?.offset || 0
    });

    // Get total count
    const countResult = await knex('import_jobs')
      .where('tenant', tenant || session.user.tenant)
      .modify((qb) => {
        if (params?.state) qb.where('state', params.state);
        if (params?.source_id) qb.where('source_id', params.source_id);
        if (params?.artifact_type) qb.where('artifact_type', params.artifact_type);
      })
      .count('* as total')
      .first();

    return {
      jobs,
      total: parseInt(countResult?.total || '0')
    };
  } catch (error) {
    logger.error('Error fetching import jobs:', error);
    throw new Error('Failed to fetch import jobs');
  }
}

/**
 * Get detailed information about a specific import job
 */
export async function getImportJob(jobId: string): Promise<ImportJobSummary | null> {
  const session = await getServerSession(options);
  if (!session?.user || !session.user.tenant) {
    throw new Error('Unauthorized');
  }

  // Check permissions
  const userObj: IUser = {
    user_id: session.user.id,
    username: session.user.username || '',
    email: session.user.email || '',
    hashed_password: '',
    is_inactive: false,
    tenant: session.user.tenant,
    user_type: session.user.user_type
  };

  const canRead = await hasPermission(userObj, 'settings.import_export', 'read');
  if (!canRead) {
    throw new Error('Forbidden');
  }

  const { knex, tenant } = await createTenantKnex();
  const importManager = new ImportManager(knex, tenant || session.user.tenant);

  try {
    const job = await importManager.getJob(jobId);
    if (!job) {
      return null;
    }

    // Get summary with counts
    const summary = await importManager.getJobSummary(jobId);
    return summary;
  } catch (error) {
    logger.error('Error fetching import job:', error);
    throw new Error('Failed to fetch import job');
  }
}

/**
 * Subscribe to import job updates
 * This is used for real-time updates via WebSocket
 */
export async function subscribeToImportJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(options);
  if (!session?.user || !session.user.tenant) {
    return { success: false, error: 'Unauthorized' };
  }

  // Check permissions
  const userObj: IUser = {
    user_id: session.user.id,
    username: session.user.username || '',
    email: session.user.email || '',
    hashed_password: '',
    is_inactive: false,
    tenant: session.user.tenant,
    user_type: session.user.user_type
  };

  const canRead = await hasPermission(userObj, 'settings.import_export', 'read');
  if (!canRead) {
    return { success: false, error: 'Forbidden' };
  }

  // The actual WebSocket subscription will be handled client-side
  // This just validates that the user can subscribe
  return { success: true };
}