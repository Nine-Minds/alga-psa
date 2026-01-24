export function buildIntegrationConnectedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId: string;
  connectedAt?: string;
  connectedByUserId?: string;
}) {
  return {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    connectedAt: params.connectedAt,
    connectedByUserId: params.connectedByUserId,
  };
}

export function buildIntegrationDisconnectedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId: string;
  disconnectedAt?: string;
  disconnectedByUserId?: string;
  reason?: string;
}) {
  return {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    disconnectedAt: params.disconnectedAt,
    disconnectedByUserId: params.disconnectedByUserId,
    reason: params.reason,
  };
}

