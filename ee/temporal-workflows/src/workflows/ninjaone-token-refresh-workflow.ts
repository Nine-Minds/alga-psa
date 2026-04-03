import { proxyActivities, defineSignal, setHandler, Trigger, sleep, log } from '@temporalio/workflow';
import type {
  ExecuteNinjaOneProactiveRefreshResult,
  NinjaOneProactiveRefreshSignalInput,
  NinjaOneProactiveRefreshWorkflowInput,
} from '@ee/lib/integrations/ninjaone/proactiveRefresh';

const DEFAULT_REFRESH_BUFFER_MS = 15 * 60 * 1000;
const DEFAULT_MIN_REFRESH_DELAY_MS = 30 * 1000;

export const reconcileNinjaOneProactiveTokenRefreshSignal = defineSignal<
  [NinjaOneProactiveRefreshSignalInput]
>('reconcileNinjaOneProactiveTokenRefresh');

export const cancelNinjaOneProactiveTokenRefreshSignal = defineSignal<
  [{ reason?: string } | undefined]
>('cancelNinjaOneProactiveTokenRefresh');

type ProactiveRefreshActivities = {
  proactiveNinjaOneTokenRefreshActivity(input: {
    tenantId: string;
    integrationId: string;
    scheduledFor: string;
  }): Promise<ExecuteNinjaOneProactiveRefreshResult>;
};

const activities = proxyActivities<ProactiveRefreshActivities>({
  startToCloseTimeout: '5m',
  retry: {
    initialInterval: '10s',
    maximumInterval: '2m',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

function computeRefreshDelayMs(expiresAtMs: number): number {
  const now = Date.now();
  const target = expiresAtMs - DEFAULT_REFRESH_BUFFER_MS;
  const minAllowed = now + DEFAULT_MIN_REFRESH_DELAY_MS;
  return Math.max(Math.max(target, minAllowed) - now, 0);
}

export async function ninjaOneProactiveTokenRefreshWorkflow(
  input: NinjaOneProactiveRefreshWorkflowInput
): Promise<ExecuteNinjaOneProactiveRefreshResult> {
  log.info('Starting NinjaOne proactive token refresh workflow', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    expiresAtMs: input.expiresAtMs,
    scheduledBy: input.scheduledBy,
  });

  let expiresAtMs = input.expiresAtMs;
  let scheduledBy = input.scheduledBy;
  let active = true;
  let lifecycleVersion = 0;
  let wakeTrigger = new Trigger<void>();

  setHandler(
    reconcileNinjaOneProactiveTokenRefreshSignal,
    (payload: NinjaOneProactiveRefreshSignalInput) => {
      expiresAtMs = payload.expiresAtMs;
      scheduledBy = payload.scheduledBy;
      lifecycleVersion++;
      wakeTrigger.resolve();
      log.info('Reconciled NinjaOne proactive token refresh workflow', {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        expiresAtMs,
        scheduledBy,
      });
    }
  );

  setHandler(cancelNinjaOneProactiveTokenRefreshSignal, (payload: { reason?: string } | undefined) => {
    active = false;
    lifecycleVersion++;
    wakeTrigger.resolve();
    log.info('Cancelling NinjaOne proactive token refresh workflow', {
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      reason: payload?.reason,
    });
  });

  while (active) {
    const delayMs = computeRefreshDelayMs(expiresAtMs);
    const scheduledFor = new Date(Date.now() + delayMs).toISOString();
    const waitVersion = lifecycleVersion;

    wakeTrigger = new Trigger<void>();
    await Promise.race([sleep(delayMs), wakeTrigger]);

    if (!active) {
      return { outcome: 'inactive', details: 'cancelled' };
    }

    if (lifecycleVersion !== waitVersion) {
      continue;
    }

    const result = await activities.proactiveNinjaOneTokenRefreshActivity({
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      scheduledFor,
    });

    if (result.outcome === 'success' && result.nextExpiresAtMs) {
      expiresAtMs = result.nextExpiresAtMs;
      scheduledBy = 'proactive_refresh_success';
      lifecycleVersion++;
      continue;
    }

    log.info('Completed NinjaOne proactive token refresh workflow', {
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      outcome: result.outcome,
      scheduledBy,
    });

    return result;
  }

  return { outcome: 'inactive', details: 'cancelled' };
}
