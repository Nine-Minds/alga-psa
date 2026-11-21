import {
  allHandlersFinished,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  log,
  patched,
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
  evaluatedEscalationThresholds?: {
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
    escalationLevel?: 1 | 2 | 3;
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

  // Preserve the pre-change activity command sequence and rounded deadlines
  // when replaying histories created before exact escalation thresholds.
  const useExactEscalationThresholds = patched('sla-exact-escalation-thresholds-v1');

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
        evaluatedEscalationThresholds: {
          response: [...(input.carried.state.evaluatedEscalationThresholds?.response ?? [])],
          resolution: [...(input.carried.state.evaluatedEscalationThresholds?.resolution ?? [])],
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
        evaluatedEscalationThresholds: {
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

    // Use configured thresholds, always ensuring 100% is included for breach detection.
    const configuredThresholds = notificationThresholds && notificationThresholds.length > 0
      ? notificationThresholds
      : [50, 75, 90];
    const notificationWakePoints = [...new Set([...configuredThresholds, 100])].sort((a, b) => a - b);
    // Histories started before this patch used only notification points and
    // evaluated escalation at each one. Keep that command path intact on replay.
    const configuredEscalationThresholds = [
      target.escalation_1_percent,
      target.escalation_2_percent,
      target.escalation_3_percent,
    ].filter((value): value is number => Number.isFinite(value) && value > 0);
    // The PR branch and current main introduced the same wake-point behavior
    // under separate patch markers. Either marker enables it for histories
    // that recorded that version; retain both markers for deterministic replay.
    const useConfiguredEscalationWakePoints =
      patched('sla-escalation-configured-wakepoints-v1') || useExactEscalationThresholds;
    const escalationWakePoints = [...new Set(configuredEscalationThresholds)].sort((a, b) => a - b);
    const thresholds = useConfiguredEscalationWakePoints
      ? [...new Set([...notificationWakePoints, ...escalationWakePoints])].sort((a, b) => a - b)
      : notificationWakePoints;
    const phaseThresholds = useConfiguredEscalationWakePoints &&
      phase.phase === 'response' && target.resolution_time_minutes && target.resolution_time_minutes > 0
      ? thresholds.filter((threshold) => threshold <= 100)
      : thresholds;
    const wakeEvents = phaseThresholds.map((threshold) => ({ phase: phase.phase, threshold }));
    // Response escalation deadlines remain live while resolution is tracked.
    // Keep the response clock origin and percentage when carrying them forward.
    if (
      useConfiguredEscalationWakePoints &&
      phase.phase === 'resolution' &&
      !responseCompleted &&
      state.notifiedThresholds.response.includes(100) &&
      target.response_time_minutes && target.response_time_minutes > 0
    ) {
      for (const threshold of escalationWakePoints) {
        if (!(state.evaluatedEscalationThresholds?.response.includes(threshold) ?? false)) {
          wakeEvents.push({ phase: 'response', threshold });
        }
      }
      wakeEvents.sort((left, right) => {
        const leftTarget = left.phase === 'response' ? target.response_time_minutes! : phase.targetMinutes!;
        const rightTarget = right.phase === 'response' ? target.response_time_minutes! : phase.targetMinutes!;
        return leftTarget * left.threshold - rightTarget * right.threshold;
      });
    }
    // Index loop so a pause that interrupts a wait re-enters the same threshold.
    let thresholdIndex = 0;
    while (thresholdIndex < wakeEvents.length) {
      const wakeEvent = wakeEvents[thresholdIndex];
      const actionPhase = wakeEvent.phase;
      const threshold = wakeEvent.threshold;
      if (isDone(phase.phase)) {
        break;
      }

      // A response-completion signal ends pending response escalations, even
      // when it arrives after breach while the resolution phase is running.
      if (actionPhase === 'response' && responseCompleted) {
        thresholdIndex += 1;
        continue;
      }

      // Legacy runs treated notification state as the whole wake-point state.
      // New runs track escalation evaluations separately across continue-as-new.
      const isEventNotification = actionPhase === phase.phase && notificationWakePoints.includes(threshold);
      const notificationAlreadyHandled = !isEventNotification ||
        state.notifiedThresholds[actionPhase].includes(threshold);
      const escalationAlreadyHandledAtWake = !escalationWakePoints.includes(threshold) ||
        (state.evaluatedEscalationThresholds?.[actionPhase].includes(threshold) ?? false);
      if (
        (!useConfiguredEscalationWakePoints && state.notifiedThresholds[phase.phase].includes(threshold)) ||
        (useConfiguredEscalationWakePoints && notificationAlreadyHandled && escalationAlreadyHandledAtWake)
      ) {
        thresholdIndex += 1;
        continue;
      }

      while (
        state.pauseState.isPaused &&
        !isDone(phase.phase) &&
        !(actionPhase === 'response' && responseCompleted)
      ) {
        // Plain race, not condition(pred, timeout): that cancels its timer on
        // resume, and a CancelTimer for a timer that fired in the same workflow
        // task is rejected by the server ("invalid history builder state"),
        // wedging the workflow. A superseded sweep timer just fires unused.
        const resumedOrCompleted = await Promise.race([
          sleep(PAUSED_SWEEP_INTERVAL_MS).then(() => false),
          condition(() =>
            !state.pauseState.isPaused ||
            isDone(phase.phase) ||
            (actionPhase === 'response' && responseCompleted)
          ).then(() => true),
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

      if (actionPhase === 'response' && responseCompleted) {
        thresholdIndex += 1;
        continue;
      }

      // Preserve the old pre-wake rollover point for replay. New runs roll at
      // the end of each fully evaluated wake point so a low history threshold
      // cannot repeatedly continue-as-new before making progress.
      if (!useConfiguredEscalationWakePoints && shouldRollOver()) {
        await rollOver();
      }

      const eventTargetMinutes = actionPhase === 'response'
        ? target.response_time_minutes!
        : phase.targetMinutes;
      const thresholdMinutes = useExactEscalationThresholds
        ? (eventTargetMinutes * threshold) / 100
        : Math.ceil((eventTargetMinutes * threshold) / 100);

      const wakeTimeIso = await activities.calculateNextWakeTime({
        currentTime: startedAt.toISOString(),
        targetMinutes: thresholdMinutes,
        schedule: businessHoursSchedule,
        pauseMinutes: state.pauseState.totalPauseMinutes,
      });

      state.nextWakeTime = wakeTimeIso;

      if (threshold === 100) {
        state[actionPhase === 'response' ? 'responseDeadline' : phase.deadlineKey] = wakeTimeIso;
      }

      const sleepMs = new Date(wakeTimeIso).getTime() - Date.now();
      if (sleepMs > 0) {
        await Promise.race([
          sleep(sleepMs),
          condition(() =>
            state.pauseState.isPaused ||
            isDone(phase.phase) ||
            (actionPhase === 'response' && responseCompleted)
          ),
        ]);
      }

      if (state.pauseState.isPaused) {
        continue;
      }

      if (isDone(phase.phase)) {
        break;
      }

      if (actionPhase === 'response' && responseCompleted) {
        thresholdIndex += 1;
        continue;
      }

      if (await checkClosedAndComplete('wake')) {
        break;
      }

      const isNotificationThreshold = actionPhase === phase.phase && notificationWakePoints.includes(threshold);
      const isEscalationThreshold = escalationWakePoints.includes(threshold);
      const escalationAlreadyEvaluated = state.evaluatedEscalationThresholds?.[actionPhase].includes(threshold) ?? false;

      if (isNotificationThreshold && !state.notifiedThresholds[actionPhase].includes(threshold)) {
        state.notifiedThresholds[actionPhase].push(threshold);

        await activities.sendSlaNotification({
          tenantId,
          ticketId,
          phase: actionPhase,
          thresholdPercent: threshold,
        });

        if (threshold === 100) {
          await activities.updateSlaStatus({
            tenantId,
            ticketId,
            phase: actionPhase,
            breached: true,
          });
        }

      }

      // The legacy branch deliberately keeps checking at notification points so
      // pre-patch histories replay the same activity sequence. New runs check
      // only at policy-configured escalation points, including values over 100%.
      if (
        (!useConfiguredEscalationWakePoints || isEscalationThreshold) &&
        (!useConfiguredEscalationWakePoints || !escalationAlreadyEvaluated)
      ) {
        // Escalation failures (after the activity's retries are exhausted) must
        // never stop SLA tracking: log and carry on with the next wake point.
        try {
          const dueLevels = useConfiguredEscalationWakePoints
            ? ([1, 2, 3] as const).filter((level) =>
                target[`escalation_${level}_percent`] === threshold
              )
          : [undefined];
          for (const escalationLevel of dueLevels) {
            await activities.checkAndEscalate({
              tenantId,
              ticketId,
              phase: actionPhase,
              thresholdPercent: threshold,
              escalationLevel,
            });
          }
          if (useConfiguredEscalationWakePoints) {
            state.evaluatedEscalationThresholds ??= { response: [], resolution: [] };
            state.evaluatedEscalationThresholds[actionPhase].push(threshold);
          }
        } catch (error) {
          log.warn('SLA escalation failed; continuing SLA tracking', {
            ticketId,
            tenantId,
            phase: actionPhase,
            thresholdPercent: threshold,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      thresholdIndex += 1;
      if (useConfiguredEscalationWakePoints && shouldRollOver()) {
        await rollOver();
      }
    }
  }
}
