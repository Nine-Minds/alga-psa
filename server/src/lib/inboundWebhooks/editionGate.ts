import { isEnterprise } from '@alga-psa/core/features';

export function canUseInboundWebhookWorkflowHandlers(): boolean {
  return isEnterprise;
}

export function assertInboundWebhookWorkflowHandlersAvailable(): void {
  if (!canUseInboundWebhookWorkflowHandlers()) {
    throw new Error('Inbound webhook workflow handlers require Enterprise edition');
  }
}
