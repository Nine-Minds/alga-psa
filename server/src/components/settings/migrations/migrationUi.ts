import type { AmpEntityType } from '@alga-psa/migration-spec';
import {
  MIGRATION_UPLOAD_ERROR_CODES,
  type MigrationUploadErrorCode,
} from '@/lib/migrations/migrationUploadErrors';
import type { MigrationJobState } from '@/lib/migrations/types';

/** Visual tone + label for every migration job state. */
export interface MigrationStateBadge {
  label: string;
  variant: 'default' | 'default-muted' | 'success' | 'warning' | 'error' | 'info';
}

export const MIGRATION_STATE_BADGES: Record<MigrationJobState, MigrationStateBadge> = {
  uploaded: { label: 'Uploaded', variant: 'default-muted' },
  inspecting: { label: 'Inspecting', variant: 'info' },
  needs_configuration: { label: 'Needs configuration', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'error' },
  preflighting: { label: 'Preflight running', variant: 'info' },
  ready: { label: 'Ready to run', variant: 'success' },
  blocked: { label: 'Blocked', variant: 'error' },
  queued: { label: 'Queued', variant: 'info' },
  applying: { label: 'Applying', variant: 'info' },
  completed: { label: 'Completed', variant: 'success' },
  completed_with_errors: { label: 'Completed with errors', variant: 'warning' },
  failed: { label: 'Failed', variant: 'error' },
  cancelled: { label: 'Cancelled', variant: 'default-muted' },
};

export function migrationStateBadge(state: MigrationJobState): MigrationStateBadge {
  return MIGRATION_STATE_BADGES[state] ?? { label: state, variant: 'default' };
}

export const MIGRATION_ENTITY_LABELS: Record<AmpEntityType, string> = {
  organizations: 'Organizations',
  locations: 'Locations',
  contacts: 'Contacts',
  tickets: 'Tickets',
  ticket_comments: 'Ticket comments',
  assets: 'Assets',
};

export function migrationEntityLabel(entityType: string): string {
  return MIGRATION_ENTITY_LABELS[entityType as AmpEntityType] ?? entityType;
}

/** Job-lifecycle steps shown in the detail stepper. */
export const MIGRATION_STEPS = ['inspect', 'configure', 'preflight', 'run', 'results'] as const;
export type MigrationStep = (typeof MIGRATION_STEPS)[number];

export const MIGRATION_STEP_LABELS: Record<MigrationStep, string> = {
  inspect: 'Inspect',
  configure: 'Configure',
  preflight: 'Preflight',
  run: 'Run',
  results: 'Results',
};

/**
 * The step a job's state puts it on. `rejected` has no step — the detail view
 * renders a rejection panel instead of the stepper.
 */
export function migrationStepForState(state: MigrationJobState): MigrationStep | null {
  switch (state) {
    case 'uploaded':
    case 'inspecting':
      return 'inspect';
    case 'needs_configuration':
      return 'configure';
    case 'preflighting':
    case 'blocked':
    case 'ready':
      return 'preflight';
    case 'queued':
    case 'applying':
      return 'run';
    case 'completed':
    case 'completed_with_errors':
    case 'failed':
    case 'cancelled':
      return 'results';
    case 'rejected':
      return null;
  }
}

/** Steps the operator may open for a job in the given state. */
export function migrationStepsAvailable(state: MigrationJobState): MigrationStep[] {
  switch (state) {
    case 'uploaded':
    case 'inspecting':
      return ['inspect'];
    case 'needs_configuration':
    case 'preflighting':
    case 'blocked':
    case 'ready':
      return ['configure', 'preflight'];
    case 'queued':
    case 'applying':
      return ['run'];
    case 'completed':
    case 'completed_with_errors':
    case 'failed':
    case 'cancelled':
      return ['results'];
    case 'rejected':
      return [];
  }
}

/** States that change on their own and therefore warrant polling. */
export function isMigrationStateTransient(state: MigrationJobState): boolean {
  return ['uploaded', 'inspecting', 'preflighting', 'queued', 'applying'].includes(state);
}

/** Trigger a browser download of in-memory text (CSV/JSON report exports). */
export function downloadTextFile(fileName: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function formatMigrationTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

/** Human-readable message from a thrown server-action error. */
export function migrationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export interface MigrationUploadErrorCopy {
  /** i18n key in the `msp/settings` namespace. */
  key: string;
  /** English default, used when the key is missing. */
  defaultValue: string;
}

/**
 * i18n copy for every code the migration upload routes may return. Kept next to
 * the closed code set so a new code cannot be added without user-facing copy.
 */
const MIGRATION_UPLOAD_ERROR_COPY: Record<MigrationUploadErrorCode, MigrationUploadErrorCopy> = {
  IMPORT_EXPORT_PERMISSION_DENIED: {
    key: 'importExport.migration.errors.permissionDenied',
    defaultValue: 'You do not have permission to import or export data.',
  },
  AMP_SPREADSHEET_INVALID: {
    key: 'importExport.migration.errors.invalidSpreadsheet',
    defaultValue: 'That spreadsheet could not be read. Check that it is a valid CSV or XLSX file and try again.',
  },
  AMP_NOT_SQLITE: {
    key: 'importExport.migration.errors.notAmpPackage',
    defaultValue: 'That file is not an AMP package. Upload a .amp or .sqlite file.',
  },
  AMP_LIMIT_EXCEEDED: {
    key: 'importExport.migration.errors.tooLarge',
    defaultValue: 'This upload is larger than the maximum allowed size.',
  },
  AMP_UPLOAD_SIZE_MISMATCH: {
    key: 'importExport.migration.errors.sizeMismatch',
    defaultValue: 'The upload did not complete. Please try again.',
  },
  AMP_SPREADSHEET_NO_RECOGNIZED_HEADERS: {
    key: 'importExport.migration.errors.noRecognizedHeaders',
    defaultValue: 'None of the columns in that spreadsheet were recognized. Check the header row and try again.',
  },
  AMP_PACKAGE_NO_IMPORTABLE_RECORDS: {
    key: 'importExport.migration.errors.noImportableRecords',
    defaultValue: 'This package contained no importable records.',
  },
  AMP_STORAGE_REJECTED: {
    key: 'importExport.migration.errors.storageRejected',
    defaultValue: 'The server rejected this upload. Ask your administrator to check the storage file-type configuration.',
  },
  AMP_SPREADSHEET_FAILED: {
    key: 'importExport.migration.errors.spreadsheetFailed',
    defaultValue: 'The spreadsheet could not be imported. Please try again.',
  },
  AMP_UPLOAD_FAILED: {
    key: 'importExport.migration.errors.uploadFailed',
    defaultValue: 'The package could not be uploaded. Please try again.',
  },
};

const MIGRATION_UPLOAD_ERROR_FALLBACK: MigrationUploadErrorCopy = {
  key: 'importExport.migration.errors.unknown',
  defaultValue: 'The upload failed. Please try again.',
};

/**
 * Resolve a raw route error payload to i18n copy. An unknown code (or the
 * storage layer's message) falls back to generic upload copy, so no internal
 * string is ever rendered verbatim.
 */
export function migrationUploadErrorCopy(code: string): MigrationUploadErrorCopy {
  return MIGRATION_UPLOAD_ERROR_COPY[code as MigrationUploadErrorCode] ?? MIGRATION_UPLOAD_ERROR_FALLBACK;
}

/** Every code the routes emit, exposed so a test can assert copy coverage. */
export const MIGRATION_UPLOAD_CODES: readonly MigrationUploadErrorCode[] = MIGRATION_UPLOAD_ERROR_CODES;
