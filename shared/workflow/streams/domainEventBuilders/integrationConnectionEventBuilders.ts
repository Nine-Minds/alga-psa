import { builtWorkflowPayload } from '@alga-psa/event-schemas';

export function buildIntegrationConnectedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId: string;
  connectedAt?: string;
  connectedByUserId?: string;
}) {
  return builtWorkflowPayload('INTEGRATION_CONNECTED', {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    connectedAt: params.connectedAt,
    connectedByUserId: params.connectedByUserId,
  });
}

export function buildIntegrationDisconnectedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId: string;
  disconnectedAt?: string;
  disconnectedByUserId?: string;
  reason?: string;
}) {
  return builtWorkflowPayload('INTEGRATION_DISCONNECTED', {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    disconnectedAt: params.disconnectedAt,
    disconnectedByUserId: params.disconnectedByUserId,
    reason: params.reason,
  });
}

