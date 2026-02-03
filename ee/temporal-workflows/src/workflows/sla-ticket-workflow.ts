import {
  condition,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import type {
  IBusinessHoursScheduleWithEntries,
  ISlaPolicyTarget,
  SlaPauseReason,
} from '@alga-psa/sla/types';

export interface SlaTicketWorkflowInput {
  ticketId: string;
  tenantId: string;
  policyTargets: ISlaPolicyTarget[];
  businessHoursSchedule: IBusinessHoursScheduleWithEntries;
}

export interface SlaTicketWorkflowState {
  currentPhase: 'response' | 'resolution';
  currentStatus: 'active' | 'paused' | 'completed' | 'cancelled';
  pauseState: {
    isPaused: boolean;
    pauseStartedAt?: string | null;
    totalPauseMinutes: number;
    reason?: SlaPauseReason | null;
  };
  notifiedThresholds: {
    response: number[];
    resolution: number[];
  };
  responseDeadline?: string | null;
  resolutionDeadline?: string | null;
  nextWakeTime?: string | null;
}

export interface SlaTicketWorkflowQueryResult extends SlaTicketWorkflowState {
  remainingTimeMinutes?: number | null;
}

export interface PauseSignal {
  reason: SlaPauseReason;
}

export interface CompleteSignal {
  met: boolean;
}

const activities = proxyActivities<{
  calculateNextWakeTime(input: {
    currentTime: string;
    targetMinutes: number;
    schedule: IBusinessHoursScheduleWithEntries;
    pauseMinutes: number;
  }): Promise<string>;
  sendSlaNotification(input: {
    tenantId: string;
    ticketId: string;
    phase: 'response' | 'resolution';
    thresholdPercent: number;
  }): Promise<void>;
  checkAndEscalate(input: {
    tenantId: string;
    ticketId: string;
    phase: 'response' | 'resolution';
    thresholdPercent: number;
  }): Promise<void>;
  updateSlaStatus(input: {
    tenantId: string;
    ticketId: string;
    phase: 'response' | 'resolution';
    breached: boolean;
  }): Promise<void>;
  recordSlaAuditLog(input: {
    tenantId: string;
    ticketId: string;
    eventType: string;
    eventData: Record<string, unknown>;
  }): Promise<void>;
}>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: '1s',
    maximumInterval: '30s',
  },
});

export const pauseSignal = defineSignal<[PauseSignal]>('pause');
export const resumeSignal = defineSignal('resume');
export const completeResponseSignal = defineSignal<[CompleteSignal]>(
  'completeResponse'
);
export const completeResolutionSignal = defineSignal<[CompleteSignal]>(
  'completeResolution'
);
export const cancelSignal = defineSignal('cancel');

export const getStateQuery = defineQuery<SlaTicketWorkflowQueryResult>('getState');

export async function slaTicketWorkflow(
  input: SlaTicketWorkflowInput
): Promise<void> {
  const { ticketId, tenantId, policyTargets, businessHoursSchedule } = input;
  const startedAt = new Date();

  const target = policyTargets[0];
  if (!target) {
    log.warn('SLA workflow started without policy targets; exiting', {
      ticketId,
      tenantId,
      workflowId: workflowInfo().workflowId,
    });
    return;
  }

  let responseCompleted = false;
  let resolutionCompleted = false;
  let cancelled = false;

  const state: SlaTicketWorkflowState = {
    currentPhase: 'response',
    currentStatus: 'active',
    pauseState: {
      isPaused: false,
      pauseStartedAt: null,
      totalPauseMinutes: 0,
      reason: null,
    },
    notifiedThresholds: {
      response: [],
      resolution: [],
    },
    responseDeadline: null,
    resolutionDeadline: null,
    nextWakeTime: null,
  };

  setHandler(pauseSignal, (signal: PauseSignal) => {
    if (state.pauseState.isPaused) {
      return;
    }
    state.pauseState.isPaused = true;
    state.pauseState.pauseStartedAt = new Date().toISOString();
    state.pauseState.reason = signal.reason;
    state.currentStatus = 'paused';
    log.info('SLA workflow paused', { ticketId, reason: signal.reason });
  });

  setHandler(resumeSignal, () => {
    if (!state.pauseState.isPaused || !state.pauseState.pauseStartedAt) {
      return;
    }
    const pausedAt = new Date(state.pauseState.pauseStartedAt);
    const pauseMinutes = Math.floor(
      (Date.now() - pausedAt.getTime()) / 60000
    );
    state.pauseState.totalPauseMinutes += Math.max(0, pauseMinutes);
    state.pauseState.isPaused = false;
    state.pauseState.pauseStartedAt = null;
    state.pauseState.reason = null;
    state.currentStatus = 'active';
    log.info('SLA workflow resumed', { ticketId, pauseMinutes });
  });

  setHandler(completeResponseSignal, async (signal: CompleteSignal) => {
    responseCompleted = true;
    state.currentPhase = 'resolution';
    await activities.recordSlaAuditLog({
      tenantId,
      ticketId,
      eventType: 'sla_response_completed',
      eventData: { met: signal.met },
    });
  });

  setHandler(completeResolutionSignal, async (signal: CompleteSignal) => {
    resolutionCompleted = true;
    state.currentStatus = 'completed';
    await activities.recordSlaAuditLog({
      tenantId,
      ticketId,
      eventType: 'sla_resolution_completed',
      eventData: { met: signal.met },
    });
  });

  setHandler(cancelSignal, () => {
    cancelled = true;
    state.currentStatus = 'cancelled';
    log.info('SLA workflow cancelled', { ticketId });
  });

  setHandler(getStateQuery, () => {
    if (!state.nextWakeTime) {
      return { ...state, remainingTimeMinutes: null };
    }

    const remainingMinutes = Math.ceil(
      (new Date(state.nextWakeTime).getTime() - Date.now()) / 60000
    );

    return {
      ...state,
      remainingTimeMinutes: Number.isFinite(remainingMinutes)
        ? remainingMinutes
        : null,
    };
  });

  log.info('SLA ticket workflow started', {
    ticketId,
    tenantId,
    workflowId: workflowInfo().workflowId,
  });

  const phases: Array<{
    phase: 'response' | 'resolution';
    targetMinutes?: number | null;
    deadlineKey: 'responseDeadline' | 'resolutionDeadline';
  }> = [
    {
      phase: 'response',
      targetMinutes: target.response_time_minutes,
      deadlineKey: 'responseDeadline',
    },
    {
      phase: 'resolution',
      targetMinutes: target.resolution_time_minutes,
      deadlineKey: 'resolutionDeadline',
    },
  ];

  for (const phase of phases) {
    if (cancelled || resolutionCompleted) {
      break;
    }

    if (!phase.targetMinutes || phase.targetMinutes <= 0) {
      if (phase.phase === 'response') {
        responseCompleted = true;
        state.currentPhase = 'resolution';
      }
      continue;
    }

    state.currentPhase = phase.phase;

    const thresholds = [50, 75, 90, 100];
    for (const threshold of thresholds) {
      if (cancelled || resolutionCompleted) {
        break;
      }

      if (phase.phase === 'response' && responseCompleted) {
        break;
      }

      while (state.pauseState.isPaused && !cancelled && !resolutionCompleted) {
        await condition(() => !state.pauseState.isPaused || cancelled);
      }

      if (cancelled || resolutionCompleted) {
        break;
      }

      const thresholdMinutes = Math.ceil(
        (phase.targetMinutes * threshold) / 100
      );

      const wakeTimeIso = await activities.calculateNextWakeTime({
        currentTime: startedAt.toISOString(),
        targetMinutes: thresholdMinutes,
        schedule: businessHoursSchedule,
        pauseMinutes: state.pauseState.totalPauseMinutes,
      });

      state.nextWakeTime = wakeTimeIso;

      if (threshold === 100) {
        state[phase.deadlineKey] = wakeTimeIso;
      }

      const sleepMs = new Date(wakeTimeIso).getTime() - Date.now();
      if (sleepMs > 0) {
        await Promise.race([
          sleep(sleepMs),
          condition(
            () =>
              state.pauseState.isPaused ||
              cancelled ||
              resolutionCompleted ||
              (phase.phase === 'response' && responseCompleted)
          ),
        ]);
      }

      if (state.pauseState.isPaused) {
        continue;
      }

      if (cancelled || resolutionCompleted) {
        break;
      }

      if (phase.phase === 'response' && responseCompleted) {
        break;
      }

      if (!state.notifiedThresholds[phase.phase].includes(threshold)) {
        state.notifiedThresholds[phase.phase].push(threshold);

        if (threshold < 100) {
          await activities.sendSlaNotification({
            tenantId,
            ticketId,
            phase: phase.phase,
            thresholdPercent: threshold,
          });
        } else {
          await activities.updateSlaStatus({
            tenantId,
            ticketId,
            phase: phase.phase,
            breached: true,
          });
        }

        await activities.checkAndEscalate({
          tenantId,
          ticketId,
          phase: phase.phase,
          thresholdPercent: threshold,
        });
      }
    }
  }
}
