// src/shared/utils/workflowVersionFetcher.ts
import { fetchWorkflowVersion as fetchWorkflowVersionAction } from '@product/actions/workflow'
import { WorkflowVersionResponse } from './types'

export async function fetchWorkflowVersion(
  workflowId: number,
  tenant: string,
  version?: number
): Promise<WorkflowVersionResponse> {
  return fetchWorkflowVersionAction(workflowId, tenant, version)
}
