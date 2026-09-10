import type { PortalDomainProvisioner } from '@/lib/portal-domains/provisioner/types';

import { temporalProvisioner } from './temporalProvisioner';

/**
 * Edition seam for the hosted/cloud driver. EE drives DNS verification,
 * certificate issuance, and Istio routing through Temporal; the CE stub in
 * packages/ee/src exports null because none of that automation ships there.
 */
export const hostedProvisioner: PortalDomainProvisioner | null = temporalProvisioner;
