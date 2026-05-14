import logger from '@alga-psa/core/logger';

export const SEARCH_RECONCILE_JOB_NAME = 'search:reconcile';

export interface SearchReconcileJobData extends Record<string, unknown> {
  tenantId?: string;
  type?: string;
}

export async function searchReconcileHandler(data: SearchReconcileJobData): Promise<void> {
  logger.info('[SearchReconcileJob] Reconciliation handler invoked', {
    tenantId: data.tenantId,
    type: data.type,
  });
}
