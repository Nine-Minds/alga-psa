import type { Knex } from 'knex';

import { WorkflowDefinitionModelV2, WorkflowDefinitionVersionModelV2 } from '@alga-psa/workflows/persistence';
import {
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF,
  type WorkflowClockTriggerPayload
} from '@alga-psa/workflows/runtime/core';

export { WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF };

export const toIsoDateTime = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

/**
 * Synthesize the exact `WorkflowClockTriggerPayload` a clock-pinned schedule is
 * expected to launch with. Deliberately omits display-only fields (e.g.
 * `scheduleName`, which lives in trigger metadata) so it passes the strict
 * schema unmodified. Timestamps are the schedule's occurrence / fire time and
 * are always re-derived at each fire; the stored `payload_json` is a placeholder.
 */
export const buildWorkflowClockPayload = (params: {
  scheduleId: string;
  workflowId: string;
  workflowVersion: number;
  triggerType: 'schedule' | 'recurring';
  scheduledFor?: string | null;
  cron?: string | null;
  timezone?: string | null;
}): WorkflowClockTriggerPayload => {
  const firedAt = new Date().toISOString();
  const scheduledFor = toIsoDateTime(params.scheduledFor) ?? firedAt;
  return {
    triggerType: params.triggerType,
    scheduleId: params.scheduleId,
    scheduledFor,
    firedAt,
    timezone: params.timezone ?? 'UTC',
    workflowId: params.workflowId,
    workflowVersion: params.workflowVersion,
    ...(params.triggerType === 'recurring' && params.cron ? { cron: params.cron } : {})
  };
};

/**
 * Resolve the effective payload schema ref for the exact workflow version being
 * launched. Mirrors workflowRunLauncher's resolution: the version's own
 * `definition_json.payloadSchemaRef` wins; when the version does not carry one,
 * fall back to the workflow definition's `payload_schema_ref` column. The
 * handler and the schedule lifecycle both use this to decide whether a schedule
 * is clock-pinned (and must launch with the synthetic clock payload) versus a
 * normal schedule that keeps its stored `payload_json`.
 */
export const resolveWorkflowVersionPayloadSchemaRef = async (
  knex: Knex,
  tenantId: string,
  workflowId: string,
  workflowVersion: number
): Promise<string | null> => {
  const version = await WorkflowDefinitionVersionModelV2.getByWorkflowAndVersion(knex, workflowId, workflowVersion);
  const definition = version?.definition_json as Record<string, unknown> | null;
  if (definition && typeof definition.payloadSchemaRef === 'string') {
    return definition.payloadSchemaRef;
  }
  const workflow = await WorkflowDefinitionModelV2.getById(knex, tenantId, workflowId);
  return typeof workflow?.payload_schema_ref === 'string' ? workflow.payload_schema_ref : null;
};

export const isClockPinnedSchemaRef = (schemaRef: string | null | undefined): boolean =>
  schemaRef === WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF;