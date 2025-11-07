import { proxyActivities, defineSignal, setHandler, Trigger, sleep } from '@temporalio/workflow';

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

const refreshSignal = defineSignal<[ManagedEmailDomainWorkflowInput | undefined]>('refreshManagedEmailDomain');

export async function managedEmailDomainWorkflow(
  input: ManagedEmailDomainWorkflowInput
): Promise<ManagedEmailDomainWorkflowState> {
  const state: ManagedEmailDomainWorkflowState = {
    tenantId: input.tenantId,
    domain: input.domain,
  };

  let pendingTrigger: ManagedEmailDomainTrigger | undefined = input.trigger;
  let refreshTrigger = new Trigger<void>();

  setHandler(refreshSignal, (payload?: ManagedEmailDomainWorkflowInput) => {
    pendingTrigger = payload?.trigger ?? 'refresh';
    refreshTrigger.resolve();
  });

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

  async function runVerificationCycle(trigger: ManagedEmailDomainTrigger | undefined): Promise<boolean> {
    if (trigger === 'delete') {
      await deleteManagedEmailDomain({ tenantId: input.tenantId, domain: input.domain } as DeleteManagedEmailDomainInput);
      state.activated = false;
      return false;
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
      return false;
    }

    if (verificationResult.status === 'failed') {
      state.activated = false;
      return false;
    }

    state.activated = false;
    return true;
  }

  let shouldContinue = await runVerificationCycle(pendingTrigger);
  pendingTrigger = undefined;

  while (shouldContinue) {
    refreshTrigger = new Trigger<void>();
    await Promise.race([sleep('5 minutes'), refreshTrigger]);
    shouldContinue = await runVerificationCycle(pendingTrigger);
    pendingTrigger = undefined;
  }

  return state;
}
