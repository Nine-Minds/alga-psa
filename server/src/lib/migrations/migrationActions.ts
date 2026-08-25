'use server';

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { JobService } from '@alga-psa/jobs';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import { MigrationStager } from './MigrationStager';
import { MigrationPlanner, parseConfiguration } from './MigrationPlanner';
import { MigrationReportService } from './MigrationReportService';
import {
  MAX_MIGRATION_PACKAGE_BYTES,
  type MigrationEntityProgress,
  type MigrationJobConfiguration,
  type MigrationJobDetails,
  type MigrationJobSummary,
  type MigrationOutcomeRecord,
  type MigrationOutcomeSummary,
  type MigrationUploadResult,
  type PreflightResult,
} from './types';

const SUPPORTED_PACKAGE_EXTENSIONS = ['.amp', '.sqlite'];

async function requirePermission(action: 'read' | 'manage'): Promise<{ tenant: string; userId: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }
  const allowed = await hasPermission(currentUser, 'import_export', action);
  if (!allowed) {
    throw new Error('Permission denied for imports & exports');
  }
  if (!currentUser.tenant) {
    throw new Error('No tenant found');
  }
  return { tenant: currentUser.tenant, userId: currentUser.user_id };
}

/**
 * Upload an AMP package: store it, create the migration job, then inspect and
 * stage it. An invalid package is rejected with its diagnostics; nothing is
 * staged and no Alga entity is ever created by this path.
 */
export async function uploadMigrationPackage(formData: FormData): Promise<MigrationUploadResult> {
  const { tenant, userId } = await requirePermission('manage');

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File)) {
    throw new Error('No package file provided');
  }
  if (fileEntry.size > MAX_MIGRATION_PACKAGE_BYTES) {
    throw new Error('Migration packages must be 250 MB or smaller.');
  }
  const normalizedName = fileEntry.name?.toLowerCase() ?? '';
  const extension = normalizedName.includes('.')
    ? normalizedName.slice(normalizedName.lastIndexOf('.'))
    : '';
  if (!SUPPORTED_PACKAGE_EXTENSIONS.includes(extension)) {
    throw new Error('Unsupported file format. Upload an .amp package.');
  }

  await StorageService.validateFileUpload(tenant, 'application/octet-stream', fileEntry.size);

  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  const fileRecord = await StorageService.uploadFile(tenant, buffer, fileEntry.name, {
    mime_type: 'application/octet-stream',
    uploaded_by_id: userId,
    metadata: { context: 'migration_package', sha256 },
  });

  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);
  const [job] = await db
    .table('migration_jobs')
    .insert({
      tenant,
      owner_user_id: userId,
      source_file_id: fileRecord.file_id,
      source_file_name: fileEntry.name,
      package_sha256: sha256,
      state: 'inspecting',
    })
    .returning('migration_job_id');
  const migrationJobId: string = job.migration_job_id ?? job;

  const directory = await mkdtemp(join(tmpdir(), 'amp-upload-'));
  const packagePath = join(directory, 'package.amp');
  try {
    await writeFile(packagePath, buffer, { mode: 0o600 });
    const stager = new MigrationStager(knex, tenant);
    const result = await stager.stage(migrationJobId, packagePath);
    return {
      migrationJobId,
      state: result.rejected ? 'rejected' : 'needs_configuration',
      diagnostics: result.validation.diagnostics,
      rowCounts: result.validation.rowCounts,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function listMigrationJobs(): Promise<MigrationJobSummary[]> {
  const { tenant } = await requirePermission('read');
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  const jobs = await db.table('migration_jobs').orderBy('created_at', 'desc').limit(100);
  const entities = await db
    .table('migration_job_entities')
    .whereIn(
      'migration_job_id',
      jobs.map((job) => job.migration_job_id)
    );

  return jobs.map((job) => toSummary(job, entities));
}

export async function getMigrationJobDetails(migrationJobId: string): Promise<MigrationJobDetails> {
  const { tenant } = await requirePermission('read');
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
  if (!job) {
    throw new Error('Migration job not found');
  }
  const entities = await db.table('migration_job_entities').where({ migration_job_id: migrationJobId });

  return {
    ...toSummary(job, entities),
    manifest: typeof job.manifest === 'string' ? JSON.parse(job.manifest) : job.manifest,
    configuration: parseConfiguration(job.configuration),
    error: job.error ?? null,
    preflightedAt: job.preflighted_at ? new Date(job.preflighted_at).toISOString() : null,
    startedAt: job.started_at ? new Date(job.started_at).toISOString() : null,
  };
}

export interface MigrationConfigurationOptions {
  boards: Array<{ id: string; name: string }>;
  statuses: Array<{ id: string; name: string }>;
  priorities: Array<{ id: string; name: string }>;
  assetTypes: Array<{ slug: string; name: string }>;
  clients: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
  packageStatusNames: string[];
  packagePriorityNames: string[];
  packageAssetTypeNames: string[];
  stagedEntityTypes: AmpEntityType[];
}

export async function getMigrationConfigurationOptions(
  migrationJobId: string
): Promise<MigrationConfigurationOptions> {
  const { tenant } = await requirePermission('read');
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  const distinctPayloadValues = async (entityType: string, field: string): Promise<string[]> => {
    const rows = await db
      .table('migration_staged_records')
      .where({ migration_job_id: migrationJobId, entity_type: entityType })
      .whereRaw('payload ->> ? IS NOT NULL', [field])
      .distinct(knex.raw('payload ->> ? AS value', [field]))
      .orderBy('value');
    return rows.map((row: { value: string }) => row.value);
  };

  const [boards, statuses, priorities, assetTypes, clients, users, stagedTypes] = await Promise.all([
    db.table('boards').select('board_id', 'board_name').orderBy('board_name'),
    db
      .table('statuses')
      .where({ status_type: 'ticket' })
      .select('status_id', 'name')
      .orderBy('order_number'),
    db.table('priorities').select('priority_id', 'priority_name').orderBy('order_number'),
    db.table('asset_type_registry').select('slug', 'display_name').orderBy('display_name'),
    db.table('clients').where({ is_inactive: false }).select('client_id', 'client_name').orderBy('client_name'),
    db
      .table('users')
      .where({ is_inactive: false })
      .select('user_id', 'first_name', 'last_name')
      .orderBy(['first_name', 'last_name']),
    db
      .table('migration_staged_records')
      .where({ migration_job_id: migrationJobId })
      .distinct('entity_type'),
  ]);

  const [packageStatusNames, packagePriorityNames, packageAssetTypeNames] = await Promise.all([
    distinctPayloadValues('tickets', 'status_name'),
    distinctPayloadValues('tickets', 'priority_name'),
    distinctPayloadValues('assets', 'asset_type_name'),
  ]);

  return {
    boards: boards.map((row) => ({ id: row.board_id, name: row.board_name })),
    statuses: statuses.map((row) => ({ id: row.status_id, name: row.name })),
    priorities: priorities.map((row) => ({ id: row.priority_id, name: row.priority_name })),
    assetTypes: assetTypes.map((row) => ({ slug: row.slug, name: row.display_name })),
    clients: clients.map((row) => ({ id: row.client_id, name: row.client_name })),
    users: users.map((row) => ({
      id: row.user_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    })),
    packageStatusNames,
    packagePriorityNames,
    packageAssetTypeNames,
    stagedEntityTypes: stagedTypes.map((row: { entity_type: AmpEntityType }) => row.entity_type),
  };
}

export async function saveMigrationConfiguration(
  migrationJobId: string,
  configuration: MigrationJobConfiguration
): Promise<void> {
  const { tenant } = await requirePermission('manage');
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
  if (!job) {
    throw new Error('Migration job not found');
  }
  if (['queued', 'applying', 'completed', 'completed_with_errors'].includes(job.state)) {
    throw new Error(`Configuration cannot change while the job is ${job.state}.`);
  }

  await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
    configuration: JSON.stringify(configuration),
    // Changing configuration invalidates any prior plan.
    state: 'needs_configuration',
    preflighted_at: null,
    updated_at: knex.fn.now(),
  });
}

export async function preflightMigrationJob(migrationJobId: string): Promise<PreflightResult> {
  const { tenant } = await requirePermission('manage');
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
  if (!job) {
    throw new Error('Migration job not found');
  }
  if (!['needs_configuration', 'blocked', 'ready'].includes(job.state)) {
    throw new Error(`Job in state ${job.state} cannot be preflighted.`);
  }

  await db
    .table('migration_jobs')
    .where({ migration_job_id: migrationJobId })
    .update({ state: 'preflighting', updated_at: knex.fn.now() });

  const planner = new MigrationPlanner(knex, tenant);
  return planner.preflight(migrationJobId);
}

export async function executeMigrationJob(migrationJobId: string): Promise<{ jobId: string }> {
  const { tenant, userId } = await requirePermission('manage');
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
  if (!job) {
    throw new Error('Migration job not found');
  }
  if (job.state !== 'ready') {
    throw new Error('Only a job with a clean preflight can run. Preflight it first.');
  }

  const jobService = await JobService.create();
  const { jobRecord } = await jobService.createAndScheduleJob('migration_apply', {
    tenantId: tenant,
    metadata: { user_id: userId, migrationJobId },
    migrationJobId,
    userId,
  });
  if (!jobRecord.id) {
    throw new Error('Migration job scheduling completed without returning a job id.');
  }

  await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
    state: 'queued',
    job_id: jobRecord.id,
    queued_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  return { jobId: jobRecord.id };
}

export async function cancelMigrationJob(migrationJobId: string): Promise<void> {
  const { tenant } = await requirePermission('manage');
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
  if (!job) {
    throw new Error('Migration job not found');
  }
  if (!['queued', 'applying'].includes(job.state)) {
    throw new Error(`Job in state ${job.state} cannot be cancelled.`);
  }

  await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).update({
    cancel_requested_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });
}

export async function getMigrationPreflightReport(
  migrationJobId: string
): Promise<PreflightResult | null> {
  const { tenant } = await requirePermission('read');
  const { knex } = await createTenantKnex(tenant);
  return new MigrationReportService(knex, tenant).getPreflightReport(migrationJobId);
}

export async function getMigrationOutcomeSummary(
  migrationJobId: string
): Promise<MigrationOutcomeSummary[]> {
  const { tenant } = await requirePermission('read');
  const { knex } = await createTenantKnex(tenant);
  return new MigrationReportService(knex, tenant).getOutcomeSummary(migrationJobId);
}

export async function getMigrationOutcomeRecords(
  migrationJobId: string,
  options: {
    entityType?: AmpEntityType;
    action?: 'created' | 'skipped' | 'failed';
    limit?: number;
  } = {}
): Promise<MigrationOutcomeRecord[]> {
  const { tenant } = await requirePermission('read');
  const { knex } = await createTenantKnex(tenant);
  return new MigrationReportService(knex, tenant).getOutcomeRecords(migrationJobId, options);
}

/** CSV export of the preflight or outcome report for download. */
export async function getMigrationReportCsv(
  migrationJobId: string,
  reportType: 'preflight' | 'outcome'
): Promise<string> {
  const { tenant } = await requirePermission('read');
  const { knex } = await createTenantKnex(tenant);
  const reports = new MigrationReportService(knex, tenant);

  if (reportType === 'preflight') {
    const report = await reports.getPreflightReport(migrationJobId);
    if (!report) {
      return '';
    }
    return reports.toCsv(
      report.issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        entity_type: issue.entityType ?? '',
        record_count: issue.recordCount ?? '',
        message: issue.message,
      }))
    );
  }

  const records = await reports.getOutcomeRecords(migrationJobId, { limit: 100_000 });
  return reports.toCsv(
    records.map((record) => ({
      entity_type: record.entityType,
      package_record_id: record.packageRecordId,
      source_record_id: record.sourceRecordId,
      attempt: record.attempt,
      action: record.action,
      target_entity_type: record.targetEntityType ?? '',
      target_entity_id: record.targetEntityId ?? '',
      errors: record.errors.join('; '),
      created_at: record.createdAt,
    }))
  );
}

export interface MigrationMappingProfile {
  migrationMappingProfileId: string;
  entityType: string;
  sourceSignature: string;
  name: string;
  mapping: Record<string, string>;
  updatedAt: string;
}

/**
 * Saved CSV/source→canonical mapping profiles, scoped to entity type and
 * source signature (the ordered header set) so a repeat import of the same
 * shape needs no re-mapping.
 */
export async function listMigrationMappingProfiles(
  entityType: string,
  sourceSignature?: string
): Promise<MigrationMappingProfile[]> {
  const { tenant } = await requirePermission('read');
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  let query = db
    .table('migration_mapping_profiles')
    .where({ entity_type: entityType })
    .orderBy('updated_at', 'desc')
    .limit(50);
  if (sourceSignature) {
    query = query.where({ source_signature: sourceSignature });
  }
  const rows = await query;
  return rows.map((row) => ({
    migrationMappingProfileId: row.migration_mapping_profile_id,
    entityType: row.entity_type,
    sourceSignature: row.source_signature,
    name: row.name,
    mapping: typeof row.mapping === 'string' ? JSON.parse(row.mapping) : row.mapping,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function saveMigrationMappingProfile(profile: {
  entityType: string;
  sourceSignature: string;
  name: string;
  mapping: Record<string, string>;
}): Promise<void> {
  const { tenant, userId } = await requirePermission('manage');
  if (!profile.name.trim()) {
    throw new Error('A mapping profile needs a name.');
  }
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);

  await db
    .table('migration_mapping_profiles')
    .insert({
      tenant,
      entity_type: profile.entityType,
      source_signature: profile.sourceSignature,
      name: profile.name.trim(),
      mapping: JSON.stringify(profile.mapping),
      created_by: userId,
    })
    .onConflict(['tenant', 'entity_type', 'source_signature', 'name'])
    .merge({ mapping: JSON.stringify(profile.mapping), updated_at: knex.fn.now() });
}

function toSummary(
  job: Record<string, unknown>,
  entities: Array<Record<string, unknown>>
): MigrationJobSummary {
  const entityCounts: Partial<Record<AmpEntityType, MigrationEntityProgress>> = {};
  for (const entity of entities) {
    if (entity.migration_job_id !== job.migration_job_id) {
      continue;
    }
    entityCounts[entity.entity_type as AmpEntityType] = {
      phase: Number(entity.phase),
      state: String(entity.state),
      plannedCount: Number(entity.planned_count),
      appliedCount: Number(entity.applied_count),
      skippedCount: Number(entity.skipped_count),
      failedCount: Number(entity.failed_count),
    };
  }
  return {
    migrationJobId: String(job.migration_job_id),
    state: job.state as MigrationJobSummary['state'],
    sourceFileName: String(job.source_file_name),
    packageId: (job.package_id as string | null) ?? null,
    sourceSystem: (job.source_system as string | null) ?? null,
    producer: job.producer_name ? `${job.producer_name}@${job.producer_version}` : null,
    createdAt: new Date(job.created_at as string).toISOString(),
    updatedAt: new Date(job.updated_at as string).toISOString(),
    completedAt: job.completed_at ? new Date(job.completed_at as string).toISOString() : null,
    ownerUserId: String(job.owner_user_id),
    entityCounts,
  };
}
