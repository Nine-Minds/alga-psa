import { proxyActivities } from '@temporalio/workflow';

import type {
  ProvisionManagedEmailDomainInput,
  ProvisionManagedEmailDomainResult,
  CheckManagedEmailDomainStatusInput,
  CheckManagedEmailDomainStatusResult,
  ActivateManagedEmailDomainInput,
  DeleteManagedEmailDomainInput,
} from '../activities/email-domain-activities';

const {
  provisionManagedEmailDomain,
  checkManagedEmailDomainStatus,
  activateManagedEmailDomain,
  deleteManagedEmailDomain,
} = proxyActivities<{ 
  provisionManagedEmailDomain: typeof import('../activities/email-domain-activities').provisionManagedEmailDomain;
  checkManagedEmailDomainStatus: typeof import('../activities/email-domain-activities').checkManagedEmailDomainStatus;
  activateManagedEmailDomain: typeof import('../activities/email-domain-activities').activateManagedEmailDomain;
  deleteManagedEmailDomain: typeof import('../activities/email-domain-activities').deleteManagedEmailDomain;
}>({
  startToCloseTimeout: '5 minutes',
  scheduleToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 5,
  },
});

export type ManagedEmailDomainTrigger = 'register' | 'refresh' | 'delete';

export interface ManagedEmailDomainWorkflowInput {
  tenantId: string;
  domain: string;
  region?: string;
  trigger?: ManagedEmailDomainTrigger;
  providerDomainId?: string;
}

export interface ManagedEmailDomainWorkflowState {
  tenantId: string;
  domain: string;
  providerDomainId?: string;
  provision?: ProvisionManagedEmailDomainResult;
  verification?: CheckManagedEmailDomainStatusResult;
  activated?: boolean;
}

export async function managedEmailDomainWorkflow(
  input: ManagedEmailDomainWorkflowInput
): Promise<ManagedEmailDomainWorkflowState> {
  const state: ManagedEmailDomainWorkflowState = {
    tenantId: input.tenantId,
    domain: input.domain,
  };

  if (input.trigger === 'delete') {
    await deleteManagedEmailDomain({ tenantId: input.tenantId, domain: input.domain } as DeleteManagedEmailDomainInput);
    state.activated = false;
    return state;
  }

  let providerDomainId = input.providerDomainId;

  if (!providerDomainId) {
    const provisionResult = await provisionManagedEmailDomain({
      tenantId: input.tenantId,
      domain: input.domain,
      region: input.region,
    } as ProvisionManagedEmailDomainInput);

    state.provision = provisionResult;
    providerDomainId = provisionResult.providerDomainId;
    state.providerDomainId = providerDomainId;
  } else {
    state.providerDomainId = providerDomainId;
  }

  const verificationResult = await checkManagedEmailDomainStatus({
    tenantId: input.tenantId,
    providerDomainId,
    domain: input.domain,
  } as CheckManagedEmailDomainStatusInput);

  state.verification = verificationResult;

  if (verificationResult.status === 'verified') {
    await activateManagedEmailDomain({ tenantId: input.tenantId, domain: input.domain } as ActivateManagedEmailDomainInput);
    state.activated = true;
  } else {
    state.activated = false;
  }

  return state;
}
