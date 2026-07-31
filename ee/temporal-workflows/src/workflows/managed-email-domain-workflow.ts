import { proxyActivities, defineSignal, setHandler, Trigger, sleep, continueAsNew } from '@temporalio/workflow';

import type {
  ProvisionManagedEmailDomainInput,
  ProvisionManagedEmailDomainResult,
  CheckManagedEmailDomainStatusInput,
  CheckManagedEmailDomainStatusResult,
  ActivateManagedEmailDomainInput,
  DeleteManagedEmailDomainInput,
  MarkManagedEmailDomainFailedInput,
} from '../activities/email-domain-activities';

const {
  provisionManagedEmailDomain,
  checkManagedEmailDomainStatus,
  activateManagedEmailDomain,
  deleteManagedEmailDomain,
  markManagedEmailDomainFailed,
} = proxyActivities<{
  provisionManagedEmailDomain: typeof import('../activities/email-domain-activities').provisionManagedEmailDomain;
  checkManagedEmailDomainStatus: typeof import('../activities/email-domain-activities').checkManagedEmailDomainStatus;
  activateManagedEmailDomain: typeof import('../activities/email-domain-activities').activateManagedEmailDomain;
  deleteManagedEmailDomain: typeof import('../activities/email-domain-activities').deleteManagedEmailDomain;
  markManagedEmailDomainFailed: typeof import('../activities/email-domain-activities').markManagedEmailDomainFailed;
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
  verificationDeadlineMs?: number;
}

export interface ManagedEmailDomainWorkflowState {
  tenantId: string;
  domain: string;
  providerDomainId?: string;
  provision?: ProvisionManagedEmailDomainResult;
  verification?: CheckManagedEmailDomainStatusResult;
  activated?: boolean;
  timedOut?: boolean;
}

const VERIFICATION_TIMEOUT_MS = 72 * 60 * 60 * 1000;
const INITIAL_POLL_INTERVAL_MS = 5 * 60 * 1000;
const MAX_POLL_INTERVAL_MS = 60 * 60 * 1000;
const POLL_BACKOFF_FACTOR = 2;
const MAX_CYCLES_PER_RUN = 30;

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
  let pollIntervalMs = INITIAL_POLL_INTERVAL_MS;

  setHandler(refreshSignal, (payload?: ManagedEmailDomainWorkflowInput) => {
    pendingTrigger = payload?.trigger ?? 'refresh';
    pollIntervalMs = INITIAL_POLL_INTERVAL_MS;
    refreshTrigger.resolve();
  });

  function takePendingTrigger(): ManagedEmailDomainTrigger | undefined {
    const trigger = pendingTrigger;
    pendingTrigger = undefined;
    return trigger;
  }

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

  const verificationDeadlineMs = input.verificationDeadlineMs ?? Date.now() + VERIFICATION_TIMEOUT_MS;

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

  let cyclesThisRun = 0;
  let shouldContinue = await runVerificationCycle(takePendingTrigger());
  cyclesThisRun++;

  while (shouldContinue) {
    // Only pause/exit when no signal arrived while the last cycle was running
    if (pendingTrigger === undefined) {
      if (Date.now() >= verificationDeadlineMs) {
        await markManagedEmailDomainFailed({
          tenantId: input.tenantId,
          domain: input.domain,
          reason: 'DNS verification timed out after 72 hours',
        } as MarkManagedEmailDomainFailedInput);
        state.activated = false;
        state.timedOut = true;
        return state;
      }

      if (cyclesThisRun >= MAX_CYCLES_PER_RUN) {
        await continueAsNew<typeof managedEmailDomainWorkflow>({
          tenantId: input.tenantId,
          domain: input.domain,
          region: input.region,
          providerDomainId,
          verificationDeadlineMs,
        });
      }

      const waitMs = pollIntervalMs;
      pollIntervalMs = Math.min(pollIntervalMs * POLL_BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS);
      refreshTrigger = new Trigger<void>();
      await Promise.race([sleep(waitMs), refreshTrigger]);
    }

    shouldContinue = await runVerificationCycle(takePendingTrigger());
    cyclesThisRun++;
  }

  return state;
}
