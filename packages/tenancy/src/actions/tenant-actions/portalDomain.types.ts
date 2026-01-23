import type {
  PortalDomainStatus,
  PortalDomainVerificationMethod,
} from '../../lib/PortalDomainModel';

export type PortalDomainEdition = 'ce' | 'ee';

export interface PortalDomainStatusResponse {
  domain: string | null;
  canonicalHost: string;
  status: PortalDomainStatus;
  statusMessage: string | null;
  lastCheckedAt: string | null;
  verificationMethod: PortalDomainVerificationMethod;
  verificationDetails: Record<string, unknown>;
  certificateSecretName: string | null;
  lastSyncedResourceVersion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isEditable: boolean;
  edition: PortalDomainEdition;
}

export interface PortalDomainRegistrationRequest {
  domain: string;
}

export interface PortalDomainRegistrationResult {
  status: PortalDomainStatusResponse;
}
