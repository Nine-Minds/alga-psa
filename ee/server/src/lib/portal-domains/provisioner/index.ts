import { resolveDeploymentCapabilities } from '@/lib/deployment/deploymentProfile';

import { directProvisioner } from './directProvisioner';
import { temporalProvisioner } from './temporalProvisioner';
import type { PortalDomainProvisioner } from './types';

/**
 * Select the portal-domain provisioner driver from the resolved deployment
 * capabilities. `direct` on the appliance, `temporal` everywhere else.
 */
export function getPortalDomainProvisioner(
  env: Record<string, string | undefined> = process.env
): PortalDomainProvisioner {
  const caps = resolveDeploymentCapabilities(env);
  return caps.portalDomain.provisioner === 'direct' ? directProvisioner : temporalProvisioner;
}

export type {
  PortalDomainProvisioner,
  RegisterInput,
  ReconcileInput,
  RegisterResult,
} from './types';
export { temporalProvisioner } from './temporalProvisioner';
export { directProvisioner } from './directProvisioner';
