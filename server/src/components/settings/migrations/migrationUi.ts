import type { AmpEntityType } from '@alga-psa/migration-spec';
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

export function migrationEntityLabel(entityType: AmpEntityType | string): string {
  return MIGRATION_ENTITY_LABELS[entityType as AmpEntityType] ?? String(entityType);
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
