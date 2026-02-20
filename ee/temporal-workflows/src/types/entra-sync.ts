export type EntraSyncScope = 'discovery' | 'initial' | 'all-tenants' | 'single-tenant';

export type EntraSyncRunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface EntraWorkflowActor {
  userId?: string;
}

export interface EntraDiscoveryWorkflowInput {
  tenantId: string;
  actor?: EntraWorkflowActor;
  requestedAt?: string;
}

export interface EntraDiscoveryWorkflowResult {
  discoveredTenantCount: number;
}

export interface EntraManagedTenantRef {
  managedTenantId: string;
  entraTenantId: string;
  clientId?: string | null;
}

export interface EntraSyncWorkflowInput {
  tenantId: string;
  actor?: EntraWorkflowActor;
  requestedAt?: string;
}

export interface EntraInitialSyncWorkflowInput extends EntraSyncWorkflowInput {
  startImmediately?: boolean;
}

export interface EntraAllTenantsSyncWorkflowInput extends EntraSyncWorkflowInput {
  trigger: 'manual' | 'scheduled';
}

export interface EntraTenantSyncWorkflowInput extends EntraSyncWorkflowInput {
  managedTenantId: string;
  clientId?: string;
}

export interface EntraSyncRunSummary {
  totalTenants: number;
  processedTenants: number;
  succeededTenants: number;
  failedTenants: number;
  created: number;
  linked: number;
  updated: number;
  ambiguous: number;
  inactivated: number;
}

export interface EntraTenantSyncResult {
  managedTenantId: string;
  clientId: string | null;
  status: EntraSyncRunStatus;
  created: number;
  linked: number;
  updated: number;
  ambiguous: number;
  inactivated: number;
  errorMessage?: string | null;
}

export interface EntraSyncWorkflowResult {
  runId: string;
  status: EntraSyncRunStatus;
  summary: EntraSyncRunSummary;
  tenantResults: EntraTenantSyncResult[];
}

export interface UpsertEntraSyncRunActivityInput {
  tenantId: string;
  workflowId: string;
  runType: EntraSyncScope;
  initiatedBy?: string;
}

export interface DiscoverManagedTenantsActivityInput {
  tenantId: string;
}

export interface DiscoverManagedTenantsActivityOutput {
  discoveredTenantCount: number;
}

export interface UpsertEntraSyncRunActivityOutput {
  runId: string;
}

export interface LoadMappedTenantsActivityInput {
  tenantId: string;
  managedTenantId?: string;
}

export interface LoadMappedTenantsActivityOutput {
  mappings: EntraManagedTenantRef[];
}

export interface SyncTenantUsersActivityInput {
  tenantId: string;
  runId: string;
  mapping: EntraManagedTenantRef;
}

export interface RecordSyncTenantResultActivityInput {
  tenantId: string;
  runId: string;
  result: EntraTenantSyncResult;
}

export interface FinalizeSyncRunActivityInput {
  tenantId: string;
  runId: string;
  status: EntraSyncRunStatus;
  summary: EntraSyncRunSummary;
}
