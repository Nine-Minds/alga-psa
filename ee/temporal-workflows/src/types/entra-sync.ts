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
  mappingState?: 'mapped' | 'create_new';
  displayName?: string | null;
  primaryDomain?: string | null;
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
  /**
   * Eligible Entra users observed by this tenant sync. Present even when zero;
   * absent when the directory read or reconciliation did not complete.
   */
  eligibleUserCount?: number;
  /** Dry runs are audit evidence and must not replace the last real count. */
  isDryRun?: boolean;
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
  /**
   * What the run covered. Without it a single-client sync is indistinguishable
   * from an all-tenants one in history, which is the tenant-GUID problem F12
   * set out to remove wearing different clothes.
   */
  scopeManagedTenantId?: string | null;
  scopeClientId?: string | null;
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
  /** Explicit initial/manual runs may resolve operator-approved create-new decisions. */
  includeCreateNew?: boolean;
}

export interface LoadMappedTenantsActivityOutput {
  mappings: EntraManagedTenantRef[];
}

export interface ProvisionEntraClientActivityInput {
  tenantId: string;
  mapping: EntraManagedTenantRef;
  actorUserId?: string;
}

export interface SyncTenantUsersActivityInput {
  tenantId: string;
  runId: string;
  mapping: EntraManagedTenantRef;
  /** A preflight: classify every identity, write nothing. Defaults to false. */
  dryRun?: boolean;
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
