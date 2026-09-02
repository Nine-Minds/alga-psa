import {
  resolveDeploymentCapabilities,
  type PortalDomainProvisionerKind,
} from '@/lib/deployment/deploymentProfile';
import { hostedProvisioner } from '@ee/lib/portal-domains/provisioner/hosted';

import { directProvisioner } from './directProvisioner';
import type { PortalDomainProvisioner } from './types';

export interface PortalDomainProvisioning {
  /** The mode actually in effect, which the UI and validation branch on. */
  mode: PortalDomainProvisionerKind;
  provisioner: PortalDomainProvisioner;
}

/**
 * Select the portal-domain driver from the deployment capabilities and the
 * edition seam. `direct` (trust-on-submit; the operator's reverse proxy owns
 * DNS, TLS, and routing) ships in every edition and is the fallback whenever no
 * hosted driver exists, so CE always provisions directly regardless of profile.
 * The hosted driver is Temporal-backed in EE and null in CE; the appliance
 * profile forces `direct` even when a hosted driver is available.
 */
export function resolvePortalDomainProvisioning(
  env: Record<string, string | undefined> = process.env
): PortalDomainProvisioning {
  const caps = resolveDeploymentCapabilities(env);
  if (caps.portalDomain.provisioner === 'direct' || !hostedProvisioner) {
    return { mode: 'direct', provisioner: directProvisioner };
  }
  return { mode: 'temporal', provisioner: hostedProvisioner };
}

export function getPortalDomainProvisioner(
  env: Record<string, string | undefined> = process.env
): PortalDomainProvisioner {
  return resolvePortalDomainProvisioning(env).provisioner;
}

export type {
  PortalDomainProvisioner,
  RegisterInput,
  ReconcileInput,
  RegisterResult,
} from './types';
export { directProvisioner } from './directProvisioner';
