import type { PortalDomainProvisioner } from '@/lib/portal-domains/provisioner/types';

/**
 * Community Edition seam for the hosted/cloud portal-domain driver.
 *
 * CE ships no Temporal, cert-manager, or Istio automation, so there is no
 * hosted driver. The factory falls back to the direct (trust-on-submit)
 * provisioner under every deployment profile.
 */
export const hostedProvisioner: PortalDomainProvisioner | null = null;
