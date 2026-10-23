import { Counter, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Sink the event stream worker reports to. Injected through the worker's
 * constructor so tests can assert on increments without a global registry.
 */
export interface WorkflowEventMetrics {
  recordLaunchSkip(labels: {
    tenant: string;
    workflowId: string;
    eventName: string;
    reason: string;
    intentional: boolean;
  }): void;
  recordLaunch(labels: { tenant: string; workflowId: string; eventName: string }): void;
}

export interface WorkflowWorkerMetrics extends WorkflowEventMetrics {
  readonly registry: Registry;
}

/**
 * Cardinality: series exist only for (tenant x workflow x event x reason)
 * combinations that actually occur. workflow_key is deliberately not a label
 * (renames would churn series).
 */
export function createWorkflowWorkerMetrics(options: { collectDefaults?: boolean } = {}): WorkflowWorkerMetrics {
  const registry = new Registry();
  if (options.collectDefaults ?? true) {
    collectDefaultMetrics({ register: registry });
  }

  const skips = new Counter({
    name: 'alga_workflow_event_launch_skips_total',
    help: 'Published event-triggered workflows that were not launched for an event, by reason',
    labelNames: ['tenant', 'workflow_id', 'event_name', 'reason', 'intentional'] as const,
    registers: [registry],
  });
  const launches = new Counter({
    name: 'alga_workflow_event_launches_total',
    help: 'Published event-triggered workflow runs launched for an event',
    labelNames: ['tenant', 'workflow_id', 'event_name'] as const,
    registers: [registry],
  });

  return {
    registry,
    recordLaunchSkip: ({ tenant, workflowId, eventName, reason, intentional }) => {
      skips.inc({
        tenant,
        workflow_id: workflowId,
        event_name: eventName,
        reason,
        intentional: String(intentional),
      });
    },
    recordLaunch: ({ tenant, workflowId, eventName }) => {
      launches.inc({ tenant, workflow_id: workflowId, event_name: eventName });
    },
  };
}

let singleton: WorkflowWorkerMetrics | null = null;

/** Process-wide metrics used by the running service. */
export function getWorkflowWorkerMetrics(): WorkflowWorkerMetrics {
  singleton ??= createWorkflowWorkerMetrics();
  return singleton;
}
