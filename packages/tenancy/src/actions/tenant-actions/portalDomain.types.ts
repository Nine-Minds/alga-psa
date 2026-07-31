import type {
  PortalDomainStatus,
  PortalDomainVerificationMethod,
} from '../../lib/PortalDomainModel';

export type PortalDomainEdition = 'ce' | 'ee';

/**
 * How custom portal domains are provisioned in this deployment.
 * - `temporal`: hosted/cloud — DNS verification + cert issuance + Istio routing.
 * - `direct`: appliance — trust-on-submit; the operator owns DNS/TLS/routing.
 * Optional so the CE stub (which never sets it) remains type-compatible.
 */
export type PortalDomainMode = 'temporal' | 'direct';

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
  mode?: PortalDomainMode;
  /**
   * Set when the domain is active but no inbound request has ever been observed
   * arriving on its Host — a best-effort signal that the operator's reverse proxy
   * is not forwarding the Host header. (Appliance / `direct` mode only.)
   */
  neverSeenOnHost?: boolean;
}

export interface PortalDomainRegistrationRequest {
  domain: string;
}

export interface PortalDomainRegistrationResult {
  status: PortalDomainStatusResponse;
}
