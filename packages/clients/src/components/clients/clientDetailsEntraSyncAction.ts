export const shouldShowEntraSyncAction = (
  edition: string | undefined,
  isClientSyncFlagEnabled: boolean,
  client?: { entra_tenant_id?: string | null } | null
): boolean => {
  const mappedTenantId = String(client?.entra_tenant_id || '').trim();
  return edition === 'enterprise' && isClientSyncFlagEnabled && mappedTenantId.length > 0;
};

const terminalEntraSyncStatuses = new Set(['completed', 'failed', 'partial']);

export const isTerminalEntraRunStatus = (status: string | null | undefined): boolean => {
  if (!status) {
    return false;
  }

  return terminalEntraSyncStatuses.has(status.trim().toLowerCase());
};

export const resolveEntraClientSyncStartState = (runId: string | null | undefined): {
  runId: string | null;
  statusMessage: string;
  shouldPoll: boolean;
} => {
  const normalizedRunId = String(runId || '').trim();
  if (!normalizedRunId) {
    return {
      runId: null,
      statusMessage: 'Entra sync started for this client.',
      shouldPoll: false,
    };
  }

  return {
    runId: normalizedRunId,
    statusMessage: `Run ${normalizedRunId}: queued`,
    shouldPoll: true,
  };
};
