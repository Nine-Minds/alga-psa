export interface EntraWorkflowStartResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  error?: string;
}

function unavailableResult(): EntraWorkflowStartResult {
  return {
    available: false,
    error: 'Microsoft Entra workflows are only available in Enterprise Edition.',
  };
}

export async function startEntraInitialSyncWorkflow(_input: unknown): Promise<EntraWorkflowStartResult> {
  return unavailableResult();
}

export async function startEntraAllTenantsSyncWorkflow(_input: unknown): Promise<EntraWorkflowStartResult> {
  return unavailableResult();
}

export async function startEntraTenantSyncWorkflow(_input: unknown): Promise<EntraWorkflowStartResult> {
  return unavailableResult();
}
