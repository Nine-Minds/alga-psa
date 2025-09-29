import {
  condition,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  getExternalWorkflowHandle,
} from '@temporalio/workflow';

import type { ApplyPortalDomainResourcesResult } from './types.js';

const { applyPortalDomainResources } = proxyActivities<{
  applyPortalDomainResources: (args: {
    tenantId: string;
    portalDomainId: string;
  }) => Promise<ApplyPortalDomainResourcesResult>;
}>({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export const PORTAL_DOMAIN_APPLY_COORDINATOR_WORKFLOW_ID =
  'portal-domain-apply-coordinator';

export interface PortalDomainApplyRequest {
  requestId: string;
  tenantId: string;
  portalDomainId: string;
  targetWorkflowId: string;
  targetRunId?: string | null;
}

export interface PortalDomainApplyCompletion {
  requestId: string;
  result: ApplyPortalDomainResourcesResult;
}

export const enqueuePortalDomainApplySignal = defineSignal<[
  PortalDomainApplyRequest,
]>('enqueuePortalDomainApply');

export const portalDomainApplyCompletedSignal = defineSignal<[
  PortalDomainApplyCompletion,
]>('portalDomainApplyCompleted');

export async function portalDomainApplyCoordinatorWorkflow(): Promise<void> {
  const queue: PortalDomainApplyRequest[] = [];

  setHandler(enqueuePortalDomainApplySignal, (request) => {
    queue.push(request);
  });

  while (true) {
    await condition(() => queue.length > 0);
    const next = queue.shift();
    if (!next) {
      continue;
    }

    let result: ApplyPortalDomainResourcesResult;
    try {
      result = await applyPortalDomainResources({
        tenantId: next.tenantId,
        portalDomainId: next.portalDomainId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'Unknown error');
      result = {
        success: false,
        appliedCount: 0,
        errors: [message],
      };
    }

    try {
      const targetHandle = getExternalWorkflowHandle(
        next.targetWorkflowId,
        next.targetRunId ?? undefined,
      );
      await targetHandle.signal(portalDomainApplyCompletedSignal, {
        requestId: next.requestId,
        result,
      });
    } catch (error) {
      log.warn('Failed to signal portal domain apply completion', {
        targetWorkflowId: next.targetWorkflowId,
        targetRunId: next.targetRunId,
        error: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
      });
    }
  }
}
