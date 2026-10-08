import type { Knex } from 'knex';
import { WorkflowRunModelV2 } from '@alga-psa/workflows/persistence';

/** A causation chain (run -> event -> run -> ...) deeper than this is refused. */
export const MAX_WORKFLOW_CAUSATION_DEPTH = 5;

export type WorkflowSelfTriggerDecision =
  | { allow: true; causationDepth: number }
  | { allow: false; reason: 'self_trigger' | 'causation_depth_exceeded'; causationDepth: number };

/**
 * Decide whether an event may start `candidateWorkflowId`.
 *
 * Events published from inside a workflow run carry that run's id as the
 * stream `execution_id`. Starting the same definition from its own event
 * would loop forever (e.g. a TICKET_CREATED-triggered workflow whose
 * tickets.create action creates tickets), so a run's own definition is
 * skipped. Cross-definition cycles are bounded by a causation depth stored in
 * each run's trigger metadata and capped at MAX_WORKFLOW_CAUSATION_DEPTH.
 *
 * Events without an originating run (the normal case) are always allowed at
 * depth 0.
 */
export async function evaluateWorkflowSelfTrigger(
  knex: Knex,
  params: { tenant: string; originExecutionId?: string | null; candidateWorkflowId: string }
): Promise<WorkflowSelfTriggerDecision> {
  const origin = params.originExecutionId?.trim();
  if (!origin) {
    return { allow: true, causationDepth: 0 };
  }

  const run = await WorkflowRunModelV2.getById(knex, origin, params.tenant).catch(() => null);
  if (!run) {
    return { allow: true, causationDepth: 0 };
  }

  const originDepthRaw = (run.trigger_metadata_json as Record<string, unknown> | null | undefined)?.causationDepth;
  const originDepth = typeof originDepthRaw === 'number' && Number.isFinite(originDepthRaw) ? originDepthRaw : 0;
  const causationDepth = originDepth + 1;

  if (run.workflow_id === params.candidateWorkflowId) {
    return { allow: false, reason: 'self_trigger', causationDepth };
  }
  if (causationDepth > MAX_WORKFLOW_CAUSATION_DEPTH) {
    return { allow: false, reason: 'causation_depth_exceeded', causationDepth };
  }
  return { allow: true, causationDepth };
}
