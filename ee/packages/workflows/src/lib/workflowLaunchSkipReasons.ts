/**
 * Single source of truth for why a published event-triggered workflow was NOT
 * launched for an event. Shared by the worker, server actions and UI.
 *
 * The DB CHECK constraint on workflow_event_launch_skips.reason must list the
 * same codes (enforced by workflowLaunchSkipReasons.test.ts).
 */
export const WORKFLOW_LAUNCH_SKIP_REASONS = [
  'missing_schema_ref',
  'unknown_schema_ref',
  'missing_source_schema',
  'schema_mismatch',
  'payload_mapping_failed',
  'payload_validation_failed',
  'launch_failed',
  'paused',
  'lineage_loop_guard',
  'self_trigger_guard',
  'causation_depth_exceeded',
] as const;

export type WorkflowLaunchSkipReason = (typeof WORKFLOW_LAUNCH_SKIP_REASONS)[number];

/** Intentional skips are deliberate states (guards / paused), never alarming. */
export const WORKFLOW_LAUNCH_SKIP_INTENTIONAL: Record<WorkflowLaunchSkipReason, boolean> = {
  missing_schema_ref: false,
  unknown_schema_ref: false,
  missing_source_schema: false,
  schema_mismatch: false,
  payload_mapping_failed: false,
  payload_validation_failed: false,
  launch_failed: false,
  paused: true,
  lineage_loop_guard: true,
  self_trigger_guard: true,
  causation_depth_exceeded: true,
};

/** i18n keys (msp/workflows namespace) for the reason label and the "what to fix" hint. */
export const WORKFLOW_LAUNCH_SKIP_REASON_LABEL_KEYS: Record<WorkflowLaunchSkipReason, string> =
  Object.fromEntries(
    WORKFLOW_LAUNCH_SKIP_REASONS.map((r) => [r, `launchSkipReasons.${r}.label`])
  ) as Record<WorkflowLaunchSkipReason, string>;

export const WORKFLOW_LAUNCH_SKIP_REASON_HINT_KEYS: Record<WorkflowLaunchSkipReason, string> =
  Object.fromEntries(
    WORKFLOW_LAUNCH_SKIP_REASONS.map((r) => [r, `launchSkipReasons.${r}.hint`])
  ) as Record<WorkflowLaunchSkipReason, string>;

export function isWorkflowLaunchSkipReason(value: unknown): value is WorkflowLaunchSkipReason {
  return typeof value === 'string' && (WORKFLOW_LAUNCH_SKIP_REASONS as readonly string[]).includes(value);
}

export function isIntentionalLaunchSkipReason(reason: WorkflowLaunchSkipReason): boolean {
  return WORKFLOW_LAUNCH_SKIP_INTENTIONAL[reason];
}
