import type { EntraSyncRunProgressResult } from '../entraWorkflowClient';

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

export function serializeEntraSyncRunProgress(
  input: EntraSyncRunProgressResult
): EntraSyncRunProgressResult {
  if (!input.run) {
    return {
      run: null,
      tenantResults: [],
    };
  }

  return {
    run: {
      runId: String(input.run.runId),
      status: String(input.run.status),
      runType: String(input.run.runType),
      startedAt: String(input.run.startedAt),
      completedAt: toStringOrNull(input.run.completedAt),
      totalTenants: toNumber(input.run.totalTenants),
      processedTenants: toNumber(input.run.processedTenants),
      succeededTenants: toNumber(input.run.succeededTenants),
      failedTenants: toNumber(input.run.failedTenants),
      summary:
        input.run.summary && typeof input.run.summary === 'object'
          ? (input.run.summary as Record<string, unknown>)
          : {},
    },
    tenantResults: (input.tenantResults || []).map((item) => ({
      managedTenantId: toStringOrNull(item.managedTenantId),
      clientId: toStringOrNull(item.clientId),
      status: String(item.status),
      created: toNumber(item.created),
      linked: toNumber(item.linked),
      updated: toNumber(item.updated),
      ambiguous: toNumber(item.ambiguous),
      inactivated: toNumber(item.inactivated),
      errorMessage: toStringOrNull(item.errorMessage),
      startedAt: toStringOrNull(item.startedAt),
      completedAt: toStringOrNull(item.completedAt),
    })),
  };
}
