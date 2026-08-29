import type { AmpDiagnostic } from '@alga-psa/migration-sdk';
import type { AmpEntityType, AmpManifest } from '@alga-psa/migration-spec';

/** Lifecycle states of a migration job (mirrors the migration_job_state enum). */
export type MigrationJobState =
  | 'uploaded'
  | 'inspecting'
  | 'needs_configuration'
  | 'rejected'
  | 'preflighting'
  | 'ready'
  | 'blocked'
  | 'queued'
  | 'applying'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

/** Operator-supplied ticket reference data. Required when tickets are staged. */
export interface TicketMigrationConfiguration {
  boardId: string;
  /** Source status_name → tenant status_id. Every staged status name must map. */
  statusMapping: Record<string, string>;
  /** Source priority_name → tenant priority_id. Every staged priority name must map. */
  priorityMapping: Record<string, string>;
  /** Client used when a ticket's organization cannot be resolved. */
  defaultRequesterClientId: string;
  /** Absent means tickets arrive unassigned. */
  defaultAssigneeId?: string | null;
}

/** Operator-supplied asset reference data. Required when assets are staged. */
export interface AssetMigrationConfiguration {
  /** Source asset_type_name → tenant asset type slug. Every staged name must map. */
  assetTypeMapping: Record<string, string>;
}

export interface MigrationJobConfiguration {
  /** Client that receives orphaned contacts/assets (no resolvable organization). */
  defaultClientId?: string | null;
  tickets?: TicketMigrationConfiguration;
  assets?: AssetMigrationConfiguration;
}

export interface MigrationJobSummary {
  migrationJobId: string;
  state: MigrationJobState;
  sourceFileName: string;
  packageId: string | null;
  sourceSystem: string | null;
  producer: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  ownerUserId: string;
  entityCounts: Partial<Record<AmpEntityType, MigrationEntityProgress>>;
}

export interface MigrationEntityProgress {
  phase: number;
  state: string;
  plannedCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface MigrationJobDetails extends MigrationJobSummary {
  manifest: AmpManifest | null;
  configuration: MigrationJobConfiguration;
  error: string | null;
  preflightedAt: string | null;
  startedAt: string | null;
}

/** One blocking or advisory issue surfaced by preflight. */
export interface PreflightIssue {
  severity: 'blocking' | 'warning';
  code: string;
  message: string;
  entityType?: AmpEntityType;
  /** Number of staged records affected, when the issue is record-shaped. */
  recordCount?: number;
  /** Sample package_record_ids for drill-down (bounded). */
  sampleRecordIds?: string[];
}

export interface PreflightEntityPlan {
  entityType: AmpEntityType;
  stagedCount: number;
  toCreate: number;
  toSkipIdentityMapped: number;
  blocked: number;
}

export interface PreflightResult {
  state: Extract<MigrationJobState, 'ready' | 'blocked'>;
  issues: PreflightIssue[];
  plan: PreflightEntityPlan[];
  preflightedAt: string;
}

export interface MigrationOutcomeSummary {
  entityType: AmpEntityType;
  created: number;
  skipped: number;
  failed: number;
}

export interface MigrationOutcomeRecord {
  stagedRecordId: string;
  entityType: AmpEntityType;
  packageRecordId: string;
  sourceRecordId: string;
  attempt: number;
  action: 'created' | 'skipped' | 'failed';
  targetEntityType: string | null;
  targetEntityId: string | null;
  errors: string[];
  createdAt: string;
}

export interface MigrationUploadResult {
  migrationJobId: string;
  state: MigrationJobState;
  diagnostics: AmpDiagnostic[];
  rowCounts: Partial<Record<string, number>>;
}

/** Entity application order (dependency order). */
export const MIGRATION_PHASE_ORDER: readonly AmpEntityType[] = [
  'organizations',
  'locations',
  'contacts',
  'tickets',
  'ticket_comments',
  'assets',
];

export function migrationPhaseFor(entityType: AmpEntityType): number {
  return MIGRATION_PHASE_ORDER.indexOf(entityType) + 1;
}

/** AMP packages get their own cap — deliberately not the legacy asset-CSV cap. */
export const MAX_MIGRATION_PACKAGE_BYTES = 250 * 1024 * 1024;
