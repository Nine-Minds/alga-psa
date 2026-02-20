export interface EntraWorkflowStartResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  error?: string;
}

export interface EntraWorkflowQueryResult {
  available: boolean;
  workflowId: string;
  status?: string;
  error?: string;
}

export async function startEntraDiscoveryWorkflow(_input: unknown): Promise<EntraWorkflowStartResult> {
  return { available: false, error: 'Temporal client not available' };
}

export async function startEntraInitialSyncWorkflow(_input: unknown): Promise<EntraWorkflowStartResult> {
  return { available: false, error: 'Temporal client not available' };
}

export async function startEntraAllTenantsSyncWorkflow(_input: unknown): Promise<EntraWorkflowStartResult> {
  return { available: false, error: 'Temporal client not available' };
}

export async function startEntraTenantSyncWorkflow(_input: unknown): Promise<EntraWorkflowStartResult> {
  return { available: false, error: 'Temporal client not available' };
}

export async function queryEntraWorkflowStatus(
  workflowId: string
): Promise<EntraWorkflowQueryResult> {
  return {
    available: false,
    workflowId,
    error: 'Temporal client not available',
  };
}
