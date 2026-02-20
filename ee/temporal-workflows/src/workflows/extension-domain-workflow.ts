import { proxyActivities } from '@temporalio/workflow';

const { computeDomain, ensureDomainMapping, updateInstallStatus } = proxyActivities<{
  computeDomain: typeof import('../activities/extension-domain-activities.js').computeDomain,
  ensureDomainMapping: typeof import('../activities/extension-domain-activities.js').ensureDomainMapping,
  updateInstallStatus: typeof import('../activities/extension-domain-activities.js').updateInstallStatus,
}>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 5,
  },
});

export interface ProvisionDomainInput {
  tenantId: string;
  extensionId: string; // registry_id
  installId?: string;
}

export async function provisionExtensionDomain(input: ProvisionDomainInput): Promise<{ domain: string }> {
  await updateInstallStatus({ installId: input.installId, state: 'provisioning', message: 'Computing domain' });
  const { domain } = await computeDomain({ tenantId: input.tenantId, extensionId: input.extensionId });
  await updateInstallStatus({ installId: input.installId, state: 'provisioning', message: `Ensuring mapping for ${domain}` });
  const { ref } = await ensureDomainMapping({ domain });
  await updateInstallStatus({ installId: input.installId, state: 'ready', message: 'Domain provisioned', runnerRef: ref });
  return { domain };
}

