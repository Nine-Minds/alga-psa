import type {
  PortalDomainStatus,
  PortalDomainSurface,
  PortalDomainVerificationMethod,
} from '../../lib/PortalDomainStore';

export type PortalDomainEdition = 'ce' | 'ee';

/**
 * How custom portal domains are provisioned in this deployment.
 * - `temporal`: hosted/cloud — DNS verification + cert issuance + Istio routing.
 * - `direct`: appliance — trust-on-submit; the operator owns DNS/TLS/routing.
 * Optional for older or unrecognized status implementations; known deployment
 * status formatters should always provide it.
 */
export type PortalDomainMode = 'temporal' | 'direct';

export interface PortalDomainStatusResponse {
  domain: string | null;
  canonicalHost: string;
  /** Which app(s) the domain serves. `client_portal` when no domain is registered. */
  surface: PortalDomainSurface;
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
  /**
   * SSO redirect-URI confirmation state for MSP-serving surfaces. While `required`
   * has entries missing from `confirmed` the status is `pending_redirect_uri`.
   * Absent for client-portal-only domains.
   */
  ssoRedirectUris?: {
    required: string[];
    confirmed: string[];
    missing: string[];
    source: 'not_required' | 'operator' | 'automation' | null;
    /** Whether the signed-in admin may confirm the URIs themselves (appliance / direct mode). */
    canSelfConfirm: boolean;
  };
}

export interface PortalDomainRegistrationRequest {
  domain: string;
  /** Defaults to `client_portal` (the pre-existing behaviour) when omitted. */
  surface?: PortalDomainSurface;
}

export interface PortalDomainRegistrationResult {
  status: PortalDomainStatusResponse;
}
