export function buildIntegrationSyncStartedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId?: string;
  syncId: string;
  scope?: string;
  initiatedByUserId?: string;
  startedAt?: string;
}) {
  return {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    syncId: params.syncId,
    scope: params.scope,
    initiatedByUserId: params.initiatedByUserId,
    startedAt: params.startedAt,
  };
}

export function buildIntegrationSyncCompletedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId?: string;
  syncId: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: { created?: number; updated?: number; deleted?: number; skipped?: number };
  warnings?: string[];
}) {
  return {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    syncId: params.syncId,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    durationMs: params.durationMs,
    summary: params.summary,
    warnings: params.warnings,
  };
}

export function buildIntegrationSyncFailedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId?: string;
  syncId: string;
  startedAt?: string;
  failedAt?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
}) {
  return {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    syncId: params.syncId,
    startedAt: params.startedAt,
    failedAt: params.failedAt,
    durationMs: params.durationMs,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    retryable: params.retryable,
  };
}

