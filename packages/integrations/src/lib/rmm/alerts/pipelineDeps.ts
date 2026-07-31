import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import type { RmmAlertPipelineDeps } from '@alga-psa/shared/rmm/alerts';

/**
 * Canonical side-effect wiring for the shared RMM alert pipeline. Webhook
 * routes and the reconciliation poller pass this as deps so shared/ stays
 * free of event-bus dependencies.
 */
export function buildRmmAlertPipelineDeps(overrides?: Partial<RmmAlertPipelineDeps>): RmmAlertPipelineDeps {
  return {
    publishWorkflowEvent: async ({ eventType, tenantId, payload }) => {
      await publishWorkflowEvent({
        eventType,
        payload,
        ctx: { tenantId, actor: { actorType: 'SYSTEM' } },
        eventName: eventType === 'RMM_ALERT_TRIGGERED' ? 'RMM Alert Triggered' : 'RMM Alert Resolved',
      });
    },
    ...overrides,
  };
}
