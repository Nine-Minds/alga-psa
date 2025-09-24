export type PortalDomainWorkflowTrigger = 'register' | 'refresh' | 'disable';

export interface PortalDomainWorkflowInput {
  tenantId: string;
  portalDomainId: string;
  trigger?: PortalDomainWorkflowTrigger;
}

export interface PortalDomainActivityRecord {
  id: string;
  tenant: string;
  domain: string;
  canonical_host: string;
  status: string;
  status_message: string | null;
  verification_details: Record<string, unknown> | null;
  certificate_secret_name: string | null;
  last_synced_resource_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface VerifyCnameInput {
  domain: string;
  expectedCname: string;
  attempts?: number;
  intervalSeconds?: number;
}

export interface VerifyCnameResult {
  matched: boolean;
  observed: string[];
  message: string;
}

export interface MarkStatusInput {
  portalDomainId: string;
  status: string;
  statusMessage?: string | null;
  verificationDetails?: Record<string, unknown> | null;
}

export interface ApplyPortalDomainResourcesResult {
  success: boolean;
  appliedCount: number;
  errors?: string[];
}

export interface PortalDomainStatusSnapshot {
  status: string;
  statusMessage: string | null;
}
