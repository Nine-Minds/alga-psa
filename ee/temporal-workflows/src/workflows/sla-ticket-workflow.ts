import {
  allHandlersFinished,
  condition,
  continueAsNew,
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
  /** Configured notification thresholds from sla_notification_thresholds table. 100% is always included for breach detection. */
  notificationThresholds?: number[];
  /**
   * Set only by continueAsNew: progress carried from the previous run so the
   * SLA clock, pause accounting and notified thresholds survive the rollover.
   */
  carried?: SlaTicketWorkflowCarriedState;
  /** Test hook: roll over to a new run once history reaches this many events. */
  continueAsNewAfterEvents?: number;
}

export interface SlaTicketWorkflowCarriedState {
  startedAt: string;
  state: SlaTicketWorkflowState;
  responseCompleted: boolean;
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
  met: boolean | null;
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
  completeIfTicketClosed(input: {
    tenantId: string;
    ticketId: string;
  }): Promise<{
    closed: boolean;
    responseMet: boolean | null;
    resolutionMet: boolean | null;
    reason?: 'closed' | 'deleted';
  }>;
  getTicketSlaPauseState(input: {
    tenantId: string;
    ticketId: string;
  }): Promise<{
    paused: boolean;
    reason: SlaPauseReason | null;
  }>;
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

// Resume/close/cancel arrive as signals, so the sweep is only a safety net for
// signals that were lost. Deadlines are single timers and are unaffected by it.
const PAUSED_SWEEP_INTERVAL_MS = 5 * 60_000;
// Fallback rollover point when the server does not suggest continue-as-new.
// Well under Temporal's 51,200-event hard limit and cheap to replay.
const DEFAULT_CONTINUE_AS_NEW_AFTER_EVENTS = 10_000;

export async function slaTicketWorkflow(
  input: SlaTicketWorkflowInput
): Promise<void> {
  const { ticketId, tenantId, policyTargets, businessHoursSchedule, notificationThresholds } = input;
  // The SLA clock starts with the first run; later runs inherit it.
  const startedAt = input.carried ? new Date(input.carried.startedAt) : new Date();
  const continueAsNewAfterEvents =
    input.continueAsNewAfterEvents ?? DEFAULT_CONTINUE_AS_NEW_AFTER_EVENTS;

  const target = policyTargets[0];
  if (!target) {
    log.warn('SLA workflow started without policy targets; exiting', {
      ticketId,
      tenantId,
      workflowId: workflowInfo().workflowId,
    });
    return;
  }

  let responseCompleted = input.carried?.responseCompleted ?? false;
  let resolutionCompleted = false;
  let cancelled = false;

  const state: SlaTicketWorkflowState = input.carried
    ? {
        ...input.carried.state,
        pauseState: { ...input.carried.state.pauseState },
        notifiedThresholds: {
          response: [...input.carried.state.notifiedThresholds.response],
          resolution: [...input.carried.state.notifiedThresholds.resolution],
        },
      }
    : {
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

  const applyPause = (reason: SlaPauseReason) => {
    if (state.pauseState.isPaused) {
      return;
    }
    state.pauseState.isPaused = true;
    state.pauseState.pauseStartedAt = new Date().toISOString();
    state.pauseState.reason = reason;
    state.currentStatus = 'paused';
  };

  const applyResume = (): number | null => {
    if (!state.pauseState.isPaused || !state.pauseState.pauseStartedAt) {
      return null;
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
    return pauseMinutes;
  };

  setHandler(pauseSignal, (signal: PauseSignal) => {
    if (state.pauseState.isPaused) {
      return;
    }
    applyPause(signal.reason);
    log.info('SLA workflow paused', { ticketId, reason: signal.reason });
  });

  setHandler(resumeSignal, () => {
    const pauseMinutes = applyResume();
    if (pauseMinutes === null) {
      return;
    }
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
    continued: Boolean(input.carried),
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

  // Self-heal: if the ticket has already been closed (e.g. the
  // completeResolution signal was missed because of a transient failure
  // upstream), backfill the SLA fields and exit. We never want to keep
  // escalating a closed ticket just because the signal got dropped.
  // Closed-but-still-present tickets exit as 'completed'; tickets whose
  // row has been deleted exit as 'cancelled' so the two cases are
  // distinguishable in workflow state and downstream metrics.
  const checkClosedAndComplete = async (
    triggeredBy: 'startup' | 'wake' | 'pause'
  ): Promise<boolean> => {
    const result = await activities.completeIfTicketClosed({
      tenantId,
      ticketId,
    });
    if (!result.closed) {
      return false;
    }

    if (result.reason === 'deleted') {
      cancelled = true;
      state.currentStatus = 'cancelled';
    } else {
      resolutionCompleted = true;
      state.currentStatus = 'completed';
    }

    log.info('SLA workflow self-healed', {
      ticketId,
      triggeredBy,
      exitReason: result.reason ?? 'closed',
      responseMet: result.responseMet,
      resolutionMet: result.resolutionMet,
    });
    return true;
  };

  // Self-heal a lost resume: the app decides pause state from the ticket row,
  // so re-read it and resume when the ticket is no longer in a pausing state.
  const reconcilePauseWithTicket = async (): Promise<void> => {
    const current = await activities.getTicketSlaPauseState({ tenantId, ticketId });
    if (current.paused || !state.pauseState.isPaused) {
      return;
    }
    const pauseMinutes = applyResume();
    log.info('SLA workflow self-healed: resume signal was missed, resuming', {
      ticketId,
      pauseMinutes,
    });
  };

  const shouldRollOver = (): boolean => {
    const info = workflowInfo();
    return info.continueAsNewSuggested || info.historyLength >= continueAsNewAfterEvents;
  };

  // Hand the SLA clock to a fresh run so history never nears Temporal's limit.
  // Waits for async signal handlers so audit rows are not lost mid-flight.
  const rollOver = async (): Promise<never> => {
    await condition(allHandlersFinished);
    log.info('SLA workflow continuing as new', {
      ticketId,
      historyLength: workflowInfo().historyLength,
    });
    return continueAsNew<typeof slaTicketWorkflow>({
      ...input,
      carried: { startedAt: startedAt.toISOString(), state, responseCompleted },
    });
  };

  const isDone = (phase: 'response' | 'resolution'): boolean =>
    cancelled || resolutionCompleted || (phase === 'response' && responseCompleted);

  if (await checkClosedAndComplete('startup')) {
    return;
  }

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

    // Use configured thresholds, always ensuring 100% is included for breach detection
    const configuredThresholds = notificationThresholds && notificationThresholds.length > 0
      ? notificationThresholds
      : [50, 75, 90];
    const thresholds = [...new Set([...configuredThresholds, 100])].sort((a, b) => a - b);
    // Index loop so a pause that interrupts a wait re-enters the same threshold.
    let thresholdIndex = 0;
    while (thresholdIndex < thresholds.length) {
      const threshold = thresholds[thresholdIndex];
      if (isDone(phase.phase)) {
        break;
      }

      // Already handled by an earlier run.
      if (state.notifiedThresholds[phase.phase].includes(threshold)) {
        thresholdIndex += 1;
        continue;
      }

      while (state.pauseState.isPaused && !isDone(phase.phase)) {
        // Plain race, not condition(pred, timeout): that cancels its timer on
        // resume, and a CancelTimer for a timer that fired in the same workflow
        // task is rejected by the server ("invalid history builder state"),
        // wedging the workflow. A superseded sweep timer just fires unused.
        const resumedOrCompleted = await Promise.race([
          sleep(PAUSED_SWEEP_INTERVAL_MS).then(() => false),
          condition(() => !state.pauseState.isPaused || isDone(phase.phase)).then(() => true),
        ]);

        if (!resumedOrCompleted && state.pauseState.isPaused) {
          if (await checkClosedAndComplete('pause')) {
            break;
          }
          await reconcilePauseWithTicket();
          if (state.pauseState.isPaused && shouldRollOver()) {
            await rollOver();
          }
        }
      }

      if (isDone(phase.phase)) {
        break;
      }

      if (shouldRollOver()) {
        await rollOver();
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
          condition(() => state.pauseState.isPaused || isDone(phase.phase)),
        ]);
      }

      if (state.pauseState.isPaused) {
        continue;
      }

      if (isDone(phase.phase)) {
        break;
      }

      if (await checkClosedAndComplete('wake')) {
        break;
      }

      if (!state.notifiedThresholds[phase.phase].includes(threshold)) {
        state.notifiedThresholds[phase.phase].push(threshold);

        await activities.sendSlaNotification({
          tenantId,
          ticketId,
          phase: phase.phase,
          thresholdPercent: threshold,
        });

        if (threshold === 100) {
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

      thresholdIndex += 1;
    }
  }
}
